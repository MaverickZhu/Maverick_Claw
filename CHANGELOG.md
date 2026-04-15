# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 项目初始化
- 基础架构设计
- Monorepo 结构搭建 (pnpm workspace + Turborepo)
- 核心类型定义 (@maverick-claw/shared)
- 数据库层 (SQLite + better-sqlite3)
  - Sessions 表
  - Messages 表
  - Config 表
  - Users 表
  - Channels 表
- 会话管理系统 (SessionManager)
  - 创建/获取/列出/更新/删除会话
  - 创建/获取/列出消息
- 认证授权系统
  - Token 生成与验证
  - JWT 风格的 Token 管理
  - 自动清理过期 Token
- Gateway HTTP API
  - /api/health - 健康检查 ✅
  - /api/status - 状态查询 ✅
  - /metrics - Prometheus 指标导出 ✅
  - /api/config - 配置查询 ✅
  - /api/auth/login - 登录 ✅
  - /api/sessions - 会话 CRUD ✅
  - /api/sessions/:id/messages - 消息 CRUD ✅
  - /api/models - 模型列表 ✅
  - /api/channels - 通道列表 ✅
- CLI 基础框架
  - mc gateway - 启动服务 ✅
  - mc status - 查看状态 ✅
  - mc config - 配置管理 ✅
  - mc send - 发送消息 ✅
- Web UI 基础框架
  - React + Ant Design + Vite ✅
  - 聊天页面 ✅
  - 仪表板页面 ✅
  - 设置页面 ✅
- 性能监控与可视化
  - `prom-client` 指标采集（HTTP / WS / 队列 / 存储计数）
  - Prometheus 采集配置（`docker/prometheus/prometheus.yml`）
  - Grafana 自动数据源与预置看板（`Maverick Claw - 性能监控`）
- 外部错误追踪
  - Sentry 可选接入（通过 `SENTRY_DSN` 启用）
  - HTTP/WebSocket/Queue 异常链路上报
- 日志链路标准化
  - `requestId/traceId` 统一日志上下文（HTTP + WebSocket）
  - 响应头增加 `x-request-id` 便于排障追踪
  - 敏感字段（`authorization`/`cookie`/`password`/`token`/`apiKey`）默认脱敏
- CI/CD 基础流水线
  - 新增 GitHub Actions 工作流（`lint`、`typecheck`、`build`、`test`）
  - 推送与 PR 自动触发质量门禁
- 性能基准测试工具
  - 新增 `pnpm benchmark`（HTTP + WebSocket 基准场景）
  - 自动生成 `benchmark-results/*.json` 与 `benchmark-results/*.md` 报告
- OpenAI 兼容 Provider
  - 新增 `openai` Provider（兼容 OpenAI Chat Completions + 流式输出）
  - Gateway/CLI 启动时支持按配置自动注册
- 模型配置治理增强
  - 新增默认模型策略（配置持久化 + 自动回退到可用模型）
  - 新增 `PUT /api/config/models/default` 默认模型管理接口
  - 聊天会话创建自动继承默认模型，前端模型选择持久化到本地存储
- WebChat 稳定性增强
  - WebSocket 客户端新增连接状态机与重连状态订阅（`connecting/reconnecting/connected/failed`）
  - 重连后自动会话同步（`sessions.list`）与当前会话消息回填（`/api/sessions/:id/messages`）
  - 断线时自动结束流式状态，避免 UI 卡在“持续生成中”
- 性能回归与误差预算门禁
  - 新增 `pnpm benchmark:compare`（baseline/candidate 自动对比）
  - 支持成功率、失败数、P95、平均延迟、吞吐下降等阈值判定
  - 超过误差预算时返回非零退出码，便于接入 CI 稳定性门禁
- 性能基准常规回归
  - 新增仓库基线文件：`benchmark-baselines/core-baseline.json`
  - CI 在每次 push/PR 自动执行 benchmark + baseline 对比
  - 回归报告自动归档为 GitHub Actions artifact（`benchmark-results/**`）
- 错误处理一致性收口
  - 新增统一错误契约：`StandardError`（`code/statusCode/details/retryable`）
  - HTTP 错误响应统一输出：`error` + `errorCode` + `requestId` + `details`
  - WebSocket 失败响应新增结构化字段：`errorDetail`
  - Queue `JobResult` 新增 `errorCode/errorDetails`，队列未初始化/不存在错误统一编码
- 类型检查覆盖收口
  - HTTP 边界 DTO（`params/body`）统一使用 zod 校验，移除网关层弱类型断言
  - Shared 协议对象补充 `chat.chunk/chat.complete/chat.error` 事件 payload 类型
  - Web UI 对 REST/WS payload 增加运行时解析（zod），移除聊天页协议断言
