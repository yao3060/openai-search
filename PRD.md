# PRD

## 目标（Goal）
- 构建一个 API 服务，使用 [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings) 对 WordPress 内容做“预嵌入 + 查询只嵌入”的语义搜索。
- 仅在“所提供的 WordPress 文章语料（corpus）”内检索与推荐；不做跨语料外推。
- 开发阶段仅使用 curl 进行测试，不提供 Next.js 集成代码。

## 范围（Scope）
- 从指定 WordPress 站点拉取文章，预处理与向量化，写入 OpenAI Vector Stores。
- 查询时仅对用户 query 进行一次 embedding，向量相似度检索 TopK，返回摘要/链接。

不在本期范围（Out of scope）
- 复杂问答生成（LLM 生成长答案）。
- 多站点聚合、跨语言机器翻译。

## 架构（Architecture）
- 内容源：WordPress REST API `wp-json/wp/v2/posts`（支持 ETag/If-Modified-Since）。
- 预处理/索引（Indexer）：清洗 HTML、（可选）分块、生成文档向量，写入 OpenAI Vector Stores。
- 向量存储（Vector Store）：OpenAI Vector Stores（内置存储、索引与检索）。
- 查询（Searcher）：接收查询、生成 query embedding，在 Vector Store 做 ANN 检索并返回结果。
- MCP Server：可用于调试；核心能力由索引与检索模块提供。

## Embeddings（概念与在本项目中的用法）
- 定义：将文本映射为高维向量（例如 1536 维），近义/相关文本的向量更接近。
- 度量：使用余弦相似度/向量距离衡量相关性（分数越高/距离越小越相关）。
- 本项目用法：
  - 索引阶段：对 WordPress 文章（可分块）生成 embedding，写入 Vector Store。
  - 查询阶段：对用户 query 生成一次 embedding，在 Vector Store 做 ANN 相似度检索取 TopK。
  - 阈值：若 Top1 分数低于 `MIN_SIMILARITY`（默认 0.30），返回“未找到足够相关的文章”。
- 模型：默认使用 `text-embedding-3-small`（1536 维，可通过 `OPENAI_EMBEDDING_MODEL` 覆盖）。

## OpenAI Vector Stores 设计
- 概念：Vector Store（库）→ Collection/Namespace（可选，逻辑分组）→ Data Items（文档/分块）。
- 环境变量：`OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_VECTOR_STORE_ID`（或运行时创建）。
- 字段建议：`post_id`, `chunk_id`, `title`, `excerpt`, `link`, `wp_date`, `content`（作为 data/metadata 存储）。
- 管理操作（curl 示例仅示意，实际以官方文档为准）：
  - 创建向量库：`POST /v1/vector_stores`
  - 上传/更新文档：`POST /v1/vector_stores/{store_id}/documents`
  - 检索：`POST /v1/vector_stores/{store_id}/query`

## 数据流程（Data Flow）
1) 索引阶段（定时/手动）：
   - 拉取文章（分页；条件请求减少下载）。
   - 清洗：`title + excerpt/content` 去 HTML、裁剪长度。
   - 分块（可选）：按段落/固定字数切分，保留 `post_id/chunk_id`。
   - 生成 embedding 或由 Vector Stores 端托管生成（推荐保持一致：`text-embedding-3-small`）。
   - Upsert 到 Vector Store（以 `post_id, chunk_id` 去重/覆盖）。
2) 查询阶段：
   - 生成一次 query embedding（或由查询接口托管生成）。
   - 在 Vector Store 做 ANN 检索（TopK）。
   - 阈值：若 Top1 分数低于 `MIN_SIMILARITY`（默认 0.30），返回“未找到足够相关的文章”。
   - 返回结果（标题、链接、摘要、score）。

## 开发与测试（curl-only）
- 创建一个 Vector Store（示例）：
```bash
curl https://api.openai.com/v1/vector_stores \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "wp-docs"
  }'
```
- 插入（或更新）文档/分块（示例）：
```bash
curl https://api.openai.com/v1/vector_stores/$OPENAI_VECTOR_STORE_ID/documents \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "id": "post-123-chunk-0",
        "text": "你的清洗后内容……",
        "metadata": {
          "post_id": 123,
          "chunk_id": 0,
          "title": "示例标题",
          "excerpt": "示例摘要",
          "link": "https://example.com/p/123",
          "wp_date": "2024-01-01T00:00:00Z"
        }
      }
    ],
    "embedding_model": "${OPENAI_EMBEDDING_MODEL:-text-embedding-3-small}"
  }'
```
- 相似度检索（示例）：
```bash
curl https://api.openai.com/v1/vector_stores/$OPENAI_VECTOR_STORE_ID/query \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "酒店早餐时间",
    "embedding_model": "${OPENAI_EMBEDDING_MODEL:-text-embedding-3-small}",
    "top_k": 10
  }'
```

## 模型与费用（Model & Cost）
- 模型：默认 `text-embedding-3-small`（可 `OPENAI_EMBEDDING_MODEL` 覆盖）。
- 成本：查询仅 1 次 embedding；索引期按新增/更新量计费；Vector Stores 存储/检索费用以 OpenAI 计费为准。

## 性能与缓存（Performance）
- ANN：由 OpenAI Vector Stores 托管；TopK 取决于库规模与配额。
- WordPress 抓取：条件请求 + 缓存（TTL 5–10 分钟）。

## 安全与配置（Security & Config）
- 环境变量：`OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_VECTOR_STORE_ID`, `MIN_SIMILARITY`。
- 速率限制与监控：记录请求量、耗时、得分分布、错误率（后续补充）。

## 组件与职责（Components）
- `scripts/build-index.ts`：抓取/清洗/分块/embedding/Upsert 到 OpenAI Vector Stores。
- `lib/search.ts`：query embedding + Vector Store ANN + 阈值判断 + 结果格式化。
- `index.js`（MCP）：调试入口，可复用 `lib/search.ts`。

## 部署（Deployment）
- 向量库：使用 OpenAI Vector Stores（无需自管数据库/索引）。
- 索引任务：本地 CRON / GitHub Actions / 任意定时器触发 `build-index`。

## 测试计划（Testing）
- 单元：清洗/分块/相似度。
- 集成：小规模索引→查询→校验 TopK 与阈值处理。
- 性能：并发 50/100，P95 延迟。
- 回归：新增/更新文章可被检索。

## 里程碑（Milestones）
- M1：完成 Vector Store 初始化与索引脚本 PoC
- M2：完成查询模块（curl 验证）
- M3：定时增量索引 + 监控/频控
- M4：优化召回与重排（可选 BM25→语义重排）