# PRD (English)

## Goal
- Build an API service that performs semantic search over WordPress content using OpenAI Embeddings with a "pre-embed documents + embed query only" approach.
- Restrict search strictly to the provided WordPress corpus; no cross-corpus extrapolation.
- During development, use curl for testing only; no Next.js integration code.

## Scope
- Fetch posts from a specified WordPress site, preprocess and vectorize them, and store in OpenAI Vector Stores.
- At query time, embed the user query once, retrieve TopK by vector similarity, and return summary/links.

Out of scope
- Complex QA generation (LLM long-form answers).
- Multi-site aggregation, cross-language translation.

## Architecture
- Content source: WordPress REST API `wp-json/wp/v2/posts` (supports ETag/If-Modified-Since).
- Preprocessing/Indexer: clean HTML, optional chunking, generate document embeddings, write to OpenAI Vector Stores.
- Vector store: OpenAI Vector Stores (managed storage, indexing, and retrieval).
- Searcher: accept queries, generate query embeddings, perform ANN search in the Vector Store, return results.
- MCP Server: optional for debugging; core logic resides in index/search modules.

## Embeddings (Concept and Usage in This Project)
- Definition: map text into a high-dimensional vector (e.g., 1536 dims) where semantically similar texts are closer.
- Metric: cosine similarity/vector distance to measure relatedness (higher score/smaller distance means more relevant).
- Usage here:
  - Indexing: generate embeddings for WordPress posts (optionally chunked) and write to the Vector Store.
  - Query: embed the user query once and run ANN similarity search to get TopK.
  - Threshold: if Top1 score < `MIN_SIMILARITY` (default 0.30), return "No sufficiently relevant articles found".
- Model: default `text-embedding-3-small` (1536 dims, overridable via `OPENAI_EMBEDDING_MODEL`).

## OpenAI Vector Stores Design
- Concepts: Vector Store (database) → Collection/Namespace (optional grouping) → Data Items (documents/chunks).
- Env vars: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_VECTOR_STORE_ID` (or create at runtime).
- Suggested fields: `post_id`, `chunk_id`, `title`, `excerpt`, `link`, `wp_date`, `content` (stored as data/metadata).
- Management operations (curl examples indicative; follow official docs for exact payloads):
  - Create store: `POST /v1/vector_stores`
  - Upsert documents: `POST /v1/vector_stores/{store_id}/documents`
  - Query: `POST /v1/vector_stores/{store_id}/query`

## Data Flow
1) Indexing (scheduled/manual):
   - Fetch posts (pagination; conditional requests to reduce downloads).
   - Clean: strip HTML from `title + excerpt/content`, trim length.
   - Optional chunking: split by paragraph/fixed length, keep `post_id/chunk_id`.
   - Generate embeddings or let the Vector Store manage embedding generation (keep consistent with `text-embedding-3-small`).
   - Upsert into the Vector Store (dedupe/overwrite by `post_id, chunk_id`).
2) Query:
   - Generate one query embedding (or let the query endpoint handle it).
   - Perform ANN search (TopK) in the Vector Store.
   - Threshold: if Top1 < `MIN_SIMILARITY` (default 0.30), return a no-result message.
   - Return title, link, excerpt, and score.

## Development & Testing (curl-only)
- Create a Vector Store (example):
```bash
curl https://api.openai.com/v1/vector_stores \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "wp-docs"
  }'
```
- Upsert documents/chunks (example):
```bash
curl https://api.openai.com/v1/vector_stores/$OPENAI_VECTOR_STORE_ID/documents \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "id": "post-123-chunk-0",
        "text": "Cleaned content here...",
        "metadata": {
          "post_id": 123,
          "chunk_id": 0,
          "title": "Sample Title",
          "excerpt": "Sample Excerpt",
          "link": "https://example.com/p/123",
          "wp_date": "2024-01-01T00:00:00Z"
        }
      }
    ],
    "embedding_model": "${OPENAI_EMBEDDING_MODEL:-text-embedding-3-small}"
  }'
```
- Similarity query (example):
```bash
curl https://api.openai.com/v1/vector_stores/$OPENAI_VECTOR_STORE_ID/query \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "hotel breakfast hours",
    "embedding_model": "${OPENAI_EMBEDDING_MODEL:-text-embedding-3-small}",
    "top_k": 10
  }'
```

## Model & Cost
- Default model: `text-embedding-3-small` (overridable via `OPENAI_EMBEDDING_MODEL`).
- Costs: one embedding per query; indexing costs by new/updated posts; storage/query costs per OpenAI Vector Stores pricing.

## Performance & Caching
- ANN: managed by OpenAI Vector Stores; latency depends on corpus size and quotas.
- WordPress fetch: conditional requests + caching (TTL 5–10 minutes).

## Security & Config
- Env vars: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_VECTOR_STORE_ID`, `MIN_SIMILARITY`.
- Observability: track request volume, latency, score distribution, error rates (future work).

## Components
- `scripts/build-index.ts`: fetch/clean/chunk/embed/upsert to OpenAI Vector Stores.
- `lib/search.ts`: query embedding + Vector Store ANN + thresholding + formatting.
- `index.js` (MCP): dev/debug entry that can reuse `lib/search.ts`.

## Deployment
- Vector store: use OpenAI Vector Stores (no self-managed DB/index needed).
- Indexing: local CRON / GitHub Actions / any scheduler triggering `build-index`.

## Testing Plan
- Unit: cleaning/chunking/similarity.
- Integration: small-scale index → query → validate TopK/threshold.
- Performance: 50/100 concurrency, P95 latency.
- Regression: new/updated posts are retrievable.

## Milestones
- M1: Vector Store initialized; indexing script PoC.
- M2: Search module complete (validated via curl).
- M3: Scheduled incremental indexing + monitoring/rate limiting.
- M4: Recall and reranking improvements (optional BM25 → semantic rerank).