- 会话列表热点性能优化
  - `MessageManager` 新增批量计数接口 `getMessageCounts(sessionIds)`
  - HTTP `/api/sessions` 与 WS `sessions.list` 改为单次聚合查询回填 `messageCount`
  - `ws.sessions.list` benchmark 对比中 p95 从 `9.14ms` 降至 `5.96ms`（回归门禁 PASS）
- 会话计数视图重复代码收口
  - `SessionManager` 新增 `getSessionWithMessageCount` 与 `listSessionsWithMessageCount`
  - HTTP/WS 会话查询统一走 `SessionManager`，移除网关层重复计数拼装逻辑
  - 重构后 benchmark 回归对比 PASS（`perf-pass2` vs `perf-pass3`）
- HTTP 请求校验收口（进行中）
  - 登录/会话创建/发消息/工作流执行/默认模型/通道配置等路由统一改为 `parseRequestInput(...)`
  - 移除网关层多处重复 `safeParse + sendHttpError` 模板代码，保持错误结构一致
- HTTP 错误 fallback 模板收口（进行中）
  - 新增 `sendInvalidRequestError(...)`，统一 `InvalidRequest + status 400 + preserveMessage` 的回退策略
  - `workflow/config/models/channels/queue` 等路由异常分支改为复用统一 helper，减少样板代码与参数分叉风险
  - 新增 `sendNotFoundError(...)` 与 `sendBadRequestError(...)`，收口 `sessions/*` 与 `webhooks/*` 重复错误处理分支
- WebSocket 错误模板收口（进行中）
  - `handleRequest` 新增统一失败响应 helper：`createWsValidationFailureResponse` / `createWsNotFoundFailureResponse` / `createWsBadRequestFailureResponse` / `createWsUnauthorizedFailureResponse` / `createWsForbiddenFailureResponse`
  - 收口 `sessions/chat/workflow` 等方法的参数校验与鉴权失败模板，降低 WS 分支复制代码
- WebSocket 错误模板收口（二阶段，进行中）
  - 新增 `parseWsRequestInput(...)`，统一 `safeParse` + `validation_failed` 失败返回模板
  - 新增 `createWsMethodNotFoundFailureResponse(...)` / `createWsInternalFailureResponse(...)`，收口 unknown method 与 catch fallback 分支
  - E2E 新增 4 条 WS 错误分支回归用例：`validation_failed` / `not_found` / `invalid_request` / `unauthorized`
- Benchmark 波动隔离复测（稳定性观察）
  - 隔离环境（独立 config/data + `core start`）下，`ws.sessions.list` 与 pass3 baseline 接近（p95 `4.33ms`）
  - 同代码同阈值存在单轮 FAIL/PASS（`ws.connect` 吞吐波动可触发门禁），提示后续以稳定运行模式执行回归
- 飞书通道首版接入
  - 新增 `LarkAdapter`（事件订阅接入、URL 验证 challenge 自动响应）
  - 支持飞书消息回传（`appId/appSecret` 或 Bot Webhook 回退）
  - `/api/webhooks/:adapterId` 升级为适配器能力分发（不限 `custom` 类型）
- 钉钉通道首版接入
  - 新增 `DingTalkAdapter`（Webhook 回调解析、challenge 响应）
  - 支持钉钉机器人 Outgoing Webhook 回消息（含签名）
  - 设置页新增钉钉通道配置入口（Webhook URL / Secret / Token）
- 通道插件化边界收口
  - 新增通道契约模块（`channels/contracts`），统一配置校验与归一化
  - `ConfigManager` 在 load/update/add/updateChannel 全链路执行通道配置契约校验
  - 新增契约查询接口 `GET /api/channels/contracts`（配置字段、鉴权能力、路由约定）
  - 消息入队 metadata 统一包含 `isGroup/groupId/userName/mentions/metadata`
- 多模型接入标准化（Provider 能力矩阵）
  - `ModelProvider` 新增 `getCapabilities()`，统一输出能力契约
  - 新增能力矩阵接口：`GET /api/models/capabilities` 与 WS `models.capabilities`
  - 能力矩阵包含参数支持（temperature/maxTokens/toolChoice）与可视化字段（registered/configuredModels）
  - `ChatService` 与 `ToolAgent` 改为基于能力矩阵读取默认温度，移除 provider 硬编码

### Verified
- 依赖安装成功 (pnpm)
- 所有包构建成功
- Gateway 服务启动正常
- HTTP API 测试通过
- 数据库连接正常

## [0.1.0] - 2026-04-01

### Added
- 项目创建
- 基础文档 (README, ROADMAP, TODO)

---

## Release Template

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- 新功能

### Changed
- 变更

### Deprecated
- 废弃功能

### Removed
- 移除功能

### Fixed
- 修复

### Security
- 安全更新
```
