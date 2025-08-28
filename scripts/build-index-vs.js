#!/usr/bin/env node
import { config } from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';

config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ORGANIZATION = process.env.OPENAI_ORGANIZATION;
const OPENAI_PROJECT = process.env.OPENAI_PROJECT;
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;
const WORDPRESS_POSTS_URL = process.env.WORDPRESS_POSTS_URL;

if (!OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY in .env');
  process.exit(1);
}
if (!VECTOR_STORE_ID) {
  console.error('❌ Missing OPENAI_VECTOR_STORE_ID in .env');
  process.exit(1);
}
if (!WORDPRESS_POSTS_URL) {
  console.error('❌ Missing WORDPRESS_POSTS_URL in .env');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
  organization: OPENAI_ORGANIZATION,
  project: OPENAI_PROJECT,
});

const TMP_DIR = path.join('data', 'tmp_uploads');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAllPosts() {
  console.log('Fetching WordPress posts for Vector Store indexing...');
  const all = [];
  let page = 1;
  const base = new URL(WORDPRESS_POSTS_URL);
  const configuredPerPage = Number(base.searchParams.get('per_page')) || 100;

  while (true) {
    const url = new URL(base.toString());
    // Always set current page; respect configured per_page if present
    url.searchParams.set('page', String(page));
    if (!base.searchParams.has('per_page')) url.searchParams.set('per_page', String(configuredPerPage));

    console.log(`Fetching page ${page}...`);
    const res = await fetch(url.toString());
    if (!res.ok) {
      // WordPress returns 400 when page exceeds total pages
      if (res.status === 400 && page > 1) break;
      throw new Error(`Failed to fetch posts: ${res.status} ${res.statusText}`);
    }
    const posts = await res.json();
    if (!Array.isArray(posts) || posts.length === 0) break;
    all.push(...posts);
    if (posts.length < configuredPerPage) break; // last page
    page += 1;
    await sleep(100);
  }
  console.log(`Total posts fetched: ${all.length}`);
  return all;
}

function toJsonDoc(post) {
  const title = stripHtml(post.title?.rendered || post.title || '');
  const link = post.link || '';
  const excerpt = stripHtml(post.excerpt?.rendered || post.excerpt || '');
  const content = stripHtml(post.content?.rendered || post.content || '');
  const id = post.id || post.slug || null;
  const slug = post.slug || null;
  const date = post.date || null;
  const doc = { id, slug, title, link, excerpt, content, date };
  return JSON.stringify(doc, null, 2);
}

async function ensureTmpDir() {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

async function writeTempFiles(posts) {
  console.log('Writing temporary text files...');
  const files = [];
  for (const post of posts) {
    const id = post.id || post.slug || Math.random().toString(36).slice(2);
    const safe = String(id).toString();
    const filename = `${safe}.json`;
    const filePath = path.join(TMP_DIR, filename);
    const json = toJsonDoc(post);
    await fs.writeFile(filePath, json, 'utf8');
    files.push({ filePath, filename });
  }
  console.log(`Prepared ${files.length} files`);
  return files;
}

async function uploadFiles(files) {
  console.log('Uploading files to OpenAI Files API...');
  const fileIds = [];
  const fsNode = await import('fs');
  let idx = 0;
  for (const f of files) {
    idx += 1;
    try {
      const stream = fsNode.createReadStream(f.filePath);
      // The OpenAI API accepts only { file, purpose } here; filename is inferred from the stream
      const file = await client.files.create({ file: stream, purpose: 'assistants' });
      fileIds.push(file.id);
      if (idx % 20 === 0) console.log(`Uploaded ${idx}/${files.length}`);
      await sleep(100);
    } catch (e) {
      console.error('Upload failed for', f.filename, e.message);
      throw e;
    }
  }
  console.log(`Uploaded ${fileIds.length} files`);
  return fileIds;
}

async function addFilesToVectorStoreBatch(fileIds) {
  console.log(`Adding ${fileIds.length} files to Vector Store ${VECTOR_STORE_ID} via file batch...`);
  const resp = await fetch(`https://api.openai.com/v1/vector_stores/${VECTOR_STORE_ID}/file_batches`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2',
      ...(OPENAI_ORGANIZATION && { 'OpenAI-Organization': OPENAI_ORGANIZATION }),
      ...(OPENAI_PROJECT && { 'OpenAI-Project': OPENAI_PROJECT }),
    },
    body: JSON.stringify({ file_ids: fileIds })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Batch create failed: ${resp.status} ${resp.statusText} ${txt}`);
  }
  const batch = await resp.json();
  console.log('File batch created:', batch.id, 'status:', batch.status);
  return batch;
}

async function waitForBatchCompletion(batchId, timeoutMs = 15 * 60 * 1000) {
  const start = Date.now();
  while (true) {
    const resp = await fetch(`https://api.openai.com/v1/vector_stores/${VECTOR_STORE_ID}/file_batches/${batchId}`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        ...(OPENAI_ORGANIZATION && { 'OpenAI-Organization': OPENAI_ORGANIZATION }),
        ...(OPENAI_PROJECT && { 'OpenAI-Project': OPENAI_PROJECT }),
      }
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Batch retrieve failed: ${resp.status} ${resp.statusText} ${txt}`);
    }
    const data = await resp.json();
    const { status, file_counts } = data;
    console.log(`Batch status: ${status} (completed: ${file_counts?.completed} / total: ${file_counts?.total})`);
    if (status === 'completed') return data;
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      throw new Error(`Batch ${status}. Details: ${JSON.stringify(data)}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for batch completion');
    await sleep(1500);
  }
}

async function main() {
  console.log('Starting Vector Store indexing (no local embeddings)...');
  console.log(`Using Vector Store: ${VECTOR_STORE_ID}`);

  await ensureTmpDir();
  const posts = await fetchAllPosts();
  const files = await writeTempFiles(posts);
  const fileIds = await uploadFiles(files);
  const batch = await addFilesToVectorStoreBatch(fileIds);
  await waitForBatchCompletion(batch.id);

  console.log('✅ Vector Store indexing completed. Files are embedded by OpenAI.');
}

main().catch(err => {
  console.error('Indexing error:', err?.message || err);
  process.exit(1);
});
