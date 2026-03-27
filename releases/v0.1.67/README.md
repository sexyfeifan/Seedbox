# Seedbox 📮✨

一个偏向 **小红书内容私藏** 的自部署收藏箱。  
它不只是保存链接，而是尽量把 **正文、图片、视频、作者信息、平台信息** 一起抓回来，长期留在你自己的服务和硬盘里。

---

## 🌟 软件介绍

- 适合收藏小红书旅行攻略、探店、摄影、穿搭、家居、灵感内容
- 也支持微博、抖音、豆瓣、知乎、Bilibili 等常见中文内容平台
- 支持图文、视频、混合内容抓取，并尽量保留正文原有排版
- 支持网页端浏览、编辑、重解析、归档、批量整理
- 支持 Docker / NAS / fnOS 自部署，适合长期私藏内容

一句话定位：

> **更适合私藏小红书内容的自部署收藏工具。**

---

## ✨ 核心能力

- **抓取分享链接**：支持直接粘贴 URL，也支持从整段分享文案里自动抽链
- **正文结构化保存**：提取标题、正文、作者、时间、标签、地点等信息
- **图片视频一起存**：支持图文、视频、混合媒体，并做缓存与下载兜底
- **更稳定的媒体访问**：针对易过期媒体做缓存，降低后续访问失效概率
- **重解析更平滑**：媒体 asset 使用稳定 ID，减少前端重解析后找不到资源
- **首页阅读体验更好**：列表卡片正文尽量保留原文段落结构
- **适合自建私藏**：支持挂载本地目录，把元数据、图片、视频都长期留在自己 NAS 上

---

## 🧱 项目结构

```text
.
├── README.md
├── apps
│   ├── backend                 # 后端 API + Web 页面
│   ├── parser_worker           # 解析 worker
│   └── mobile_flutter          # 移动端工程（当前正式发布以服务端为主）
├── docs                        # 补充说明文档
├── infra                       # 基础 compose / 模板
├── releases                    # 历史发布目录与 fnOS/NAS 部署产物
├── scripts                     # 构建、发布、回归脚本
└── packages                    # 共享类型与解析规则
```

---

## 🚀 最新版本

- 当前整理完成版本：`v0.1.67`
- Docker 镜像：
  - `sexyfeifan/seedbox-backend:v0.1.67`
  - `sexyfeifan/seedbox-parser-worker:v0.1.67`
- 最新发布目录：
  - `releases/v0.1.67/docker-compose.yml`
  - `releases/v0.1.67/docker-compose.annotated.yml`
  - `releases/v0.1.67/.env.template`

---

## 🐳 推荐部署方式（NAS / fnOS / Docker）

### 1）准备文件

推荐直接使用发布目录里的这 2 个文件：

- 中文注释版 compose：`releases/v0.1.67/docker-compose.annotated.yml`
- 中文注释版环境变量模板：`releases/v0.1.67/.env.template`

建议做法：

1. 把 `docker-compose.annotated.yml` 复制为 `docker-compose.yml`
2. 把 `.env.template` 复制为 `.env`
3. 把这两个文件放在同一个目录

### 2）重点修改这几项

#### `docker-compose.yml`

最重要的是这行卷挂载：

```yaml
- ./data/backend:/data
```

如果你在飞牛 NAS / 其他 NAS 上部署，建议改成你自己的持久化目录，例如：

```yaml
- /your/persistent/path/seedbox:/data
```

#### `.env`

至少建议改这几个变量：

- `INTERNAL_API_TOKEN`
- `CLIENT_ACCESS_TOKEN`
- `DOUBAN_COOKIE`（如果你需要豆瓣抓取更稳定）

### 3）启动

```bash
docker compose up -d
```

### 4）访问

- Web：`http://<你的IP或域名>:12333/app`
- 健康检查：`http://<你的IP或域名>:12333/v1/health`

如果你有反向代理，也可以走：

- `https://你的域名/app`

---

## 📝 compose / env 中文注释文件

仓库里已经整理好以下模板：

- 基础 fnOS compose：`infra/docker-compose.fnos.yml`
- 中文注释版 fnOS compose：`infra/docker-compose.fnos.annotated.yml`
- 中文注释版 env 模板：`infra/.env.template`

发布目录里也会同步生成同版本副本，方便直接部署。

---

## ⚙️ 参数修改注意事项

### 必改项

- `INTERNAL_API_TOKEN`
  - backend 和 parser-worker 必须一致
  - 用于服务间内部通信

- `CLIENT_ACCESS_TOKEN`
  - 如果你会公网访问，建议设置为非空
  - 设置后，网页端写操作需要带上这个 token

- `volumes: ...:/data`
  - 必须改成你真实想持久化的目录
  - 否则删容器时，元数据和缓存容易一起丢失

### 按需修改项

- `SEEDBOX_HOST_PORT`
  - 默认 `12333`
  - 如果端口冲突可改成别的，例如 `22333`

- `DOUBAN_COOKIE`
  - 只有你需要提升豆瓣抓取稳定性时再填
  - 如果值里包含 `$`，在 `.env` 中必须写成 `$$`

- `COMMERCIAL_MODE_ENABLED`
  - 自用部署一般保持 `false`

