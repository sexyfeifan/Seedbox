# parser_worker

解析工作进程（支持 API 模式和 DB 模式）。

## 当前已实现

1. 领取解析任务（默认通过 backend 内部 API）
2. 从 URL 抓取 HTML（带浏览器 UA）
3. 使用 Readability 提取正文
4. 动态站点可选 Playwright 兜底（命中低字数 + CSR 特征时触发）
5. 自动提取图片素材（DOM / OpenGraph / JSON-LD / URL Regex）
6. 回写解析结果（ready/failed，含 `assets`）

## 本地运行

```bash
cd apps/parser_worker
npm install
npm run dev
```

默认模式：`WORKER_MODE=api`，会轮询 `http://127.0.0.1:3000/v1/internal/parser/*`。

Playwright 兜底说明：

1. 默认开启：`ENABLE_PLAYWRIGHT_FALLBACK=true`
2. 关闭兜底可设置：`ENABLE_PLAYWRIGHT_FALLBACK=false`
3. 本地开发可执行：`npm install playwright`
4. Docker 版 parser 镜像已内置 Playwright 运行环境（用于动态站点兜底）
5. 对 `xhslink.com/xiaohongshu.com/weibo.com/instagram.com/douyin.com/zhihu.com` 等域名会更积极触发兜底

受限环境推荐直接用：

```bash
npm run start:api
```

如需直连数据库模式：

```bash
WORKER_MODE=db npm run dev
```

样例单次解析：

```bash
SAMPLE_JOB='{"jobId":"1","itemId":"1","sourceUrl":"https://example.com"}' npm run dev
```

## 下一步接入

1. 增加站点规则引擎（`packages/parsing_rules`）
2. 增加失败重试与熔断策略
