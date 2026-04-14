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
