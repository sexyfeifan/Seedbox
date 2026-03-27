# mobile_flutter

Flutter 客户端（iOS / Android / Web / Desktop）。

## 初始功能目标

1. 收件箱列表（按解析状态展示）
2. 详情阅读（HTML/Markdown 渲染）
3. 标签筛选 + 搜索
4. 本地离线缓存 + 同步

## 建议技术

- `flutter_riverpod`（状态管理）
- `dio`（网络）
- `drift` 或 `isar`（本地存储）
- `go_router`（路由）

## 与原生桥接

- iOS: Share Extension -> App Group -> 主 App 读取
- Android: ACTION_SEND -> MethodChannel -> Flutter 层处理

## 当前已落地

1. `lib/main.dart` + `lib/app.dart` 基础入口
2. `AuthController`（默认本地免登录会话，可按需启用验证码登录）
3. 会话本地持久化（`shared_preferences`，重启自动恢复）
5. `LibraryPage` 列表页（拉取 `/v1/items`，支持筛选/搜索、左右滑归档/恢复、多选批量归档/恢复/永久删除）
6. `LibraryPage` 新增收藏弹窗（调用 `POST /v1/captures`）
7. `ItemDetailPage` 详情页（调用 `GET /v1/items/:id`，支持归档/恢复、上一条/下一条跳读、关键词高亮与本地记忆、复制/打开链接）
8. `SeedboxApiClient`（Dio + Bearer Token）
9. `ItemSummary` / `ItemDetail` / `AuthSession` 模型
10. 已归档清理：支持一键清空全部已归档（永久删除）
11. 基础同步：本地记录操作队列（新增/归档/恢复/删除），支持“立即同步”及启动/回到前台自动触发 `sync/push + sync/pull`
12. 同步失败重试：失败后自动指数退避重试（30s 起，最高 5 分钟）
13. 队列可视化：列表页展示待同步操作数、同步游标、最近错误与自动重试状态
14. 离线回退：列表与详情请求失败时自动读取本地缓存；启动时网络不可用可保留离线登录态
15. 队列去重：同一条目在本地多次归档/恢复/删除会按 LWW 只保留最后一次操作
16. 离线新增/编辑：新增收藏、归档/恢复/删除/清空在离线时可入同步队列，网络恢复后通过 `sync/push` 补写到服务端
17. 冲突消解：同步操作自动携带 `clientTs`，服务端按 LWW 拒绝过旧写入
18. 详情摘要：支持一键触发异步摘要任务并展示 `queued/running/ready/failed` 状态、要点和摘要正文
19. Share 桥接（Dart 侧）：已支持 `seedbox/share` MethodChannel 消费待分享 URL，并在列表页一键导入收藏
20. 订阅功能：后端接口保留，当前客户端默认不展示订阅入口
21. 分享文案提取：支持从整段分享文本中自动提取首个 `http/https` 链接（避免 400）

## 本地运行

```bash
cd apps/mobile_flutter
flutter pub get
flutter run
```

平台工程初始化（当 `android/`、`ios/` 还不存在时）：

```bash
cd /path/to/Seedbox
./scripts/bootstrap-mobile-platforms.sh
```

一键接入原生 Share（推荐）：

```bash
cd /path/to/Seedbox
bash ./scripts/enable-mobile-share-bridge.sh
```

平台侧 Share 接入说明：

1. 参见 `docs/mobile-share-bridge.md`
2. 完成后即可通过系统“分享”把 URL 推入主 App 待导入队列

联调说明：

1. iOS 模拟器可用 `http://127.0.0.1:3000`
2. Android 模拟器运行示例：

```bash
flutter run --dart-define=SEEDBOX_API_BASE_URL=http://10.0.2.2:3000
```

如后端开启 `CLIENT_ACCESS_TOKEN`，需额外传入：

```bash
flutter run \
  --dart-define=SEEDBOX_API_BASE_URL=http://10.0.2.2:3000 \
  --dart-define=SEEDBOX_CLIENT_TOKEN=<your-client-token>
```

同步联调建议：

1. 在列表中新增/归档/恢复/删除若干条内容（会写入本地操作队列）
2. 点击右上角“立即同步”按钮
3. 预期提示：`同步完成：上传 X（拒绝 Y），下行 Z`

离线联调建议：

1. 联网状态下先打开列表和若干详情页（让缓存落地）
2. 关闭后端服务或断网后下拉刷新
3. 预期：列表/详情可从本地缓存回退展示，顶部仍保留登录态并可见离线提示
