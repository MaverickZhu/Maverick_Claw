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

- P1-1 文件上传功能
  - 后端：集成 `@fastify/multipart` + `UploadService` + `POST /api/upload` + 文件存储路径管理
  - 前端：`Chat.tsx` 文件选择、附件标签显示、发送时携带 `attachments` payload
  - 类型扩展：`attachments: { name, type, path }[]` 统一入参格式
  - 6 个单元测试覆盖
- P1-2 主题切换功能
  - `ThemeProvider` + `useTheme` hook（light/dark/system 三态）
  - Ant Design `ConfigProvider` 动态主题切换 + Token 定制
  - TailwindCSS `dark:` 变体 + CSS 自定义属性统一色板
  - Zustand `persist` middleware 本地存储持久化
- P1-3 系统命令工具加固
  - 白名单从 ~30 扩展至 ~60 命令（覆盖常见安全工具链）
  - 新增 `args` 参数支持 + `--` 强制分隔符 + 危险字符过滤
  - 路径限制（禁止向上逃逸）、输出限制（截断 + 换行）、环境变量过滤
  - 超时控制（默认 30s）、安全模式（`forceSafeMode: true` 白名单外拒绝）
  - 跨平台测试修复：`echo/pwd/sleep/seq` 替换为 `node -e` 脚本
- 聊天界面全面优化
  - 消息气泡圆角差异化（用户/AI 不对称）+ 深色模式适配
  - 智能时间格式（今天/昨天/日期）
  - 空状态引导组件（新会话时显示示例提示）
  - 会话标签可关闭 + 横向滚动 + 宽度限制
  - 输入区域附件标签优化 + 颜色指示
  - Streaming CSS 光标动画 `chat-cursor-blink`
  - 错误消息红色系独立背景样式
- 微信通道集成（wechaty）
  - 新增 `WeChatAdapter`（继承 `AbstractChannelAdapter`）
  - 动态导入 `wechaty`（可选依赖，按需加载）
  - 消息缓存 LRU（最近 100 条）用于回复上下文
  - 支持群聊、`@提及`、自身消息过滤
  - 10 个单元测试覆盖（全量 mock wechaty）
- 通道适配器重复代码重构
  - 提取 `AbstractChannelAdapter` 基类：统一生命周期（`initialize/start/stop/health`）+ 消息处理器注册与通知
  - 提取 `channels/adapters/utils.ts`：`getString`/`getNumber`/`getRecord`/`getBoolean`/`readJson`
  - 新增 `ChannelResponse` 工厂函数：`createChannelError` / `createChannelSuccess`
  - 钉钉/飞书/Webhook/微信适配器全部迁移，消除 ~311 行重复代码
- 企业微信通道适配器（Phase 2 Week 9-10）
  - 新增 `WeComAdapter`（继承 `AbstractChannelAdapter`）
  - GET URL 验证：`verifyWebhookUrl` 支持 echostr 返回 + SHA1 签名校验（明文模式）
  - POST XML 消息解析：`processWebhook` 支持 text/image/voice/video/file + 订阅事件过滤
  - 消息发送：通过企业微信 API（`/message/send`）+ access_token 自动获取与缓存
  - 扩展 `WebhookCapableAdapter` 接口：新增可选 `verifyWebhookUrl` 方法
  - 网关新增 `GET /api/webhooks/:adapterId` 路由统一处理 URL 验证
  - 15 个单元测试覆盖（初始化/生命周期/URL 验证/XML 解析/消息发送/错误场景）
- 邮件通道适配器（Phase 2 Week 9-10）
  - 新增 `EmailAdapter`（继承 `AbstractChannelAdapter`）
  - SMTP 发送：`nodemailer` + 自动 TLS 判断（端口 465 默认启用）
  - IMAP 接收：`imapflow` 轮询 INBOX + `mailparser` 解析邮件正文/主题/发件人
  - 配置覆盖：smtp/imap 主机/端口/认证/TLS、发件地址、轮询间隔、已读标记
  - 邮件内容格式化为 `Subject: xxx\n\n<body>`，便于 AI 处理
  - 9 个单元测试覆盖（初始化/SMTP 发送/IMAP 轮询/错误处理/未配置场景）
