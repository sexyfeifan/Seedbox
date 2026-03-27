# Seedbox

跨平台「收藏 + 稍后阅读 + AI 辅助」产品脚手架（PicSeed/Cubox 方向）。

## 1. 目标

- 客户端：`Flutter`（iOS / Android / Web / Desktop）
- 系统入口：`iOS Share Extension` + `Android Share Intent`
- 服务端：`Node.js`（建议 NestJS/Fastify）+ `PostgreSQL` + `Redis`
- 解析引擎：`Readability` + `Playwright` + 站点规则系统
- AI：摘要、关键词、标题重写、问答（按功能开关）

## 2. 仓库结构

```text
.
├── README.md
├── .gitignore
├── docs
│   ├── architecture.md
│   ├── module-boundaries.md
│   ├── database.sql
│   ├── api-v1.yaml
│   └── mvp-checklist.md
├── infra
│   ├── docker-compose.yml
│   └── env.example
├── apps
│   ├── mobile_flutter
│   │   └── README.md
│   ├── backend
│   │   └── README.md
│   └── parser_worker
│       └── README.md
└── packages
    ├── shared_types
    │   └── README.md
    └── parsing_rules
        └── README.md
```

## 3. 第一阶段落地顺序

1. 启动基础依赖（Postgres / Redis / MinIO）
2. 建表并跑通 `capture -> parse -> store -> list -> read`
3. 打通 Flutter 端收藏列表 + 详情页
4. 接入 AI 摘要（异步任务）
5. 做离线同步和冲突策略

## 4. 现在可直接做的事情

1. 先按 `docs/database.sql` 建库
2. 后端按 `docs/api-v1.yaml` 起首批接口
3. 客户端按 `docs/module-boundaries.md` 建 feature 模块
4. 解析 worker 按 `apps/parser_worker/README.md` 跑最小链路

## 5. 已落地的最小代码

- `apps/backend` 已提供可运行 Fastify API（captures/items/collections/billing/sync/health）
- `apps/parser_worker` 已提供可运行 Readability 解析骨架
- `apps/mobile_flutter` 已提供可运行列表页 + API 客户端骨架

## 6. 端到端测试

- 参考 `docs/local-testing.md`
- 自建落地参考：`docs/self-hosting.md`
- Docker 部署与发布：`docs/docker-deploy.md`
- 一键烟雾测试：`./scripts/smoke-test.sh`
- 摘要专项烟雾：`./scripts/summary-smoke-test.sh`
- 计费专项烟雾（默认关闭）：`ENABLE_BILLING_SMOKE=1 ./scripts/billing-smoke-test.sh`

最短路径（无 Docker）：

1. `cd apps/backend && npm install && npm run start:memory`
2. 新终端：`cd apps/parser_worker && npm install && npm run start:api`
3. 新终端：`./scripts/smoke-test.sh`
4. 浏览器打开 `http://localhost:3000/app` 使用网页端

可选安全加固（公网建议）：

1. 后端加 `CLIENT_ACCESS_TOKEN=<your-client-token>`
2. 脚本加 `CLIENT_TOKEN=<your-client-token>`
3. Web 端在浏览器 Console 执行 `localStorage.setItem("seedbox_client_token","<your-client-token>")` 后刷新

自动化脚本：

1. 一键起停开发栈：`./scripts/dev-stack.sh up|down|status`
2. 一次性自动回归：`./scripts/autopilot.sh once`
3. 持续循环回归：`./scripts/autopilot.sh loop`
4. Flutter 平台工程初始化：`./scripts/bootstrap-mobile-platforms.sh`

移动端 Share 通道接入说明：

1. 见 `docs/mobile-share-bridge.md`

网页端已支持：

1. 本地免登录直连（`x-user-id`，默认演示用户）
2. 粘贴整段分享文案自动提取链接（支持小红书文案）
3. 新增收藏支持“识别剪贴板”自动填充链接
4. 列表筛选（未归档/已归档/全部）
5. 详情高亮关键词
6. 归档与恢复
7. 列表多选后的批量归档/批量恢复
8. 详情高亮词按条目本地记忆
9. 清空已归档（永久删除）
10. 详情页异步摘要（生成/轮询状态/结果展示）
11. 解析结果图片素材回传（详情画廊预览）
12. 图片素材下载（后端按需本地缓存）
