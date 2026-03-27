# Self-host Deployment (No-login Mode)

本文档用于把 Seedbox 以“自建服务 + 网页端/客户端手动连接”的方式落地。

如你要走 Docker 方式，参见 `docs/docker-deploy.md`。

## 1. 最小部署目标

1. 后端 API 常驻运行（`apps/backend`）
2. 解析 Worker 常驻运行（`apps/parser_worker`）
3. 网页端通过 `http://<host>:12333/app` 直接使用（默认免登录）
4. 客户端通过手动配置 `SEEDBOX_API_BASE_URL` 连接

## 2. 快速启动（内存模式）

```bash
cd /path/to/Seedbox
./scripts/dev-stack.sh up
./scripts/smoke-test.sh
./scripts/summary-smoke-test.sh
```

访问：

1. Web: `http://127.0.0.1:12333/app`
2. Health: `http://127.0.0.1:12333/v1/health`

### 2.1 无数据库持久化（memory + 文件快照）

如果你不想接 PostgreSQL，也可以让 `memory` 模式持久化：

```bash
cd /path/to/Seedbox/apps/backend
MEMORY_STORE_PERSIST_PATH=/data/memory-store.json \
MEMORY_STORE_PERSIST_DEBOUNCE_MS=800 \
STORE_DRIVER=memory \
PORT=12333 \
node dist/main.js
```

Docker 场景请把 `/data` 挂载到宿主机目录（例如 `./data/backend:/data`），否则删除容器后快照文件也会一起丢失。

## 3. 持久化部署（PostgreSQL）

```bash
cd /path/to/Seedbox/infra
docker-compose up -d

cd ../apps/backend
npm install
STORE_DRIVER=postgres npm run db:init
STORE_DRIVER=postgres npm run build
STORE_DRIVER=postgres PORT=12333 node dist/main.js
```

Worker（另一个终端）：

```bash
cd /path/to/Seedbox/apps/parser_worker
npm install
npm run build
WORKER_MODE=db API_BASE_URL=http://127.0.0.1:12333 node dist/main.js
```

## 4. 客户端连接

Flutter：

```bash
cd /path/to/Seedbox/apps/mobile_flutter
flutter pub get
flutter run --dart-define=SEEDBOX_API_BASE_URL=http://<your-host>:12333
```

Android 模拟器示例：

```bash
flutter run --dart-define=SEEDBOX_API_BASE_URL=http://10.0.2.2:12333
```

如开启了写入令牌（见第 7 节），移动端还需增加：

```bash
flutter run \
  --dart-define=SEEDBOX_API_BASE_URL=http://<your-host>:12333 \
  --dart-define=SEEDBOX_CLIENT_TOKEN=<your-client-token>
```

## 5. 运维建议

1. 用 `pm2` / `systemd` 托管 backend 与 worker
2. 在反向代理层（Nginx/Caddy）做 HTTPS
3. 定期备份 PostgreSQL
4. 使用 `GET /v1/health` 与 `GET /v1/health/errors` 做存活监控

## 6. 当前默认策略

1. Web/客户端默认免登录模式（`x-user-id`）
2. 仅在服务端启用商业模式时展示登录/订阅入口
3. 启用方式：`COMMERCIAL_MODE_ENABLED=true`（默认 `false`）

## 7. 可选：开启写入保护令牌（推荐公网部署）

后端可通过 `CLIENT_ACCESS_TOKEN` 要求所有写入请求携带 `x-client-token`（`POST/PUT/PATCH/DELETE`）。

启动示例：

```bash
cd /path/to/Seedbox/apps/backend
CLIENT_ACCESS_TOKEN=<your-client-token> PORT=12333 STORE_DRIVER=memory node dist/main.js
```

脚本联调示例：

```bash
cd /path/to/Seedbox
CLIENT_TOKEN=<your-client-token> ./scripts/smoke-test.sh
CLIENT_TOKEN=<your-client-token> ./scripts/summary-smoke-test.sh
```

Web 端（浏览器 Console）：

```js
localStorage.setItem("seedbox_client_token", "<your-client-token>");
location.reload();
```