- 国内云模型 Provider 接入（Phase 2 Week 11-12）
  - 通义千问 `QwenProvider`：DashScope 兼容模式 (`dashscope.aliyuncs.com/compatible-mode/v1`)
    - 模型：`qwen-turbo`, `qwen-plus`, `qwen-max`, `qwen-coder`
    - 环境变量：`DASHSCOPE_API_KEY` / `QWEN_API_KEY`
    - SSE 流式 + Tool 调用 + 8 个单元测试
  - 文心一言 `ErnieProvider`：千帆 OpenAI 兼容模式 (`qianfan.baidubce.com/v2`)
    - 模型：`ernie-4.0-turbo`, `ernie-3.5`, `ernie-speed`
    - 环境变量：`QIANFAN_API_KEY` / `ERNIE_API_KEY`
    - SSE 流式 + Tool 调用 + 8 个单元测试
  - 豆包 `DoubaoProvider`：火山方舟 OpenAI 兼容模式 (`ark.cn-beijing.volces.com/api/v3`)
    - 模型：`doubao-pro-32k`, `doubao-lite-32k`, `doubao-vision-pro-32k`
    - 环境变量：`ARK_API_KEY` / `DOUBAO_API_KEY`
    - SSE 流式 + Tool 调用 + Vision 支持 + 8 个单元测试
  - 接入 Gateway/CLI 注册链路 + 能力矩阵
- 使用统计系统（Phase 2 Week 13）
  - 新增 `usage_records` 表（session_id, model_id, provider, prompt_tokens, completion_tokens, latency_ms）
  - 新增 `StatsService`：记录/查询 usage，支持 overview/daily/model 维度聚合
  - 新增 `/api/stats/overview`, `/api/stats/daily`, `/api/stats/models` HTTP 路由
  - Prometheus 扩展：`tokens_total` counter + `request_latency_seconds` histogram
  - `ChatService` 流式结束后自动记录 token 消耗与延迟
  - Dashboard 从硬编码 0 改为真实数据（通过 API 获取）
  - 4 个单元测试覆盖
- 记忆系统持久化（Phase 2 Week 13）
  - 新增 `channel_sessions` 表 + `ChannelSessionManager` DB 持久化（替代纯内存映射）
  - 重启不丢会话映射，支持 24h 过期自动清理
  - `ChatService.getConversationHistory()` 新增 `maxContextMessages=20` 截断
  - 超长上下文保留 system 消息 + 最近 N 条，避免 token 超限
- 导入/导出功能（Phase 2 Week 14）
  - 新增 `ExportService`：ZIP 打包 sessions + messages + config.json5 + manifest.json
  - 新增 `ImportService`：ZIP 解析 + 恢复 sessions/messages，UUID 冲突自动跳过
  - 新增 `POST /api/export`, `POST /api/import` HTTP 路由
  - 3 个单元测试覆盖
- 插件系统 MVP（Phase 2 Week 14）
  - 新增 `Plugin` 接口（init/start/stop + `PluginContext`）
  - 新增 `PluginManager` 动态加载 + 生命周期管理（init/start/stop）
  - `PluginContext` 暴露 modelRegistry/toolRegistry/channelRegistry/configManager/dbManager/logger
  - `gateway/server.ts` 接入 `pluginManager.loadAll()` 启动时自动加载
  - `plugins/deepseek` 包装为真正 Plugin 实现（`plugin` 导出 + 环境变量驱动注册）
  - `packages/core/src/index.ts` 导出 `Plugin`/`PluginContext`/`PluginManifest` 类型
- 多用户系统 + RBAC（Phase 3 Week 15）
  - `users` 表启用：`role_id` + `status` 字段，密码哈希使用 PBKDF2-HMAC-SHA256（内置 crypto，无新增依赖）
  - `roles` 表 + `RoleService`：内置 admin/user/guest 三角色，支持自定义角色创建
  - `UserService`：用户 CRUD + 密码验证 + 角色分配
  - `TokenManager` DB 化：`tokens` 表持久化，重启不丢，支持 revoke/cleanup
  - `AuthService`：login/logout/me/changePassword 高层 API
  - 登录 `/api/auth/login` 改造：支持 email/password 查 DB，保留 config masterPassword 向后兼容
  - 资源所有权中间件：非 admin 只能访问自己的 session/message
  - 新增路由：`/api/auth/logout`, `/api/auth/me`, `/api/users/*`, `/api/roles/*`, `/api/users/me/password`
  - 新增测试 28 个（password 5 + user-service 10 + role-service 7 + token-db 6）
