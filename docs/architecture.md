# Architecture

## 总体形态

系统采用三层：

1. 端侧（Flutter + 原生分享入口）
2. API 层（鉴权、内容管理、搜索、同步）
3. Worker 层（网页解析、AI 任务、媒体抓取）

## 核心数据流

1. 用户在任意 App 点击分享
2. Share Extension/Intent 将 URL + 元数据写入本地队列
3. 客户端调用 `POST /v1/captures` 入库
4. 后端创建解析任务并投递队列
5. Parser Worker 拉取网页，执行 `Readability` 或规则解析
6. 解析结果回写 `items/item_contents/item_assets`
7. 客户端通过列表/详情接口读取，支持离线缓存
8. 用户触发 AI 摘要，后端异步写回 `ai_summaries`

## 技术选型建议

- API: Node.js + NestJS + Fastify
- Queue: Redis + BullMQ
- DB: PostgreSQL（JSONB + FTS）
- Object Storage: MinIO（本地）/ S3（生产）
- Parser: Playwright + Readability + 自定义规则引擎
- AI: OpenAI/Anthropic（provider 抽象层）

## 可扩展点

- 站点规则热更新（`packages/parsing_rules`）
- AI 提供商切换（`ai_provider` 抽象）
- 多端同步冲突策略升级（LWW -> CRDT）
