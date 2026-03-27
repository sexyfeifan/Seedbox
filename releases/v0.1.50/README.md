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
- 多站点解析回归：`./scripts/parser-regression.sh`
- 全量回归（烟雾 + 解析 + 重复收藏）：`./scripts/full-regression.sh`
- 历史噪音资源清理（可选）：`./scripts/cleanup-noise-assets.sh`

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
5. fnOS 版本留存打包：`./scripts/release-fnos.sh v0.1.33`（会新增 `releases/v0.1.33` 与对应 tar 包，不覆盖历史版本）
6. 历史噪音资源排查：`DRY_RUN=1 ./scripts/cleanup-noise-assets.sh`

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
13. 商业模式开关：服务端启用 `COMMERCIAL_MODE_ENABLED=true` 后显示 Web 登录/订阅入口
14. 账号与订阅弹层：邮箱验证码登录、订阅刷新、开通/取消 Pro
15. 诊断面板展示媒体过滤摘要（噪音图/风控图过滤统计）

## v0.1.22 更新

1. 头像角标样式优化：移除椭圆底，统一为圆形平台 logo。
2. 卡片首行展示优化：优先显示博主名；缺失时使用“平台名 + 博主”兜底，不再显示网站域名。
3. 侧栏筛选弱化：统计简化为单行“已捕获 N”，筛选按钮改为弱化文本风格。
4. 媒体预览升级：视频与图片统一支持浮窗查看，详情页不再跳转新窗口观看视频。
5. 卡片媒体布局升级：支持图/视频混排九宫格预览。
6. 文本清洗增强：正文与标签进一步剔除话题符号、`x天前/地区`污染信息。
7. 解析增强：扩展站点 JSON 载荷识别、字段映射、视频 URL 特征识别、动态回退触发判定。
8. Parser 运行可观测性增强：新增静态/Playwright 两阶段解析日志（字数、图片数、视频数、parser 版本）。
9. 新增解析回归脚本：`./scripts/parser-regression.sh`，可批量跑多站点链路检测。

## v0.1.23 更新

1. 文本清洗继续加强：正文去除 `#标签标识`，并清理 `x天前/地区` 等尾部污染字段。
2. 标签清洗增强：自动移除标签里的时间和地域残留（如 `MacMini4天前`）。
3. 首页策略调整：默认展示全部收藏，弱化归档筛选区，仅保留“已捕获 N”核心统计。
4. 桌面端浏览优化：无路由选中时自动打开首条收藏，避免右侧大面积空白。
5. 详情页笔记区简化：去除冗余标题层级，仅保留直接记录灵感的输入区与列表。
6. 解析器新增作者抽取通道：从 meta/script/json 中提取 `nickname/author/screen_name` 等字段。
7. 解析器补强多平台键位：扩展微博/知乎/抖音/豆瓣常见正文与视频字段命中率。
8. 动态站点回退覆盖面扩展：补充 `weibo.cn / douban / bilibili` 的 Playwright 回退触发。

## v0.1.24 更新

1. 头像展示纠偏：不再误用正文首图作为头像，仅在识别到头像特征 URL 时才使用图片头像。
2. 头像回退策略优化：未命中博主头像时回退为稳定字母头像 + 圆形平台角标，避免视觉错位。
3. fnOS compose 默认镜像标签升级到 `v0.1.24`，与本轮最终代码一致。

## v0.1.25 更新

1. 修复媒体警告占位图混入：新增占位资源识别规则，过滤 `warning/loading/placeholder/default` 类无效图片。
2. 修复视频重复与可播放性问题：增强视频 URL 去重与可播放筛选，优先保留高质量直链，减少重复条目。
3. 修复自动刷新闪屏：改为“仅待解析任务时轮询 + 数据变化才重绘”，轮询间隔由 4s 调整为 12s。
4. 增加定位展示：从原文提取位置标签，在卡片与详情时间行展示 `📍坐标`。
5. 清理正文噪音词：过滤“加载中”“编辑于*”等非正文残留。
6. 恢复博主头像链路：解析阶段保留头像资源，接口返回 `authorAvatarUrl`，并从画廊素材中排除头像。

## v0.1.26 更新

1. 新增手动重试解析：详情编辑页增加“重新解析”按钮，失败条目可一键重新入队。
2. 新增解析诊断接口：`GET /v1/items/:itemId/diagnostics` 返回最近任务状态、重试次数、错误信息与更新时间。
3. 新增重试接口：`POST /v1/items/:itemId/reparse`，自动处理“已有任务运行中/无任务时新建队列”两种情况。
4. 详情接口增强：`GET /v1/items/:itemId` 增加 `parserDiagnostics`，前端打开详情即显示诊断信息。
5. 前端新增解析诊断面板：编辑页可实时查看“状态/重试次数/错误”，并支持手动刷新。
6. 兼容免数据库模式：`InMemoryStore` 同步支持 diagnostics/reparse，开发与 fnOS 本地模式行为一致。

## v0.1.27 更新

