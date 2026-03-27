# Local Testing Guide

## 1. 启动后端（默认内存模式，无需 Docker）

```bash
cd apps/backend
npm install
npm run dev
```

后端默认地址：`http://127.0.0.1:12333`

## 2. 启动解析 Worker（新终端）

```bash
cd apps/parser_worker
npm install
npm run dev
```

默认内部 token：`seedbox-dev-token`。如你自定义了 `INTERNAL_API_TOKEN`，worker 侧也要同步同名环境变量。

动态站点兜底（可选）：

1. `cd apps/parser_worker && npm install playwright`
2. 默认开启 `ENABLE_PLAYWRIGHT_FALLBACK=true`，命中低字数 + CSR 特征时会尝试浏览器渲染

## 3. 运行端到端烟雾测试（新终端）

```bash
cd /path/to/Seedbox
./scripts/smoke-test.sh
```

摘要能力专项烟雾（可选）：

```bash
cd /path/to/Seedbox
./scripts/summary-smoke-test.sh
```

计费专项烟雾（默认关闭，可选）：

```bash
cd /path/to/Seedbox
./scripts/dev-stack.sh restart
ENABLE_BILLING_SMOKE=1 ./scripts/billing-smoke-test.sh
```

如你自定义端口，记得传入 `API_URL`：

```bash
API_URL=http://127.0.0.1:3006 ./scripts/smoke-test.sh
```

如后端开启了 `CLIENT_ACCESS_TOKEN`，测试脚本同时传入 `CLIENT_TOKEN`：

```bash
CLIENT_TOKEN=<your-client-token> ./scripts/smoke-test.sh
CLIENT_TOKEN=<your-client-token> ./scripts/summary-smoke-test.sh
```

一键起停后端 + worker：

```bash
cd /path/to/Seedbox
./scripts/dev-stack.sh up
./scripts/dev-stack.sh status
./scripts/dev-stack.sh down
```

持续自动回归（适合 Codex 长时间执行）：

```bash
cd /path/to/Seedbox
./scripts/autopilot.sh loop
```

一次性全量回归（烟雾 + 解析 + 重复收藏）：

```bash
cd /path/to/Seedbox
./scripts/full-regression.sh
```

成功标准：

1. `smoke test passed`
2. `v1/items/:id` 最终状态为 `ready`
3. 列表与搜索接口均返回 200
4. 打开 `http://localhost:12333/app` 可直接在网页端创建和查看收藏
5. 网页端默认本地免登录模式（可直接新增、归档、摘要）
6. 在“已归档/全部”筛选下可使用“清空已归档”
7. `curl -H "x-internal-token: seedbox-dev-token" http://127.0.0.1:12333/v1/health/errors` 可返回错误统计
8. 网页端详情链接与正文在超长文本下不会出现横向溢出

## 4. PostgreSQL 模式（可选）

```bash
cd infra
docker-compose up -d

cd ../apps/backend
STORE_DRIVER=postgres npm run db:init
STORE_DRIVER=postgres npm run dev

cd ../parser_worker
WORKER_MODE=db npm run dev
```

## 5. Flutter 联调（可选）

```bash
cd apps/mobile_flutter
flutter pub get
flutter run
```

如果 `apps/mobile_flutter` 下还没有 `android/`、`ios/`，先执行：

```bash
cd /path/to/Seedbox
./scripts/bootstrap-mobile-platforms.sh
```

接入原生分享桥接（Android 自动可用，iOS 生成 Extension 模板）：

```bash
cd /path/to/Seedbox
bash ./scripts/enable-mobile-share-bridge.sh
```

Share 入口平台接入请参考：

1. `docs/mobile-share-bridge.md`

Android 模拟器示例：

```bash
flutter run --dart-define=SEEDBOX_API_BASE_URL=http://10.0.2.2:12333
```

移动端免登录验收：

1. 首次启动可直接进入收藏列表（无需验证码登录）
2. 可新增、归档、恢复并触发摘要
