# backend

最小可运行 API 服务（Fastify + TypeScript）。

当前已实现模块：

1. `auth`：`/v1/auth/request-code`、`/v1/auth/verify-code`、`/v1/auth/refresh`、`/v1/auth/whoami`
2. `captures`：`POST /v1/captures`
3. `items`：列表、详情、更新、归档、搜索
4. `items`：永久删除、清空已归档
5. `annotations`：高亮与笔记（`/v1/items/:itemId/highlights*`、`/v1/items/:itemId/notes*`）
6. `items`：摘要异步任务（`POST /v1/items/:itemId/summary`、`GET /v1/items/:itemId/summary`）
7. `collections`：收藏夹管理（`/v1/collections*`）
8. `billing`：订阅与计费最小闭环（后端保留，当前 Web/移动端默认隐藏）
9. `sync`：`/v1/sync/pull`、`/v1/sync/push`
10. `health`：`GET /v1/health`
11. `observability`：错误采集（请求/进程）与内部统计（`GET /v1/health/errors`）
12. `items`：素材回传与下载缓存（`assets` 字段 + `GET /v1/items/:itemId/assets/:assetId/file`）

说明：默认使用内存存储（零依赖便于联调）。可通过 `STORE_DRIVER=postgres` 切换到 PostgreSQL。
如需在 `memory` 模式下持久化（不引入数据库），可设置：

1. `MEMORY_STORE_PERSIST_PATH=/data/memory-store.json`
2. `MEMORY_STORE_PERSIST_DEBOUNCE_MS=800`（可选，单位毫秒）

服务会在启动时自动加载快照，并在写入后自动落盘；容器场景请把 `/data` 挂载到宿主机目录。

`sync/push` 当前支持的操作语义：

1. `create_capture`
2. `archive`
3. `restore`
4. `permanent_delete`
5. `purge_archived`

并且支持 `opId` 幂等去重（同一用户重复提交相同 `opId` 不会重复执行）。
当操作 payload 带 `clientTs`（ISO 时间）时，服务端会按 LWW 策略拒绝过旧写入（体现在 `rejected` 计数）。

摘要能力说明：

1. `POST /v1/items/:itemId/summary` 会创建异步摘要任务，返回 `queued/running/ready/failed` 状态。
2. `GET /v1/items/:itemId/summary` 可轮询摘要状态与结果。
3. `GET /v1/items/:itemId` 已内联返回摘要字段：`summaryStatus/summaryText/summaryKeyPoints` 等。

素材缓存说明：

1. parser 回写结果可附带 `assets`（图片/视频/文件 URL），服务端会写入 `item_assets`。
2. `GET /v1/items/:itemId` 会返回 `assets` 列表，包含 `previewUrl/downloadUrl`。
3. `GET /v1/items/:itemId/assets/:assetId/file` 会按需下载并缓存素材到本地（默认目录 `.runtime/asset_cache`）。
4. 默认拦截内网地址（避免 SSRF）；如需本地调试内网素材，可设置 `ASSET_FETCH_ALLOW_PRIVATE=true`。

监控与错误上报说明：

1. 默认开启错误采集（请求级、启动级、进程级），并写入后端日志。
2. 可选接入 Sentry：安装 `@sentry/node` 并设置 `SENTRY_DSN`。
3. 内部错误统计接口：`GET /v1/health/errors`（需 `x-internal-token`）。

计费最小闭环说明（Mock）：

1. `GET /v1/billing/plans` 返回可订阅计划（free/pro_monthly）。
2. `GET /v1/billing/subscription` 返回当前订阅与权益（entitlements）。
3. `POST /v1/billing/subscribe` 可开通 Pro（月付，模拟支付通道）。
4. `POST /v1/billing/cancel` 可取消订阅（保留至当前周期结束）。

如你使用 PostgreSQL 且是存量库，建议补一条索引提升去重查询性能：

