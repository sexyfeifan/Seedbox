# Docker 部署与 Docker Hub 发布

本文档用于把 Seedbox 以 Docker 方式运行，并发布镜像到 Docker Hub。

## 1. 本地一键运行（backend + parser worker）

```bash
cd /path/to/Seedbox
./scripts/docker-runtime.sh up
./scripts/docker-runtime.sh smoke
```

说明：`docker-runtime.sh smoke` 默认使用 `SMOKE_TEST_URL=http://host.docker.internal:12333/app`，确保 parser 容器可访问测试页面。
如果你的 Docker 环境不支持 `host.docker.internal`（常见于部分 Linux 环境），请手动指定可被容器访问的 URL。

访问：

1. `http://127.0.0.1:12333/app`
2. `http://127.0.0.1:12333/v1/health`

停止：

```bash
./scripts/docker-runtime.sh down
```

## 2. 可选写入保护（公网建议）

如果你希望写请求必须带 `x-client-token`：

```bash
cd /path/to/Seedbox
CLIENT_ACCESS_TOKEN=<your-client-token> ./scripts/docker-runtime.sh restart
```

然后测试脚本带上：

```bash
CLIENT_ACCESS_TOKEN=<your-client-token> ./scripts/docker-runtime.sh smoke
```

Web 端可在浏览器 Console 设置：

```js
localStorage.setItem("seedbox_client_token", "<your-client-token>");
location.reload();
```

## 2.1 可选开启商业模式（显示登录/订阅入口）

```bash
cd /path/to/Seedbox
COMMERCIAL_MODE_ENABLED=true ./scripts/docker-runtime.sh restart
```

说明：关闭（默认）时 Web 与 App 都不会显示邮箱登录/订阅入口。

## 3. 发布到 Docker Hub

先登录：

```bash
docker login
```

发布（示例版本号 `v0.1.1`）：

```bash
cd /path/to/Seedbox
DOCKERHUB_NAMESPACE=<your-dockerhub-username> VERSION=v0.1.67 ./scripts/docker-build-push.sh
```

默认会推送 4 个 tag：

1. `<username>/seedbox-backend:v0.1.67`
2. `<username>/seedbox-parser-worker:v0.1.67`
3. `<username>/seedbox-backend:latest`
4. `<username>/seedbox-parser-worker:latest`

## 4. 用 Docker Hub 镜像启动（不本地 build）

```bash
cd /path/to/Seedbox
NO_BUILD=1 \
BACKEND_IMAGE=<username>/seedbox-backend:v0.1.67 \
PARSER_IMAGE=<username>/seedbox-parser-worker:v0.1.67 \
./scripts/docker-runtime.sh up
```

## 5. fnOS 版本留存（保留历史版本目录）

发布新版本时可执行：

```bash
cd /path/to/Seedbox
./scripts/release-fnos.sh v0.1.33
```

该脚本会：

1. 生成 `releases/v0.1.33/README.md`
2. 生成 `releases/v0.1.33/docker-compose.yml`（镜像 tag 固定到 `v0.1.33`）
3. 生成 `releases/seedbox-v0.1.33-fnos.tar.gz`

默认不会覆盖已存在的历史版本目录，确保旧版本持续留存可回滚。

## 6. 统一版本发布（当前仅服务端）

当前阶段，正式发布统一走以下规则：

1. 暂停移动端版本发布，正式版本仅发布 backend/parser。
2. 服务端镜像版本（backend/parser）与 release compose 的 tag 必须一致。
3. 正式发布必须同时完成：
   - 推送服务端镜像到 Docker Hub
   - 生成 `releases/vX.Y.Z/docker-compose.yml`

推荐使用统一发布脚本：

```bash
cd /path/to/Seedbox
DOCKERHUB_NAMESPACE=<your-dockerhub-username> ./scripts/release-unified.sh v0.1.67
```

可选参数：

1. 跳过 Docker 推送（仅本地演练）：`SKIP_DOCKER_PUSH=1`
2. 强制覆盖当前版本目录：`FORCE_OVERWRITE=1`

发布前可先执行版本一致性检查：

```bash
./scripts/check-unified-version.sh
```