- 审计日志 + 工作流持久化（Phase 3 Week 16）
  - `audit_logs` 表 + `AuditService`：log/query/stats，异步写入不阻塞主流程
  - 审计查询 API：`GET /api/audit/logs` + `/api/audit/stats`（admin only，时间范围/分页过滤）
  - `workflows` 表 + `WorkflowService`：自定义工作流存储/查询/更新/删除
  - 工作流 HTTP API：`POST /api/workflows`, `GET /api/workflows/:id`, `PUT/DELETE`, `POST /api/workflows/:id/run`
  - 内置模板保留（`builtin:` 前缀），与自定义工作流统一列表
  - 新增测试 13 个（audit 6 + workflow 7）
- SSO/OAuth2 + LDAP 认证（Phase 3 Week 17）
  - 新增依赖：`openid-client@^5.7.0` + `ldapjs@^3.0.7` + `@types/ldapjs`
  - 数据库 Schema 扩展：`users` 表新增 `auth_provider`/`external_id`，新增 `oauth_states` 临时表
  - Config Schema 扩展：`auth.oauth.providers[]` + `auth.ldap` 完整配置
  - `OAuthService`：OIDC 自动发现 + OAuth2 手动配置，state CSRF 防护，用户匹配/创建/角色映射
  - `LDAPService`：bind/search 认证，group 查询 + groupRoleMapping 角色解析
  - `SSOService`：统一认证入口，聚合本地/OAuth/LDAP 方法列表
  - HTTP 路由：`GET /api/auth/providers`, `GET /api/auth/oauth/:provider`, `GET /api/auth/oauth/callback`, `POST /api/auth/ldap`
  - 新增测试 13 个（oauth-service 6 + ldap-service 4 + sso-service 3）
- 插件市场（Phase 3 Week 18）
  - 数据库 Schema 扩展：新增 `plugins` 表（id/name/version/source/enabled/installed_at/manifest）
  - Config Schema 扩展：`plugins.registryUrl` 支持自定义 registry 地址
  - `PluginManifest` 扩展：新增 `id`/`author`/`permissions`/`dependencies` 字段
  - `PluginMarketService`：远程 registry 查询（JSON 索引）、ZIP 下载/解压、安装/卸载/更新/版本检查
  - `PluginManager` 改造：支持 DB 驱动加载（`enabled=1` 的已安装插件），支持 unload/reload
  - HTTP 路由：`GET /api/market/plugins`, `GET /api/market/plugins/:id`, `GET /api/plugins`, `POST /api/plugins/install`, `POST /api/plugins/uninstall`, `POST /api/plugins/update`, `GET /api/plugins/updates`, `POST /api/plugins/:id/enable`
  - 新增测试 13 个（market-service 13）
- 前端管理面板 + Auth 体系（Phase 3 Week 19）
  - 新增 `dayjs` 依赖（web-ui）
  - 登录页（`Login.tsx`）：本地邮箱密码登录 + SSO 提供商选择 + 自动跳转
  - Auth Store（`stores/auth.ts`）：Zustand + persist，管理 token/user/scopes/isAdmin + logout
  - API Client（`api/client.ts`）：统一封装 GET/POST/PUT/DELETE + Bearer Token
  - 路由守卫：`AuthGuard`（认证检查）+ `AdminGuard`（admin 权限检查）
  - Sidebar 改造：底部用户头像/名称/邮箱 + 下拉登出 + admin 专属「管理」菜单分组
  - 用户管理页（`/admin/users`）：用户列表/新建/编辑/删除 + 角色分配 + 状态开关
  - 角色管理页（`/admin/roles`）：角色列表/新建/编辑/删除 + 权限标签 + 内置角色保护
  - 审计日志页（`/admin/audit`）：日志列表 + 时间范围筛选 + 统计卡片 + 操作分布标签
- v1.0.0 正式版收尾（Phase 3 Week 20）
  - 插件市场前端（`/plugins`）：已安装插件管理（启用/禁用/卸载/更新）+ 市场浏览/安装
  - 工作流管理前端（`/workflows`）：列表/新建/编辑/删除/执行 + JSON 定义编辑器 + 执行结果展示 + 详情查看
  - Dashboard 增强：接入 `/api/stats/daily`（14 天每日趋势表格）+ `/api/stats/models`（模型使用统计表格）
  - 版本号升级：全部包 `0.1.0` → `1.0.0`（含 CLI 硬编码版本号）

### Verified
- 依赖安装成功 (pnpm)
- 所有包构建成功 (5/5 packages)
- 测试全量通过 (273 测试：shared 1 + web-ui 1 + cli 7 + core 264，42 个测试文件)
- CI 接入 lint/typecheck/build/test/benchmark
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
