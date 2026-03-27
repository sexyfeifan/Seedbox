# Module Boundaries

## 1. apps/mobile_flutter

职责：

- 分享入口后的收件箱展示
- 收藏列表、详情阅读、标签过滤、搜索
- 本地离线缓存与同步

边界：

- 不直接做网页解析
- 不直接访问数据库
- 仅通过 API/Sync 协议访问服务端

建议目录：

```text
lib/
  core/            # 网络、存储、鉴权、错误处理
  features/
    capture/
    library/
    reader/
    highlights/
    search/
    settings/
  shared/
```

## 2. apps/backend

职责：

- 鉴权与设备管理
- 收藏数据 CRUD
- 搜索与过滤
- 同步游标管理
- 任务下发（解析、AI）

边界：

- 不执行重型解析（由 parser_worker 执行）
- AI 调用统一经 `ai_service`，禁止散落调用

建议模块：

```text
src/
  auth/
  users/
  devices/
  captures/
  items/
  tags/
  highlights/
  search/
  sync/
  ai/
  jobs/
```

## 3. apps/parser_worker

职责：

- URL 抓取
- 静态正文提取（Readability）
- 动态站点渲染抓取（Playwright）
- 平台规则解析（微博/小红书/Instagram）
- 回写标准化内容

边界：

- 不提供 HTTP API（仅消费队列）
- 不做鉴权逻辑

## 4. packages/shared_types

职责：

- DTO、枚举、错误码、事件 payload
- 与客户端共享的响应结构

边界：

- 只放类型与常量，不放业务逻辑

## 5. packages/parsing_rules

职责：

- 站点解析规则与选择器配置
- 规则版本化（便于回滚）

边界：

- 规则与引擎分离，避免规则改动引发 worker 主逻辑变更

## 6. 依赖方向（必须遵守）

1. `mobile_flutter -> backend(api)`
2. `backend -> shared_types`
3. `parser_worker -> shared_types + parsing_rules`
4. `backend -> parser_worker` 仅通过队列事件，不直接函数调用