```sql
CREATE INDEX IF NOT EXISTS idx_sync_events_user_op_id
  ON sync_events(user_id, ((payload->>'opId')))
  WHERE payload ? 'opId';
```

## 本地启动

```bash
cd apps/backend
npm install
npm run dev
```

如果你在受限环境里遇到 `tsx watch` 权限问题，可直接用：

```bash
npm run start:memory
```

如需 PostgreSQL：

```bash
STORE_DRIVER=postgres npm run db:init
STORE_DRIVER=postgres npm run dev
```

默认启动在 `http://localhost:3000`。

网页端入口：`http://localhost:3000/app`
网页端默认使用本地免登录模式（`x-user-id`），可直接新增/归档/摘要。
`POST /v1/captures` 支持从整段分享文案中自动提取第一个 `http/https` 链接（例如小红书分享文案）。

可选写入保护：

1. 设置 `CLIENT_ACCESS_TOKEN=<your-client-token>` 后，所有写请求（`POST/PUT/PATCH/DELETE`）都需要 `x-client-token`。
2. Web 端可在浏览器 Console 执行 `localStorage.setItem("seedbox_client_token","<your-client-token>")` 并刷新。

## 快速验证

```bash
# 1) 健康检查
curl http://localhost:3000/v1/health

# 2) 创建收藏（免登录模式，带 x-user-id）
curl -X POST http://localhost:3000/v1/captures \
  -H "content-type: application/json" \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001" \
  -d '{"sourceUrl":"https://example.com/article","titleHint":"Example","tags":["demo"]}'

# 3) 列表
curl "http://localhost:3000/v1/items?limit=20" -H "x-user-id: 00000000-0000-0000-0000-000000000001"

# 4) 搜索
curl "http://localhost:3000/v1/search?q=example" -H "x-user-id: 00000000-0000-0000-0000-000000000001"

# 5) 增量同步
curl -X POST http://localhost:3000/v1/sync/pull \
  -H "content-type: application/json" \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001" \
  -d '{"sinceEventId":0}'

# 6) 永久删除单条
curl -X DELETE http://localhost:3000/v1/items/<item-id>/permanent \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001"

# 7) 清空已归档
curl -X POST http://localhost:3000/v1/items/purge-archived \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001"

# 8) 触发摘要任务
curl -X POST http://localhost:3000/v1/items/<item-id>/summary \
  -H "content-type: application/json" \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001" \
  -d '{}'

# 9) 查询摘要状态
curl http://localhost:3000/v1/items/<item-id>/summary \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001"

# 10) 创建高亮
curl -X POST http://localhost:3000/v1/items/<item-id>/highlights \
  -H "content-type: application/json" \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001" \
  -d '{"quote":"important quote","color":"yellow"}'

# 11) 创建笔记
curl -X POST http://localhost:3000/v1/items/<item-id>/notes \
  -H "content-type: application/json" \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001" \
  -d '{"title":"My Note","bodyMd":"# note body"}'

# 12) 创建收藏夹
curl -X POST http://localhost:3000/v1/collections \
  -H "content-type: application/json" \
  -H "x-user-id: 00000000-0000-0000-0000-000000000001" \
  -d '{"name":"Inspiration","sortOrder":10}'

# 15) 查看错误统计（内部接口）
curl http://localhost:3000/v1/health/errors \
  -H "x-internal-token: seedbox-dev-token"

# 14) 查看可订阅计划（可选）
curl http://localhost:3000/v1/billing/plans

# 15) 订阅 Pro（月付 mock，可选）
curl -X POST http://localhost:3000/v1/billing/subscribe \
  -H "content-type: application/json" \
  -H "authorization: Bearer <access-token>" \
  -d '{"plan":"pro_monthly","provider":"mock"}'

# 16) 查询当前订阅（可选）
curl http://localhost:3000/v1/billing/subscription \
  -H "authorization: Bearer <access-token>"
```