### 建议保持默认

- `ASSET_CACHE_DIR=/data/asset_cache`
- `SITE_ICON_CACHE_DIR=/data/site_icon_cache`
- `CAPTURE_RESOLVE_TIMEOUT_MS=12000`
- `ASSET_FETCH_TIMEOUT_MS=30000`
- `WORKER_POLL_INTERVAL_MS=3000`

---

## 💾 数据会保存到哪里

如果你的挂载是：

```yaml
- /your/persistent/path/seedbox:/data
```

那么常见数据会落到：

- 元数据：`/your/persistent/path/seedbox/memory-store.json`
- 图片/视频缓存：`/your/persistent/path/seedbox/asset_cache`
- 网站图标缓存：`/your/persistent/path/seedbox/site_icon_cache`

从 `v0.1.67` 开始，新抓到的媒体缓存会尽量直接保存成：

- `.jpg`
- `.png`
- `.webp`
- `.mp4`
- `.mov`
- `.m3u8`

更方便你在 NAS 里直接查看和整理。  
旧版本已经缓存下来的 `.bin` 文件仍然兼容，不需要手动清空。

---

## 🧪 常见问题排查与修复

### 1）`POST /v1/captures` 返回 `401`

原因：

- 你设置了 `CLIENT_ACCESS_TOKEN`
- 但浏览器网页端没有带上 token

修复：

浏览器打开网页后，在 Console 执行：

```js
localStorage.setItem("seedbox_client_token", "你的 CLIENT_ACCESS_TOKEN");
location.reload();
```

如果你不想启用写入保护，也可以把 `.env` 中的：

```env
CLIENT_ACCESS_TOKEN=
```

设为空后重启容器。

---

### 2）日志里反复出现 `POST /v1/internal/parser/claim 200`

这是 **正常现象**，不是报错。  
说明 parser worker 正在按轮询间隔向 backend 领取解析任务。

---

### 3）日志里出现 `/favicon.ico 404`

这是 **无关紧要的小问题**。  
浏览器会自动请求 favicon，但当前服务没有单独提供 `/favicon.ico` 路由，不影响抓取和使用。

---

### 4）Docker Compose 启动时提示一堆变量未设置，例如：

```text
The "o3" variable is not set. Defaulting to a blank string.
```

通常是因为你的 `DOUBAN_COOKIE` 里包含 `$`，例如：

```text
some_cookie=value$part1$part2
```

Compose 会把 `$xxx` 当环境变量替换。

修复方式：

把 `.env` 里的 `$` 改成 `$$`，例如：

```env
DOUBAN_COOKIE=some_cookie=value$$part1$$part2
```

这不会影响容器内真实 cookie 值。

---

### 5）怎么判断豆瓣 Cookie 还能不能用

可以直接抓一次豆瓣链接，然后看 parser 日志。

如果看到这类异常，通常说明 cookie 失效或被风控：

- `403`
- `429`
- `pow challenge`
- 返回明显登录页 / 风控页内容

如果没有这些问题，并且正文能正常抓回，说明 cookie 还在工作。

---

### 6）微博视频 / 某些媒体后来打不开

`v0.1.66` 开始已经对易过期媒体做了预缓存，问题相比之前小很多。  
如果历史条目是在更老版本抓的，可能仍然会遇到旧直链过期。

解决方法：

- 进入详情页重新解析一次
- 或删除后重新抓取

---

## 🧰 本地开发 / 调试

### 后端

```bash
cd /path/to/Seedbox/apps/backend
npm install
npm run build
PORT=12333 STORE_DRIVER=memory node dist/main.js
```

### parser worker

```bash
cd /path/to/Seedbox/apps/parser_worker
npm install
npm run build
WORKER_MODE=api API_BASE_URL=http://127.0.0.1:12333 node dist/main.js
```

### 访问

- Web：`http://127.0.0.1:12333/app`
- Health：`http://127.0.0.1:12333/v1/health`

---

## 📦 版本与发布

### `v0.1.67`

- 新抓取的媒体缓存直接落为真实扩展名，NAS 中更容易识别
- 保留对历史 `.bin` 缓存的兼容读取
- 统一发布脚本补齐中文注释版 compose 和 `.env.template`
- 清理并统一了 release / latest / runtime 相关模板

### `v0.1.66`

- 修复微博视频过期直链问题，解析完成后优先预缓存易过期素材
- 修复重解析资产抖动，媒体 asset 使用稳定 ID
- 首页卡片正文尽量保留原文段落结构
- README 与部署定位升级，明确“小红书内容私藏”方向

历史版本会保留在 `releases/` 目录中，方便回滚。

---

## 🔗 相关文件

- Docker 部署说明：`docs/docker-deploy.md`
- 自托管说明：`docs/self-hosting.md`
- 发布脚本：`scripts/release-unified.sh`
- fnOS 打包脚本：`scripts/release-fnos.sh`

---

如果你只是想 **最快部署最新版本**，直接看这三个文件就够了：

- `releases/v0.1.67/docker-compose.annotated.yml`
- `releases/v0.1.67/.env.template`
- `releases/v0.1.67/docker-compose.yml`
