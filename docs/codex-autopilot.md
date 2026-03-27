# Codex 连续执行指南

目标：尽量减少每一步人工确认，让 Codex 连续跑完整链路。

## 推荐入口

1. 启动开发栈：`./scripts/dev-stack.sh up`
2. 一次性自动验证：`./scripts/autopilot.sh once`
3. 持续循环验证：`./scripts/autopilot.sh loop`

## 为什么这样能减少确认

1. 把多条命令收敛为固定脚本前缀（`./scripts/...`），减少零散命令触发权限询问。
2. 后端/worker 的构建、启动、健康检查、烟雾测试都在脚本内串行执行。
3. 失败自动重试由脚本处理，不需要人工逐步点击确认。

## 运行中的常用命令

1. 查看状态：`./scripts/dev-stack.sh status`
2. 查看日志：`./scripts/dev-stack.sh logs`、`./scripts/dev-stack.sh logs backend`
3. 停止服务：`./scripts/dev-stack.sh down`