1. 修复图片解析误捕视频：修正图片正则，避免将 `mp4/m3u8` 链接误识别为图片（对应“MP4 File”污染问题）。
2. 强化视频去重键：视频去重改为优先提取稳定媒体 ID，减少同视频多条重复入库。
3. 小红书分享文案清洗升级：自动移除 URL 尾部 `复制后打开/查看笔记` 等分享附加文本。
4. 新增短链解包：捕获 `xhslink.com` 时先跟随重定向，优先落地为标准 `xiaohongshu.com/discovery/item/{id}`，降低重复收藏。
5. 前端卡片媒体容错：列表/详情的图片和视频加载失败时自动隐藏坏媒体，避免遮挡与破图影响操作。
6. 列表去重展示升级：前端按 `canonical/xhs-note-id` 聚合同内容项，默认只展示最新一条。
7. 桌面布局优化：提高主内容区占比并扩展大屏卡片列宽，减少右侧留白感。

## v0.1.28 更新

1. 解析器抗噪增强：新增“加载中 / 编辑于 / 展开 / 收起 / 全文 / 更多”等噪音行与内联噪音词清洗。
2. 小红书元信息剔除增强：正文清洗顺序调整为“先去除 `x天前/地区`，再去除 `#tag`”，避免残留地区词污染正文。
3. 标签净化增强：进一步剔除尾部时间与地域残留（如 `#MacMini4天前` → `MacMini`）。
4. 图片候选排序升级：按清晰度/尺寸/站点特征打分，优先保留内容图，降低图标类噪音素材命中。
5. 头像链路增强：解析结果优先保留头像候选，提升 `authorAvatarUrl` 命中稳定性。
6. 视频去重增强：小红书视频按 host+path 去重，压缩同视频多 query 变体导致的重复。
7. Web 端抗闪屏优化：`resize` 改为阈值 + `requestAnimationFrame` 节流，减少移动端地址栏变化引发的频繁重绘。
8. 列表变更指纹优化：移除 `updatedAt` 触发项并引入摘要/媒体计数指纹，降低无效刷新。
9. UI 细节优化：平台角标去除椭圆底，仅保留圆形 logo；详情页默认隐藏源地址文本，聚焦内容浏览。

## v0.1.29 更新

1. 捕获链路修复：`resolveCaptureSourceUrl` 改为返回“可访问原始链接”，不再过早去掉小红书 `xsec_token` 等参数，提升真实正文命中率。
2. 去重与抓取兼容并存：收藏仍按 canonical note-id 去重，但解析任务使用保留参数的 source URL，避免“去重正确但抓取失败”。
3. `xhslink` 解包增强：短链展开后保留最终查询参数并清理尾部分享文案，进一步减少“页面不存在/命中协议页”。
4. 静态抓取增强：新增多 UA（桌面+移动）与多语言请求组合，并加入请求超时控制，提高微博/知乎/抖音/豆瓣等站点首轮命中率。
5. Playwright 抓取增强：支持移动端模式开关、统一 referer/accept-language 头，改善反爬场景下的可访问性。
6. 解析字段扩展：补充更多视频与文本字段键位（`mp4_hd_url/play_url/playback_url/text_raw/...`），提升多站视频与正文提取能力。
7. 媒体噪音过滤增强：扩展占位图关键词（含 `mp4-file/exclamation/alert` 等），减少异常警告图被当作正文媒体。
8. 自动刷新体验优化：只在详情状态或媒体数量真正变化时刷新详情，显著降低“持续闪屏感”。
9. 视频浮窗容错增强：浮窗视频启用 controls，并在加载失败时给出明确提示，避免黑屏无反馈。

## v0.1.30 更新

1. 根因修复（重复收藏场景）：同 canonical 链接再次收藏时，现在会强制更新 `source_url/canonical_url/domain`，不再沿用旧错误链接。
2. 重采集可生效：重复收藏命中去重键时会重新置为 `queued` 并重新入队解析，解决“老错误结果无法被新链接覆盖”。
3. 同步通道一致修复：`create_capture` 的同步写入路径同步应用上述更新逻辑，避免多端场景继续使用旧 URL。
4. 详情/卡片展示兜底：正文清洗后为空时，自动回退显示标题主题，避免内容区空白。

## v0.1.31 更新

1. 生产容器修复：`parser_worker` 镜像内补装 Playwright Chromium + headless-shell，修复容器中动态解析回退不可用问题。
2. 根因闭环：修复 `browserType.launch: Executable doesn't exist` 导致的回退失效，避免小红书等动态站点退化成法务/空页面内容。
3. 部署侧无感升级：保持现有环境变量不变，替换镜像标签即可启用动态解析能力恢复。

## v0.1.32 更新

1. 小红书登录墙回退纠偏：新增“登录/扫码/协议页”识别规则，禁止 Playwright 登录墙结果覆盖静态命中的有效图文媒体。
2. 小红书回退策略优化：若静态解析已命中有效媒体且非协议/登录噪声，则不再强制触发 Playwright，减少误降级。
3. 捕获入口增强：新增分享文案标题提取，支持从 `【...】` 一键抽取 `titleHint`，避免标题退化为登录页文案。
4. 主题标题净化增强：新增登录墙关键词过滤，`deriveTopicTitle` 不再接受“登录后推荐更懂你的笔记”等无效标题。
5. 真实链接回归验证：针对你提供的两条小红书链接完成容器端验证，结果不再落入备案/登录协议正文，媒体与标签可入库。
