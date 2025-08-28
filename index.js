import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from 'dotenv';
import { semanticSearch, directVectorSearch, formatSearchResults } from './lib/search.js';
import { vectorStoreSearch } from './lib/vector_store_search.js';

// Load environment variables
config();

// Create an MCP server
const server = new McpServer({
  name: "wordpress-semantic-search",
  version: "1.0.0"
});

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

// Add semantic search tool
server.registerTool("semantic_search",
  {
    title: "WordPress Semantic Search",
    description: "Search WordPress posts using direct embeddings and cosine similarity",
    inputSchema: { 
      query: z.string().describe("Search query"),
      top_k: z.number().optional().describe("Number of results to return (default: 10)")
    }
  },
  async ({ query, top_k = 10 }) => {
    try {
      const results = await semanticSearch(query, top_k);
      const formattedResults = formatSearchResults(results);
      
      return {
        content: [{ 
          type: "text", 
          text: formattedResults
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: `Search error: ${error.message}`
        }]
      };
    }
  }
);

// Vector Store search tool (Responses API + file_search)
server.registerTool(
  "vs_search",
  {
    title: "WordPress Vector Store Search",
    description: "Search WordPress posts using OpenAI Vector Store (file_search)",
    inputSchema: {
      query: z.string().describe("Search query"),
      top_k: z.number().optional().describe("Number of results to return (default: 5)")
    }
  },
  async ({ query, top_k = 5 }) => {
    try {
      const { text } = await vectorStoreSearch(query, top_k);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Vector Store search error: ${error.message}` }] };
    }
  }
);

// Vector Store search resource
server.registerResource(
  "vs-search",
  new ResourceTemplate("vs-search://{query}", { list: undefined }),
  {
    title: "WordPress Vector Store Search",
    description: "Search WordPress posts via OpenAI Vector Store (file_search)"
  },
  async (uri, { query }) => {
    const decoded = safeDecode(query);
    if (!decoded || decoded.trim().length === 0) {
      return {
        contents: [{ uri: uri.href, text: "Please provide a non-empty query. Example: vs-search://AI技术" }]
      };
    }

    try {
      const { text } = await vectorStoreSearch(decoded, 5);
      return { contents: [{ uri: uri.href, text }] };
    } catch (error) {
      return {
        contents: [{ uri: uri.href, text: `Vector Store search error: ${error.message}\n\nEnsure: OPENAI_API_KEY, OPENAI_VECTOR_STORE_ID set, and store has files (run: node scripts/build-index-vs.js)` }]
      };
    }
  }
);

// WordPress search resource using direct embeddings
server.registerResource(
  "wp-search",
  new ResourceTemplate("wp-search://{query}", { list: undefined }),
  {
    title: "WordPress Semantic Search",
    description: "Semantic search WordPress posts using direct embeddings and cosine similarity"
  },
  async (uri, { query }) => {
    const decoded = safeDecode(query);
    if (!decoded || decoded.trim().length === 0) {
      return {
        contents: [{
          uri: uri.href,
          text: "Please provide a non-empty query. Example: wp-search://AI技术"
        }]
      };
    }

    try {
      console.log(`Resource search for: ${decoded}`);
      const results = await semanticSearch(decoded, 10);
      const formattedResults = formatSearchResults(results);

      return {
        contents: [{
          uri: uri.href,
          text: formattedResults
        }]
      };
    } catch (error) {
      console.error('Resource search error:', error);
      return {
        contents: [{
          uri: uri.href,
          text: `Search error: ${error.message}\n\nPlease ensure:\n1. Embeddings are generated (run: node scripts/build-index.js)\n2. Environment variables are set correctly\n3. OpenAI API key is valid`
        }]
      };
    }
  }
);

// Health check resource
server.registerResource(
  "health",
  new ResourceTemplate("health://status", { list: undefined }),
  {
    title: "System Health Check",
    description: "Check system configuration and embeddings status"
  },
  async (uri) => {
    const checks = [];
    
    // Check environment variables
    checks.push(`✅ OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Set' : '❌ Missing'}`);
    checks.push(`✅ OPENAI_EMBEDDING_MODEL: ${process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small (default)'}`);
    checks.push(`✅ WORDPRESS_POSTS_URL: ${process.env.WORDPRESS_POSTS_URL ? 'Set' : '❌ Missing'}`);
    checks.push(`✅ MIN_SIMILARITY: ${process.env.MIN_SIMILARITY || '0.30 (default)'}`);
    
    // Check embeddings file
    try {
      const fs = await import('fs/promises');
      await fs.access('./data/embeddings.json');
      checks.push(`✅ Embeddings file: Found`);
    } catch {
      checks.push(`❌ Embeddings file: Missing (run: node scripts/build-index.js)`);
    }
    
    const status = checks.join('\n');
    
    return {
      contents: [{
        uri: uri.href,
        text: `WordPress Semantic Search - Health Check\n\n${status}\n\nTo run indexing: node scripts/build-index.js\nTo test search: Use wp-search://your-query`
      }]
    };
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);