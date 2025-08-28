#!/usr/bin/env node

import OpenAI from 'openai';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables
config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION,
  project: process.env.OPENAI_PROJECT,
});

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const WORDPRESS_POSTS_URL = process.env.WORDPRESS_POSTS_URL;
const DATA_DIR = './data';
const EMBEDDINGS_FILE = path.join(DATA_DIR, 'embeddings.json');

/**
 * Strip HTML tags and clean text
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch WordPress posts with pagination
 */
async function fetchWordPressPosts() {
  console.log('Fetching WordPress posts...');
  const allPosts = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${WORDPRESS_POSTS_URL}&page=${page}`;
    console.log(`Fetching page ${page}...`);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 400 && page > 1) {
          // No more pages
          break;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const posts = await response.json();
      if (!posts || posts.length === 0) {
        break;
      }

      allPosts.push(...posts);
      console.log(`Fetched ${posts.length} posts from page ${page}`);
      
      if (posts.length < perPage) {
        // Last page
        break;
      }
      page++;
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error.message);
      break;
    }
  }

  console.log(`Total posts fetched: ${allPosts.length}`);
  return allPosts;
}

/**
 * Process posts into documents
 */
function processPostsToDocuments(posts) {
  console.log('Processing posts into documents...');
  const documents = [];

  for (const post of posts) {
    const title = stripHtml(post.title?.rendered || '');
    const excerpt = stripHtml(post.excerpt?.rendered || '');
    const content = stripHtml(post.content?.rendered || '');
    
    // Combine title and content for embedding
    const text = `${title}\n\n${excerpt || content}`.trim();
    
    if (!text || text.length < 10) {
      console.log(`Skipping post ${post.id} - insufficient content`);
      continue;
    }

    // Limit text length to avoid token limits
    const maxLength = 8000;
    const finalText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;

    const document = {
      id: `post-${post.id}`,
      text: finalText,
      metadata: {
        post_id: post.id,
        title: title,
        excerpt: excerpt || content.substring(0, 300) + '...',
        link: post.link || `https://www.yaoyingying.com/?p=${post.id}`,
        wp_date: post.date,
        modified: post.modified,
        status: post.status
      }
    };

    documents.push(document);
  }

  console.log(`Processed ${documents.length} documents`);
  return documents;
}

/**
 * Generate embeddings for documents
 */
async function generateEmbeddings(documents) {
  console.log(`Generating embeddings for ${documents.length} documents...`);
  const embeddings = [];
  const batchSize = 100; // OpenAI embeddings API batch limit
  
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const batchTexts = batch.map(doc => doc.text);
    
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)} (${batch.length} documents)...`);
    
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batchTexts,
      });
      
      const batchEmbeddings = response.data.map(item => item.embedding);
      embeddings.push(...batchEmbeddings);
      
      console.log(`  Generated ${batchEmbeddings.length} embeddings`);
      
      // Small delay to avoid rate limits
      if (i + batchSize < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`Error generating embeddings for batch ${Math.floor(i / batchSize) + 1}:`, error.message);
      throw error;
    }
  }
  
  console.log(`Generated ${embeddings.length} embeddings total`);
  return embeddings;
}

/**
 * Save embeddings to local file
 */
async function saveEmbeddings(documents, embeddings) {
  console.log('Saving embeddings to local file...');
  
  // Ensure data directory exists
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  const data = {
    created_at: new Date().toISOString(),
    model: EMBEDDING_MODEL,
    total_documents: documents.length,
    documents: documents,
    embeddings: embeddings
  };
  
  await fs.writeFile(EMBEDDINGS_FILE, JSON.stringify(data, null, 2));
  console.log(`Saved embeddings to ${EMBEDDINGS_FILE}`);
}

/**
 * Main indexing function
 */
async function buildIndex() {
  try {
    console.log('Starting WordPress content indexing...');
    console.log(`Using embedding model: ${EMBEDDING_MODEL}`);
    console.log(`Output file: ${EMBEDDINGS_FILE}`);

    // Fetch WordPress posts
    const posts = await fetchWordPressPosts();
    if (posts.length === 0) {
      console.log('No posts found. Exiting.');
      return;
    }

    // Process posts into documents
    const documents = processPostsToDocuments(posts);
    if (documents.length === 0) {
      console.log('No valid documents to index. Exiting.');
      return;
    }

    // Generate embeddings
    const embeddings = await generateEmbeddings(documents);
    
    if (embeddings.length !== documents.length) {
      throw new Error(`Mismatch: ${documents.length} documents but ${embeddings.length} embeddings`);
    }

    // Save to local file
    await saveEmbeddings(documents, embeddings);

    console.log('✅ Indexing completed successfully!');
    console.log(`📊 Indexed ${documents.length} documents from ${posts.length} WordPress posts`);
    console.log(`� Embeddings saved to ${EMBEDDINGS_FILE}`);
    console.log(`🔍 Ready for semantic search!`);

  } catch (error) {
    console.error('❌ Indexing failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the indexing if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildIndex();
}
