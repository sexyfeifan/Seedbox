# Mobile Share Bridge

本文档用于把系统分享链接接入 Flutter 的 `seedbox/share` 通道。

## 1) 一键接入（推荐）

```bash
cd /path/to/Seedbox
bash ./scripts/enable-mobile-share-bridge.sh
```

该脚本会自动完成：

1. 若 `android/` 和 `ios/` 不存在，先执行平台工程生成（等价 `bootstrap-mobile-platforms.sh`）
2. Android 注入 `MainActivity + ShareInbox + ShareTargetActivity`，并更新 `AndroidManifest.xml`
3. iOS 注入 `AppDelegate.swift` 的 `seedbox/share` 通道读取逻辑
4. 生成 `ios/ShareExtensionTemplate/`（包含 `ShareViewController.swift`、`Info.plist`、README）

可选环境变量：

1. `APP_GROUP_ID`（默认 `group.com.seedbox.app.share`）
2. `SHARED_URLS_KEY`（默认 `seedbox.shared_urls`）
3. `AUTO_BOOTSTRAP=0`（缺少平台工程时不自动生成）

## 2) Android 接入细节（脚本已自动处理）

目标：

1. 接收 `ACTION_SEND` 的文本/链接。
2. 暂存到内存队列。
3. Flutter 调用 `consumePendingUrls` 时取走。
4. App 前台时通过 `onSharedUrl` 主动推送。

自动生成文件：

1. `android/app/src/main/kotlin/.../MainActivity.kt`
2. `android/app/src/main/kotlin/.../ShareInbox.kt`
3. `android/app/src/main/kotlin/.../ShareTargetActivity.kt`
4. `android/app/src/main/AndroidManifest.xml`（追加 Share intent-filter）

通道约定：

1. Flutter -> Native: `consumePendingUrls` 返回 `List<String>`.
2. Native -> Flutter: `onSharedUrl` 参数为 URL 字符串。

## 3) iOS 接入细节（主 App 自动，Extension 需挂 target）

目标：

1. Share Extension 把 URL 写入 App Group 的共享容器。
2. 主 App 启动/恢复时读取并清空。
3. 通过 `seedbox/share` 通道返回给 Flutter。

脚本自动处理：

1. 更新 `ios/Runner/AppDelegate.swift`，实现 `consumePendingUrls`
2. 生成 `ios/ShareExtensionTemplate/` 模板代码

你需要在 Xcode 手动完成：

1. 新建 Share Extension target
2. 替换 Extension 的源文件和 `Info.plist` 为模板内容
3. 为 Runner + Share Extension 同时开启 App Groups（与脚本里的 `APP_GROUP_ID` 一致）

## 4) Flutter 侧已完成

已接入文件：

1. `lib/core/share/shared_capture_bridge.dart`
2. `lib/features/library/library_page.dart`

行为：

1. 启动与前台恢复时消费 `consumePendingUrls`。
2. 运行中可接收 `onSharedUrl` 推送。
3. 列表页显示“待导入分享链接”卡片，一键导入收藏。

## 5) iOS Xcode 挂接清单（逐步点击）

前提：

1. 已执行 `bash ./scripts/enable-mobile-share-bridge.sh`
2. 已生成 `ios/ShareExtensionTemplate/`

步骤：

1. 打开 `ios/Runner.xcworkspace`（必须是 workspace，不是 xcodeproj）。
2. 在左侧项目 `Runner` 上右键，选择 `New Target...`。
3. 模板选择 `Share Extension`，`Product Name` 建议填写 `ShareExtension`。
4. 新建后若弹窗询问是否 `Activate`，选择 `Cancel`（保持 Runner scheme）。
5. 在 `ShareExtension` target 的 `General` -> `Bundle Identifier` 设置为唯一值（例如 `com.seedbox.app.ShareExtension`）。
6. 在 `Signing & Capabilities` 给 `Runner` target 添加 `App Groups`，并添加与脚本一致的组：`group.com.seedbox.app.share`。
7. 在 `Signing & Capabilities` 给 `ShareExtension` target 也添加同一个 `App Groups`：`group.com.seedbox.app.share`。
8. 在 `ShareExtension` target 中删除默认生成的 `ShareViewController.swift`（或清空内容）。
9. 将 `ios/ShareExtensionTemplate/ShareViewController.swift` 拖入 Xcode，勾选 `ShareExtension` target。
10. 将 `ios/ShareExtensionTemplate/Info.plist` 替换 extension 当前 `Info.plist`（确保 `Build Settings` 的 `Info.plist File` 指向该文件）。
11. 确认 `ShareExtension` 的 `Build Settings` -> `Swift Language Version` 不为空（一般默认即可）。
12. 回到 `Runner` target 的 `Build Phases`，确认有 `Embed App Extensions` 阶段且包含 `ShareExtension.appex`（新建 target 后通常自动生成）。
13. 清理构建：`Product` -> `Clean Build Folder`，然后运行 `Runner`。

验收：

1. 先启动一次主 App（让 Flutter 页面初始化）。
2. 在 iOS Safari 打开任意网页，点击分享，选择你的 `ShareExtension`。
3. 回到主 App 的 Library 页，顶部应出现“待导入分享链接”卡片。
4. 点击导入后应转为正常收藏项（调用 `POST /v1/captures`）。

常见问题：

1. 分享后主 App 没看到链接：优先检查两个 target 的 `App Groups` 是否完全一致。
2. Extension 出现签名错误：检查 `Team` 是否为同一团队，且 extension 的 bundle id 不冲突。
3. 编译找不到 `ShareViewController`：确认文件已勾选 `ShareExtension` target membership。
4. 主 App 能运行但无法消费链接：确认 `ios/Runner/AppDelegate.swift` 已是脚本注入版本，并且 `APP_GROUP_ID` 与 Xcode 中一致。
