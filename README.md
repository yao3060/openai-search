# WordPress Semantic Search AI Search

基于 OpenAI Embeddings 和 Vector Stores 的 WordPress 内容语义搜索服务。

## 功能特性

- 🔍 **语义搜索**: 使用 OpenAI text-embedding-3-small 模型进行语义相似度搜索
- 📚 **Vector Store**: 基于 OpenAI Vector Stores 的高效向量存储和检索
- 🔄 **增量索引**: 支持 WordPress 文章的批量索引和更新
- 🎯 **相似度阈值**: 可配置的最小相似度阈值过滤
- 🛠️ **MCP 协议**: 支持 Model Context Protocol 集成

## 环境要求

- Node.js 18+
- OpenAI API 访问权限
- WordPress REST API 访问权限

## 安装配置

### 1. 安装依赖

```bash
npm install
```

### 2. 环境变量配置

复制并编辑 `.env` 文件：

```bash
# OpenAI 配置
OPENAI_API_KEY=your_openai_api_key
OPENAI_ORGANIZATION=your_org_id
OPENAI_PROJECT=your_project_id

# 向量检索配置
OPENAI_VECTOR_STORE_ID=wp_posts            # 已创建的 Vector Store ID
OPENAI_VECTOR_SEARCH_MODEL=gpt-4.1         # 用于 Responses+File Search 的模型（默认 gpt-4o-mini）
# （可选）若不支持 inline 绑定，请在 OpenAI 控制台预先创建并绑定到该 Vector Store 的 Assistant：
# OPENAI_VECTOR_ASSISTANT_ID=asst_...

# Embeddings（仅用于 legacy/备用流程）
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# WordPress 配置
WORDPRESS_POSTS_URL="https://your-site.com/wp-json/wp/v2/posts?per_page=100&page=1"

# 搜索配置
MIN_SIMILARITY=0.30
```

### 3. 构建索引（上传 JSON 到 Vector Store）

首次运行需要构建/上传索引：

```bash
node scripts/build-index-vs.js
```

这将：
- 从 WordPress REST API 获取文章并预处理
- 生成标准化的 JSON 文档
- 上传到 OpenAI Vector Store 以供 File Search 使用

## 使用方法

### 1) 运行搜索（JSON 输出）

```bash
node scripts/vs-search-cli.js "你的查询" --topk 5
```

输出形如：

```json
{
  "results": [
    { "title": "...", "link": "...", "snippet": "...", "sources": ["..."] }
  ]
}
```

说明：
- 使用 Responses API + File Search 访问你的 Vector Store。
- 若出现 inline 绑定不支持的错误，请设置 `OPENAI_VECTOR_ASSISTANT_ID`。

### 2) 清理存储

仅删除 Vector Store 中的 `.txt` 文件（不影响本地与 Files 存储）：

```bash
node scripts/cleanup-storage.js --vs-txt-only
```

更多选项：

```bash
node scripts/cleanup-storage.js --help
```

## 方案选择：托管检索 vs 本地 Embeddings

* **托管检索（推荐默认）** — `lib/vector_store_search.js` + Responses API `file_search`
  - 优点：端到端检索与结构化输出（严格 JSON），无需自建向量库与相似度/去重逻辑，可使用 `OPENAI_VECTOR_ASSISTANT_ID` 预绑定。
  - 适用：希望快速上线、少运维、直接对 OpenAI Vector Store 文档搜索。对应 CLI：`scripts/vs-search-cli.js`。

* **本地/私有检索（可选）** — `lib/search.js`（手写 embeddings + 相似度计算）
  - 优点：完全可控（阈值、重排、去重、缓存），可对接私有/自建向量数据库（如 pgvector/FAISS/Milvus/Pinecone 等），便于数据驻留与合规。
  - 适用：对数据治理与可观测性要求高，或需在私有环境运行。对应 CLI：`scripts/search-cli.js`。

提示：也可采用混合策略——先用本地 embeddings 做高召回，再将 TopN 交给模型进行总结/结构化输出。

## 故障排除

### 常见问题

1. **API Key 错误**
   - 检查 `.env` 文件中的 `OPENAI_API_KEY`
   - 确认 API Key 有效且有足够配额

2. **Vector Store 不存在**
   - 运行 `node scripts/build-index.js` 创建索引
   - 检查 `OPENAI_VECTOR_STORE_ID` 配置

3. **搜索结果为空**
   - 确认索引已成功构建
   - 调整 `MIN_SIMILARITY` 阈值
   - 检查查询词是否与内容相关

4. **WordPress 连接失败**
   - 验证 `WORDPRESS_POSTS_URL` 可访问
   - 检查 WordPress REST API 是否启用

### 调试

启用调试日志（示例，对 CLI 同样生效）：
```bash
DEBUG=* node scripts/vs-search-cli.js "AI 技术"
```

## 许可证

MIT License
