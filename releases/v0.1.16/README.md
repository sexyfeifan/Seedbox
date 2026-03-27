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

## v0.1.12 更新

1. 网页端改为统一卡片流样式，移除内容流/画廊双模式分裂
2. 卡片正文新增自动截断与“展开查看”提示，避免长文撑破布局
3. 点击卡片进入单条详情页路由（`/app?item=<id>`），支持浏览器前进/后退
4. 桌面与手机端自动适配：手机详情全屏、桌面详情独立页面
5. PWA 缓存版本升级，减少旧前端缓存导致的遮罩层残留问题

## v0.1.13 更新

1. 主页面弱化新增入口，仅保留中下部“识别剪贴板新增收藏”按钮
2. 点击按钮优先自动识别剪贴板，识别失败/权限受限时弹窗手动粘贴
3. 详情页拆分为“浏览页 / 修改页”双模式（`/app?item=<id>&mode=edit`）
4. 浏览页仅保留内容阅读与“灵感笔记”新增能力
5. 标签编辑、归档恢复、永久删除与图片下载统一收敛到修改页

## v0.1.14 更新

1. 桌面端首页改为全宽瀑布流，修复右侧大面积留白问题
2. 卡片结构升级：作者行、主题标题、正文摘要、九宫格图片、底部元信息
3. 单卡详情页按 PicSeed 风格优化，浏览页默认展示单卡正文与图片，底部保留编辑入口图标按钮
4. 新增收藏后不再自动跳入详情/编辑，直接返回收藏首页并后台继续解析刷新
5. 剪贴板识别增加 iOS 兜底：读取失败时自动弹手动粘贴提示，提升 iPhone Chrome 可用性
6. iOS 安装引导增强：安装按钮在 iOS 设备可见，并给出 Safari / Chrome 差异化提示

## v0.1.15 更新

1. 卡片正文支持“展开/收起”，点击展开只在当前页展开，不再误跳详情
2. 主列表彻底收口为浏览模式：批量归档/恢复与清空入口隐藏，编辑仅保留在单条详情的编辑页
3. 详情页结构调整为 PicSeed 风格顺序：来源作者行、标题、正文、媒体、灵感笔记
4. 素材区升级为“图片 + 视频”统一媒体面板，编辑模式支持下载链接
5. 新增 `抖音` 平台识别（前后端平台标签与筛选同步）
6. 解析引擎增强：增加多站点专用提取分支（小红书/抖音/微博/知乎/豆瓣）与视频 URL 提取
7. 链接提取增强：修复安卓分享文案中混合文本导致 `xn--` 异常 URL 的误识别

## v0.1.16 更新

1. 卡片来源行升级：头像位支持真实图片兜底（优先作者头像字段，回退封面图），并保留文字头像回退
2. 新增平台小圆标叠层（小红书/抖音/微博/知乎/豆瓣/Instagram/X 等），更接近 PicSeed 的来源识别体验
3. 详情页来源头部同步头像+平台标识，主列表与详情视觉语义保持一致
4. Service Worker 缓存版本升级，确保本轮头像与布局样式可及时刷新
5. 回归测试通过：基础收藏解析、摘要链路、分享文案链接提取均正常
