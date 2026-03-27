# shared_types

跨端共享的数据结构定义。

建议内容：

- ItemSummary / ItemDetail DTO
- CaptureRequest / SyncPayload
- ErrorCode 枚举
- Domain events payload（item_created / item_updated 等）

约束：

- 只放类型、常量、轻量校验
- 不放业务逻辑与 IO 代码
