import OpenAI from 'openai';
import { config } from 'dotenv';

config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION,
  project: process.env.OPENAI_PROJECT,
});

const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;
const ASSISTANT_ID = process.env.OPENAI_VECTOR_ASSISTANT_ID; // optional: preconfigured assistant bound to the vector store
const MODEL = process.env.OPENAI_VECTOR_SEARCH_MODEL || 'gpt-4o-mini';

function assertEnv() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  if (!VECTOR_STORE_ID) throw new Error('Missing OPENAI_VECTOR_STORE_ID');
}

export async function vectorStoreSearch(query, topK = 5) {
  assertEnv();
  if (!query || !query.trim()) throw new Error('Query must be non-empty');

  // Use Responses API with file_search tool, binding to existing Vector Store
  const instructions = [
    'You are a precise search assistant. Use the attached vector store to retrieve the most relevant passages.',
    `Return up to ${topK} results as strict JSON.`,
    'Each item must include: title (string, optional), link (string, optional), snippet (string), and source (string, optional file name or URL).',
    'Do not fabricate links. Prefer the Link field from documents when available.',
    'Do not output duplicate items. Consolidate items that point to the same link into one entry.',
  ].join('\n');

  let response;
  try {
    if (ASSISTANT_ID) {
      // Preferred fallback path: use an Assistant pre-configured with file_search + vector store resources
      response = await client.responses.create({
        assistant_id: ASSISTANT_ID,
        input: [
          { role: 'system', content: instructions },
          { role: 'user', content: `Query: ${query}` },
        ],
        text: { format: { type: 'json_object' } },
        max_output_tokens: 300,
        temperature: 0,
      });
    } else {
      // Inline binding path (may vary by deployment)
      response = await client.responses.create({
        model: MODEL,
        input: [
          { role: 'system', content: instructions },
          { role: 'user', content: `Query: ${query}` },
        ],
        tools: [{ type: 'file_search', vector_store_ids: [VECTOR_STORE_ID] }],
        text: { format: { type: 'json_object' } },
        max_output_tokens: 300,
        temperature: 0,
      });
    }
  } catch (e) {
    // Provide actionable guidance if the server rejects inline binding fields
    const msg = String(e?.message || e);
    if (/Unknown parameter/i.test(msg)) {
      throw new Error(
        'This server rejects inline vector store binding. Set OPENAI_VECTOR_ASSISTANT_ID to an Assistant that has file_search enabled and is bound to your vector store, then retry.'
      );
    }
    throw e;
  }
  const text = response.output_text || '';
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Fallback shape if parsing fails
    json = { items: [], raw_text: text };
  }

  // Return results as-is (no client-side deduplication), capped at topK
  const items = Array.isArray(json?.results)
    ? json.results
    : (Array.isArray(json?.items) ? json.items : []);

  // Ensure each item includes a numeric score; if missing, derive from rank/order
  const sliced = items.slice(0, topK);
  const n = sliced.length;
  const results = sliced.map((it, i) => {
    const hasScore = typeof it?.score === 'number' && Number.isFinite(it.score);
    const fallback = n <= 1 ? 1 : 1 - (i) / Math.max(1, n - 1);
    return {
      ...it,
      score: hasScore ? it.score : Number(fallback.toFixed(6)),
      original_rank: typeof it?.original_rank === 'number' ? it.original_rank : i + 1,
    };
  });

  const out = { results };
  return { query, topK, json: out, raw: response };
  // Print and return usage statistics when provided by the API
  // const usage = response && response.usage ? response.usage : undefined;
  // if (usage) {
  //   console.log('[vectorStoreSearch] usage:\n' + JSON.stringify(usage, null, 2));
  // }
  // return { query, topK, json: out, usage, raw: response };
}

export default { vectorStoreSearch };
