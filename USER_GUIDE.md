# Maverick Claw 用户使用说明书

## 📋 目录

1. [系统要求](#系统要求)
2. [快速开始](#快速开始)
3. [启动步骤](#启动步骤)
4. [基本使用](#基本使用)
5. [CLI 命令参考](#cli-命令参考)
6. [配置指南](#配置指南)
7. [性能监控与可视化](#性能监控与可视化)
8. [故障排除](#故障排除)

---

## 系统要求

### 必需环境

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 20.0.0 | JavaScript 运行时 |
| pnpm | >= 9.0.0 | 包管理器 |
| Docker | 最新版（可选） | Redis/PostgreSQL 容器（按需） |

### 支持平台

- ✅ Windows 10/11
- ✅ macOS 12+
- ✅ Linux (Ubuntu 20.04+)

---

## 快速开始

### 1. 环境检查

```powershell
# 检查 Node.js
node -v  # 应显示 v20.x.x 或更高

# 检查 pnpm
pnpm -v  # 应显示 9.x.x 或更高

# 检查 Docker
docker info
```

### 2. 目录结构

```
Maverick_Claw/
├── packages/
│   ├── core/          # Gateway 核心
│   ├── cli/           # 命令行工具
│   ├── web-ui/        # Web 界面
│   └── shared/        # 共享类型
├── plugins/           # 模型插件
├── docker/            # Docker 配置
├── docker-compose.yml # Docker 编排
└── .env               # 环境变量
```

---

## 启动步骤

### 步骤 1：按需启动依赖服务（Docker，可选）

```powershell
# 进入项目目录
cd Maverick_Claw

# 推荐：仅启动 Redis（消息队列与异步任务）
docker compose up -d redis

# 可选：启动 PostgreSQL（当前主要用于预留/实验）
# docker compose up -d postgres

# 验证服务状态
docker compose ps
```

**预期输出（示例）：**
```
NAME          STATUS                   PORTS
mc-redis      Up (healthy)             0.0.0.0:6379->6379/tcp
```

### 步骤 2：构建项目

```powershell
# 安装依赖
pnpm install

# 构建所有包
pnpm build
```

**预期输出：**
```
 Tasks:    5 successful, 5 total
```

### 步骤 3：初始化配置

```powershell
# 进入 CLI 包
cd packages/cli

# 查看配置路径
node dist/cli.js config path

# 重置为默认配置
node dist/cli.js config reset --force

# 验证配置
node dist/cli.js config view
```

**预期输出：**
```json
{
  port: 31987,
  host: '127.0.0.1',
  auth: { type: 'token' },
  models: [],
  channels: [],
  storage: { type: 'sqlite' }
}
```

### 步骤 4：启动 Gateway

**方式 A：前台模式（调试）**

```powershell
# 启动 Gateway（会占用当前终端）
node dist/cli.js gateway start

# 或使用快捷命令
node dist/cli.js start
```

**方式 B：后台模式（推荐）**

```powershell
# 后台运行
node dist/cli.js gateway start --daemon

# 或使用快捷命令
node dist/cli.js start --daemon
```

**启动成功标志：**
```
🦅 Maverick_Claw Gateway v0.1.0 started
   Web UI: http://127.0.0.1:31987
   API: http://127.0.0.1:31987/api
   WebSocket: ws://127.0.0.1:31987/ws
```

### 步骤 5：验证运行状态

```powershell
# 检查状态
node dist/cli.js status
```

**预期输出：**
```
┌─────────────────────────────────────┐
│  Maverick_Claw Status               │
├─────────────────────────────────────┤
│  状态:      🟢 healthy              │
│  版本:      📝 0.1.0                │
│  运行时间:  ⏱️  XXs                 │
└─────────────────────────────────────┘
```

### 步骤 6：访问 Web UI

打开浏览器访问：
```
http://127.0.0.1:31987
```

---

## 基本使用

### 查看帮助

```powershell
# 主帮助
node dist/cli.js --help

# Gateway 命令帮助
node dist/cli.js gateway --help

# Config 命令帮助
node dist/cli.js config --help
```

### 配置 AI 模型

```powershell
# 编辑配置文件
node dist/cli.js config edit

# 或在代码中配置模型
```

配置示例（config.json5）：
```json5
{
  port: 31987,
  host: '127.0.0.1',
  models: [
    {
      id: 'kimi-default',
      name: 'Kimi',
      provider: 'kimi',
      apiKey: 'your-moonshot-api-key',
      enabled: true
    }
  ],
  channels: [
    {
      id: 'webchat',
      type: 'webchat',
      name: 'WebChat',
      enabled: true
    }
  ]
}
```

### 停止 Gateway

```powershell
# 前台模式：按 Ctrl+C

# 后台模式
node dist/cli.js gateway stop

# 或使用快捷命令
node dist/cli.js stop
```

### 查看日志

```powershell
# 实时查看日志
node dist/cli.js logs --follow

# 查看最近 100 行
node dist/cli.js logs --lines 100
```

---

## CLI 命令参考

### 网关管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `gateway start` | 启动 Gateway | `node dist/cli.js gateway start` |
| `gateway start --daemon` | 后台启动 | `node dist/cli.js gateway start --daemon` |
| `gateway start --port 32000` | 指定端口 | `node dist/cli.js gateway start --port 32000` |
| `gateway stop` | 停止 Gateway | `node dist/cli.js gateway stop` |
| `gateway restart` | 重启 Gateway | `node dist/cli.js gateway restart` |
| `gateway status` | 查看状态 | `node dist/cli.js gateway status` |
| `gateway logs` | 查看日志 | `node dist/cli.js gateway logs -f` |

### 快捷命令

| 命令 | 说明 |
|------|------|
| `start` | 快速启动（前台） |
| `stop` | 快速停止 |
| `restart` | 快速重启 |
| `status` | 查看状态 |
| `logs` | 查看日志 |

### 配置管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `config path` | 显示配置路径 | `node dist/cli.js config path` |
| `config view` | 查看配置 | `node dist/cli.js config view` |
| `config edit` | 编辑配置 | `node dist/cli.js config edit` |
| `config reset` | 重置配置 | `node dist/cli.js config reset --force` |
| `config export` | 导出配置 | `node dist/cli.js config export backup.json5` |
| `config import` | 导入配置 | `node dist/cli.js config import backup.json5` |
| `config validate` | 验证配置 | `node dist/cli.js config validate` |

### 消息发送（开发调试用）

```powershell
node dist/cli.js send "你好，世界"
```

### 工作流命令

```powershell
# 列出工作流
node dist/cli.js workflow list

# 运行工作流
node dist/cli.js workflow run analyze_project --params "{\"path\":\"./\"}"
```

---

## 配置指南

### 配置文件位置

```
Windows: C:\Users\<用户名>\.maverick-claw\config.json5
macOS:   ~/.maverick-claw/config.json5
Linux:   ~/.maverick-claw/config.json5
```

### 环境变量

可通过 `.env` 文件配置：

```bash
# 数据库
REDIS_HOST=localhost
REDIS_PORT=6379

# Gateway
GATEWAY_PORT=31987
GATEWAY_HOST=127.0.0.1

# 日志
LOG_LEVEL=info

# 模型 Provider（可选）
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1

# 错误追踪（可选）
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=maverick-claw@0.1.0
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### 日志链路追踪与脱敏

- HTTP 请求会自动分配 `requestId`，并通过响应头 `x-request-id` 返回，便于前后端联调与故障排查
- HTTP/WS 日志统一携带 `requestId/traceId` 上下文字段，可用于关联同一条调用链
- 以下敏感字段默认脱敏输出为 `[REDACTED]`：`authorization`、`cookie`、`password`、`token`、`apiKey`

### 支持的 AI 提供商

| 提供商 | 配置项 | 获取 API Key |
|--------|--------|-------------|
| DeepSeek | `provider: 'deepseek'` | https://platform.deepseek.com |
| OpenAI Compatible | `provider: 'openai'`（支持 `OPENAI_BASE_URL`） | https://platform.openai.com |
| Kimi (Moonshot) | `provider: 'kimi'` | https://platform.moonshot.cn |

### 默认模型策略（新增）

- 模型唯一引用格式为 `provider:id`（例如 `deepseek:deepseek-chat`）
- 服务端会持久化 `defaultModel`，并在会话创建时自动继承
- 如果默认模型被禁用或删除，系统会自动回退到首个可用启用模型
- 设置页“模型配置”中可直接将某个启用模型设为默认模型

### Provider 能力矩阵（新增）

- HTTP 查询：`GET /api/models/capabilities`
- WebSocket 查询：`req(method='models.capabilities')`
- 统一字段包含：
  - `supportsStreaming` / `supportsTools` / `supportsVision` / `supportsJsonMode`
  - `parameterSupport.temperature`（`min/max/default`）
  - `registered`（当前进程是否已注册）与 `configuredModels`（配置中已声明模型）

### 统一错误响应（新增）

HTTP 路由在错误时统一返回以下结构：

```json
{
  "error": "Session not found",
  "errorCode": "not_found",
  "requestId": "req-xxx",
  "details": {
    "sessionId": "abc"
  }
}
```

WebSocket `type='res'` 的失败响应兼容保留 `error` 字符串，同时新增结构化字段：

```json
{
  "type": "res",
  "id": "req-1",
  "ok": false,
  "error": "Unknown method: foo.bar",
  "errorDetail": {
    "code": "method_not_found",
    "message": "Unknown method: foo.bar"
  }
}
```

### 通道配置（Webhook / 飞书 / 钉钉）

- 通道统一回调入口：`POST /api/webhooks/{channelId}`
- 通道契约查询接口：`GET /api/channels/contracts`（用于查看各通道配置字段、鉴权能力、路由契约）
- Webhook 自定义通道支持通用 JSON 请求体：`{"userId":"...","content":"..."}`
- 飞书通道（`type: 'lark'`）支持：
  - 事件订阅 URL 验证（`url_verification` challenge 自动响应）
  - 消息接收事件（`im.message.receive_v1`）
  - 回消息优先走飞书开放接口（`appId/appSecret`），未配置时回退到 Bot Webhook
  - 配置约束：`appId` 与 `appSecret` 必须成对出现
- 钉钉通道（`type: 'dingtalk'`）支持：
  - 机器人回调消息解析（`text.content` / `senderStaffId` / `conversationId`）
  - Outgoing Webhook 回消息（支持 `SEC...` 签名）
  - 配置约束：配置 `outgoingSecret` 时必须提供 `outgoingWebhookUrl`（兼容旧字段 `secret/webhookUrl`，保存时会自动归一化）

配置示例（`config.json5`）：

```json5
{
  channels: [
    {
      id: 'webhook-default',
      type: 'webhook',
      name: 'Webhook',
      enabled: true,
      config: {
        secret: 'optional-webhook-secret'
      }
    },
    {
      id: 'lark-main',
      type: 'lark',
      name: '飞书助手',
      enabled: true,
      config: {
        verificationToken: 'optional-lark-token',
        appId: 'cli_xxx',
        appSecret: 'xxx',
        botWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
      }
    },
    {
      id: 'dingtalk-main',
      type: 'dingtalk',
      name: '钉钉助手',
      enabled: true,
      config: {
        verificationToken: 'optional-dingtalk-token',
        outgoingWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=xxx',
        outgoingSecret: 'SECxxxx'
      }
    }
  ]
}
```

---

## 性能监控与可视化

### 指标端点

```bash
GET http://127.0.0.1:31987/metrics
```

该端点输出 Prometheus 文本格式指标，包含：

- HTTP 请求吞吐与延迟（含 P95）
- WebSocket 在线连接数、收发消息总量、错误总量
- 队列状态（waiting/active/completed/failed/delayed/paused）
- 会话总数与消息总数

### 启动监控栈（Prometheus + Grafana）

```powershell
# 启动监控组件（不影响核心服务）
pnpm docker:up:monitoring

# 查看状态
docker compose --profile monitoring ps
```

### 访问地址

- Prometheus: http://127.0.0.1:9090
- Grafana: http://127.0.0.1:3001
- Grafana 默认账号: `admin`
- Grafana 默认密码: `admin123`

Grafana 会自动加载预置看板：`Maverick Claw - 性能监控`。

### 外部错误追踪（Sentry，可选）

在 `.env` 中配置 `SENTRY_DSN` 后重启 Gateway，即可自动上报：

- HTTP 未处理异常
- WebSocket 消息处理异常
- 队列任务处理异常

未配置 `SENTRY_DSN` 时，错误追踪保持关闭，不影响本地开发。

### 性能基准测试（HTTP + WebSocket）

在 Gateway 启动后执行：

```powershell
pnpm benchmark
```

> 建议：做“回归对比”时优先使用 `pnpm --filter @maverick-claw/core start`（dist 运行）后再跑 benchmark；`dev/tsx watch` 模式更容易出现单轮抖动，影响门禁稳定性。

可选参数示例：

```powershell
# 自定义目标地址与压测规模
pnpm benchmark -- --base-url "http://127.0.0.1:31987" --http-total 800 --http-concurrency 40

# 仅跑 HTTP 基准
pnpm benchmark -- --skip-ws
```

执行完成后会在 `benchmark-results/` 目录输出：

- `benchmark-<timestamp>.json`（结构化结果，便于 CI/二次分析）
- `benchmark-<timestamp>.md`（可读报告，便于评审对比）

### 基线对比与误差预算（新增）

先准备两份基准报告（baseline 与 candidate），再执行：

```powershell
pnpm benchmark:compare -- --output-dir ../../benchmark-results --baseline "benchmark-2026-04-14T10-00-00-000Z.json" --candidate "benchmark-2026-04-14T10-30-00-000Z.json"
```

使用仓库内置基线（推荐）：

```powershell
pnpm --filter @maverick-claw/core benchmark:compare -- --output-dir ../../benchmark-results --baseline ../../benchmark-baselines/core-baseline.json
```

默认阈值：

- `minSuccessRate=99.5`
- `maxFailures=0`
- `maxP95Regression=20%`
- `maxAvgRegression=20%`
- `maxThroughputDrop=15%`

若任一场景超过误差预算，命令会返回非零退出码（可直接用于 CI 门禁）。

### 常规回归（CI）

`GitHub Actions` 已接入常规性能回归，流程如下：

1. 启动 `@maverick-claw/core`
2. 执行基准场景（HTTP + WebSocket）
3. 使用 `benchmark-baselines/core-baseline.json` 进行对比
4. 上传 `benchmark-results/` 与 core 启动日志作为 artifact

### 监控栈停止

```powershell
docker compose --profile monitoring down
```

---

## 故障排除

### 问题 1：端口被占用

**症状：**
```
Error: listen EADDRINUSE: address already in use 127.0.0.1:31987
```

**解决：**
```powershell
# 查找占用进程
netstat -ano | findstr 31987

# 结束进程
taskkill /PID <进程ID> /F

# 或使用其他端口
node dist/cli.js gateway start --port 32000
```

### 问题 2：Docker 服务未启动

**症状：**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**解决：**
```powershell
# 检查 Docker 状态
docker info

# 启动 Redis（必需时）
docker compose up -d redis

# 如需 PostgreSQL 再额外启动
# docker compose up -d postgres

# 查看日志
docker compose logs -f
```

### 问题 3：配置加载失败

**症状：**
```
Configuration file not found
```

**解决：**
```powershell
# 重置配置
node dist/cli.js config reset --force

# 验证
node dist/cli.js config view
```

### 问题 4：无法连接到 Gateway

**症状：**
```
❌ 无法连接到 Gateway
```

**解决：**
```powershell
# 1. 检查 Gateway 是否运行
node dist/cli.js status

# 2. 检查端口监听
netstat -ano | findstr 31987

# 3. 手动测试 API
Invoke-RestMethod -Uri "http://127.0.0.1:31987/api/health"
```

### 问题 5：构建失败

**症状：**
```
Error: Cannot find module
```

**解决：**
```powershell
# 清理并重新安装
rm -rf node_modules
pnpm install
pnpm build
```

---

## API 端点参考

### 健康检查

```bash
GET http://127.0.0.1:31987/api/health
```

### 状态信息

```bash
GET http://127.0.0.1:31987/api/status
```

### 性能指标（Prometheus）

```bash
GET http://127.0.0.1:31987/metrics
```

### 工作流列表

```bash
GET http://127.0.0.1:31987/api/workflows
```

### 运行工作流

```bash
POST http://127.0.0.1:31987/api/workflows/run
Content-Type: application/json

{
  "name": "analyze_project",
  "params": { "path": "." }
}
```

### 登录并申请受限 Scope

```bash
POST http://127.0.0.1:31987/api/auth/login
Content-Type: application/json

{
  "password": "your-auth-token",
  "scopes": ["sessions:read", "sessions:write", "chat:stream"]
}
```

> 若不传 `scopes`，默认签发管理员令牌（`*`）。

### WebSocket 连接

```javascript
const ws = new WebSocket('ws://127.0.0.1:31987/ws');
```

### WebSocket 会话订阅（多端同步）

连接成功后，可通过 `sessions.watch` 订阅某个会话的流式事件：

```json
{
  "type": "req",
  "id": "watch-1",
  "method": "sessions.watch",
  "params": { "sessionId": "your-session-id" }
}
```

取消订阅：

```json
{
  "type": "req",
  "id": "unwatch-1",
  "method": "sessions.unwatch",
  "params": {}
}
```

### WebChat 稳定性行为（新版）

- 前端内置自动重连状态机：`connecting -> reconnecting -> connected/failed`
- 重连成功后会自动执行 `sessions.list`，并回填当前会话消息（`/api/sessions/:id/messages`）
- 断线时会自动结束流式状态，避免界面持续停留在“生成中”

---

## 更新日志

### v0.1.0
- ✅ 基础 Gateway 功能
- ✅ Web UI 界面
- ✅ CLI 工具
- ✅ Docker 数据库支持
- ✅ 多模型提供商支持（DeepSeek、Kimi）
- ✅ 消息队列（BullMQ + Redis）
- ✅ 配置热重载

---

## 技术支持

如有问题，请：
1. 查看日志：`node dist/cli.js logs`
2. 检查配置：`node dist/cli.js config validate`
3. 重启服务：`node dist/cli.js restart`

---

**祝您使用愉快！** 🦅
