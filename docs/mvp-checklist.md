# MVP Checklist (12 Weeks)

## Milestone 1 (Week 1-3): Capture + Library

- [ ] Flutter 项目初始化（路由、状态管理、网络层）
- [ ] iOS Share Extension 可把 URL 传给主 App（已提供 `scripts/enable-mobile-share-bridge.sh` 与 iOS Extension 模板，待在 Xcode 完成 target 挂接）
- [ ] Android Share Intent 可把 URL 传给主 App（已提供 `scripts/enable-mobile-share-bridge.sh` 自动注入，待本机执行并验收）
- [x] `POST /v1/captures` 可写入 items + parser_jobs
- [x] 列表接口可返回解析状态（queued/parsing/ready/failed）

## Milestone 2 (Week 4-6): Parsing + Reading

- [x] Worker 跑通 Readability 静态网页提取
- [x] Playwright 解析动态站点兜底（已接入可选兜底逻辑，需安装 `playwright` 启用）
- [x] 详情接口返回正文（html/markdown/plain text）
- [x] 标签与收藏夹可管理（后端已支持标签与收藏夹 CRUD；客户端交互可继续增强）
- [x] 搜索接口可按关键词召回

## Milestone 3 (Week 7-9): Sync + Offline

- [x] 客户端本地缓存（当前实现为 `shared_preferences`，后续可升级 SQLite/Drift）
- [x] `sync/push` + `sync/pull` 跑通增量同步
- [x] 冲突策略（LWW）落地（客户端同条目队列 LWW 合并 + 服务端 `clientTs` 比较 + `opId` 幂等）
- [x] 断网新增/编辑可恢复上传（新增、归档/恢复/删除/清空已支持入队恢复）

## Milestone 4 (Week 10-12): AI + Polish

- [x] 摘要接口异步任务化
- [x] 摘要结果回写并可在详情页展示
- [x] 高亮/笔记基础能力（后端 API 已支持 `highlights/notes` 的增删改查；客户端交互待增强）
- [x] 监控与错误上报（请求/进程错误采集、内部错误统计接口，Sentry 可选接入）
- [x] 订阅/计费最小闭环（后端 mock 方案保留，当前客户端默认隐藏订阅入口）
