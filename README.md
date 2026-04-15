# Maverick Claw

面向中国用户的本地优先 AI 助手网关（Web + CLI）。

当前仓库实现以单机本地运行为主：`Fastify Gateway` + `React Web UI` + `SQLite`。

## 核心定位

- 本地优先：默认监听 `127.0.0.1`，数据存本机。
- Web-first：浏览器聊天界面为主，CLI 为运维与调试入口。
- 工具增强：支持工具调用、并行/依赖编排、预定义工作流模板。

## 当前能力（v0.1.x）

- Gateway：HTTP + WebSocket 服务、会话与消息持久化（SQLite）。
- Web UI：聊天页、会话切换、模型选择、流式消息展示。
- CLI：`gateway` 生命周期管理、`status`、`config`、`send`、`workflow`。
- 工具系统：10 个内置工具，支持策略控制与执行历史。
- 工作流：5 个预定义工作流模板，已提供 HTTP/WS/CLI 对外入口。
- 通道：WebChat、通用 Webhook、飞书/钉钉事件订阅（`/api/webhooks/:channelId`）。
- 通道契约：配置校验收口 + 鉴权能力声明 + 契约查询接口（`/api/channels/contracts`）。
- 模型契约：统一 Provider 能力矩阵（`/api/models/capabilities` + WS `models.capabilities`）。
- 错误契约：HTTP/WS/Queue 统一错误码模型（`errorCode` / `errorDetail.code`）。

## 开发中能力

- 多客户端会话广播与实时协作体验。
- 外部错误追踪与监控平台接入（Sentry / OTel）。
- 更细粒度的权限模型（RBAC/Scope）。

## 项目结构

```text
Maverick_Claw/
├── packages/
│   ├── core/          # Gateway 核心（Fastify + WS + 工具编排）
│   ├── web-ui/        # React + Vite + Ant Design
│   ├── cli/           # 命令行工具（mc）
│   └── shared/        # 共享类型与协议
├── docs/              # 架构与开发文档
├── docker-compose.yml # Redis / PostgreSQL / 可视化工具
└── TODO.md            # 任务清单
```

## 快速开始

### 1) 环境要求

- Node.js >= 20
- pnpm >= 9
- Docker（可选，建议用于 Redis / PostgreSQL）

### 2) 安装依赖

```bash
pnpm install
```

### 3) 启动开发环境

```bash
# 全仓开发（turbo）
pnpm dev

# 或分别启动
pnpm --filter @maverick-claw/core dev
pnpm --filter @maverick-claw/web-ui dev
```

### 4) 构建与测试

```bash
pnpm build
pnpm test
pnpm typecheck
```

## CLI 示例

```bash
# 启动网关
mc gateway start

# 后台启动
mc gateway start --daemon

# 查看状态
mc status

# 配置管理
mc config view
mc config validate

# 发送消息（CLI 流式）
mc send "你好，帮我总结这个项目"

# 工作流能力
mc workflow list
mc workflow run analyze_project --params '{"path":"./"}'

# 性能基准与回归门禁
pnpm benchmark
pnpm --filter @maverick-claw/core benchmark:compare -- --output-dir ../../benchmark-results --baseline ../../benchmark-baselines/core-baseline.json
```

> 本地做回归对比时，建议使用 `pnpm --filter @maverick-claw/core start`（dist 运行模式）而不是 `dev`，可显著降低单轮波动带来的误判。

`CI` 会在每次 `push/PR` 自动执行性能回归（基准运行 + 基线对比），并上传 `benchmark-results` 报告 artifact。

## 运行时架构（当前实现）

```text
Browser/CLI
   │  HTTP / WebSocket
   ▼
Gateway (Fastify, packages/core)
   ├─ SessionManager (SQLite)
   ├─ ChatService (Model + Tool Calls)
   ├─ Tool Registry / Engine / Orchestrator
   ├─ Channel Router + Queue(BullMQ/Redis)
   └─ ConfigManager / TokenManager
```

## 技术栈（当前）

- 前端：React 18 + Vite + Ant Design + Zustand
- 后端：Node.js + Fastify + WebSocket + TypeScript
- 存储：SQLite（当前默认且已落地）
- 队列：BullMQ + Redis
- 工具链：pnpm workspace + Turborepo + Vitest

## 文档索引

- [用户使用说明](./USER_GUIDE.md)
- [任务清单](./TODO.md)
- [架构文档](./docs/architecture.md)
- [开发指南](./docs/development.md)
- [工具系统说明](./docs/TOOLS.md)

## 许可证

MIT
