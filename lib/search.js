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
const MIN_SIMILARITY = parseFloat(process.env.MIN_SIMILARITY) || 0.30;
const EMBEDDINGS_FILE = './data/embeddings.json';

/**
 * Load embeddings from local file
 */
async function loadEmbeddings() {
  try {
    const data = await fs.readFile(EMBEDDINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load embeddings:', error.message);
    return { documents: [], embeddings: [] };
  }
}

/**
 * Generate embedding for query text
 */
async function generateQueryEmbedding(query) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query.trim(),
    });
    return response.data[0].embedding;
  } catch (error) {
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Perform semantic search using direct embeddings + cosine similarity
 * @param {string} query - The search query
 * @param {number} topK - Number of results to return (default: 10)
 * @returns {Promise<Object>} Search results with metadata
 */
export async function semanticSearch(query, topK = 10) {
  const startTime = Date.now();
  
  try {
    console.log(`Searching for: "${query}"`);
    console.log(`Top K: ${topK}, Min similarity: ${MIN_SIMILARITY}`);

    // Validate inputs
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Query must be a non-empty string');
    }

    // Load embeddings from local storage
    const { documents, embeddings } = await loadEmbeddings();
    
    if (!documents || documents.length === 0) {
      return {
        query: query,
        total_results: 0,
        results: [],
        search_time_ms: Date.now() - startTime,
        min_similarity: MIN_SIMILARITY,
        message: "No documents found. Please run the indexing script first."
      };
    }

    // Generate query embedding
    console.log('Generating query embedding...');
    const queryEmbedding = await generateQueryEmbedding(query);
    console.log(`Generated embedding with ${queryEmbedding.length} dimensions`);

    // Calculate similarities and rank results
    console.log('Calculating similarities...');
    const results = documents.map((doc, index) => {
      const similarity = cosineSimilarity(queryEmbedding, embeddings[index]);
      return {
        ...doc,
        score: similarity
      };
    })
    .filter(result => result.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

    const searchTime = Date.now() - startTime;
    console.log(`Search completed in ${searchTime}ms, found ${results.length} results`);

    return {
      query: query,
      total_results: results.length,
      results: results,
      search_time_ms: searchTime,
      min_similarity: MIN_SIMILARITY
    };

  } catch (error) {
    console.error('Search error:', error.message);
    throw new Error(`Semantic search failed: ${error.message}`);
  }
}

/**
 * Alternative search method (kept for compatibility)
 */
export async function directVectorSearch(query, topK = 10) {
  return await semanticSearch(query, topK);
}

/**
 * Format search results for display
 */
export function formatSearchResults(results) {
  if (!results.results || results.results.length === 0) {
    return results.message || `No results found for query: "${results.query}"`;
  }

  const lines = [
    `Found ${results.total_results} result(s) for: "${results.query}"`,
    `Search completed in ${results.search_time_ms}ms (min similarity: ${results.min_similarity})`,
    ''
  ];

  results.results.forEach((result, index) => {
    const score = result.score ? result.score.toFixed(3) : 'N/A';
    lines.push(`#${index + 1} [${score}] ${result.metadata.title}`);
    lines.push(`${result.metadata.link}`);
    lines.push(`${result.metadata.excerpt.substring(0, 200)}...`);
    lines.push('');
  });

  return lines.join('\n');
}

export default {
  semanticSearch,
  directVectorSearch,
  formatSearchResults
};
