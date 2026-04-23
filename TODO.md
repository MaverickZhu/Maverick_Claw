# Maverick_Claw 任务清单

> 本清单已按当前代码状态校准：`[x] 已完成`、`[/] 进行中`、`[ ] 待办`。

## 当前 Sprint（Phase 3 Week 20 — v1.0.0 发布）

### 🔴 P0 - 核心链路

#### 数据库与存储
- [x] 设计数据库 Schema
  - [x] `sessions`
  - [x] `messages`
  - [x] `config`
  - [x] `users`
- [x] 实现 SQLite 数据库连接（`better-sqlite3`）
- [x] 实现 `SessionManager`（会话 + 消息基础 CRUD）
- [x] 拆分独立 `MessageManager`（已完成，`Chat/HTTP/WS` 主链路改为独立消息管理）

#### WebSocket 协议完善
- [x] 协议解析器（`connect/req/event` + 结构化错误）
- [x] 消息验证（Zod schema）
- [x] 心跳机制（ping/pong + 超时断线）
- [x] 重连支持（前端重连 + 服务端按 `deviceId` 恢复）
- [x] 消息广播（多客户端会话广播，支持 `sessions.watch`/`sessions.unwatch`）

#### 认证授权
- [x] Token 生成与验证
- [x] 登录 API（`/api/auth/login`）
- [x] 认证中间件（HTTP + WS 握手）
- [x] 权限检查（细粒度 RBAC/Scope，HTTP+WS scope 校验已接入）
- [x] SSO/OAuth2 认证（openid-client + OIDC 自动发现 + OAuth2 手动配置 + state CSRF 防护 + 角色映射）
- [x] LDAP 认证（ldapjs + bind/search + group 角色映射）
- [x] 统一认证入口（`GET /api/auth/providers` 返回可用方式列表）
- [x] 插件市场（远程 registry + ZIP 安装/卸载/更新 + PluginMarketService + DB 持久化 + PluginManager DB 驱动加载）
  - [x] `plugins` 表 + `PluginManifest` 扩展
  - [x] `GET /api/market/plugins` 市场列表
  - [x] `GET /api/plugins` 已安装列表
  - [x] `POST /api/plugins/install` 安装
  - [x] `POST /api/plugins/uninstall` 卸载
  - [x] `POST /api/plugins/update` 更新
  - [x] `GET /api/plugins/updates` 可更新检查
  - [x] `POST /api/plugins/:id/enable` 启用/禁用
- [x] 前端管理面板 + Auth 体系（登录页 + Auth Store + 路由守卫 + 用户/角色/审计管理）
  - [x] `Login.tsx` 本地登录 + SSO 选择
  - [x] `stores/auth.ts` Zustand auth store
  - [x] `api/client.ts` 统一 API 封装
  - [x] `AuthGuard` + `AdminGuard` 路由守卫
  - [x] `Sidebar.tsx` 用户下拉 + admin 菜单
  - [x] `/admin/users` 用户管理 CRUD
  - [x] `/admin/roles` 角色管理 CRUD
  - [x] `/admin/audit` 审计日志查询
- [x] v1.0.0 正式版收尾
  - [x] `/plugins` 插件市场前端（安装/卸载/更新/启用禁用 + 市场浏览）
  - [x] `/workflows` 工作流管理前端（CRUD + 执行 + JSON 编辑器）
  - [x] Dashboard Stats 增强（daily 趋势 + model 使用统计）
  - [x] 版本号 `1.0.0`（全部包 + CLI）

### 🟡 P1 - 稳定性与工程化

#### 开发体验
- [x] ESLint 配置（已补齐配置与依赖）
- [x] Prettier 配置
- [x] Husky 预提交钩子
- [x] 单元测试框架（Vitest）
- [x] 基础测试用例（core 全量测试已通过，后续按新功能持续增补）

#### 日志与监控
- [x] 日志系统（`pino` + 统一 `requestId/traceId` 上下文 + 敏感字段脱敏）
- [x] 请求日志（HTTP request 级别）
- [x] 错误追踪（Sentry 可选接入：HTTP/WS/队列链路已打通）
- [x] 性能监控（Prometheus `/metrics` + Grafana 预置看板）

### 🟢 P2 - 体验增强

- [x] Docker 基础支持（Redis/PostgreSQL/可视化工具）
- [x] CI/CD 配置（GitHub Actions：lint/typecheck/build/test）
- [x] 性能基准测试（新增 `pnpm benchmark`，覆盖 HTTP + WebSocket，输出 JSON/Markdown 报告）
- [x] 性能回归门禁（新增 `pnpm benchmark:compare`，支持 baseline 对比 + 误差预算阈值判定）
- [x] 性能基准常规回归（CI 自动跑 benchmark + baseline 对比 + 报告归档）

---

## Backlog（待排期）

### 功能开发

#### AI 模型
- [x] DeepSeek Provider 基础实现
- [x] OpenAI 兼容 Provider（OpenAI 协议兼容层 + Provider 注册 + 基础测试）
- [x] 模型配置 UI（补齐默认模型管理：设置/展示/启停联动）
- [x] 模型切换（补齐策略与持久化：默认模型回退 + 会话创建继承 + 前端持久化）
- [x] 多模型能力矩阵标准化（Provider 能力契约 + `/api/models/capabilities` + `models.capabilities`）

#### 消息通道
- [x] WebChat（会话同步 + 重连恢复 + 错误收敛）
- [x] 微信集成（wechaty 动态导入 + WeChatAdapter + 消息缓存回复 + 10 测试覆盖）
- [x] 钉钉机器人（DingTalkAdapter + 机器人 webhook 回消息 + 签名支持）
- [x] 飞书机器人（LarkAdapter + 事件订阅 URL 验证 + 回消息链路）
- [x] 通道插件化边界梳理（配置契约校验 + 鉴权声明 + 消息路由契约）

#### Web UI
- [x] 聊天界面优化（消息气泡/空状态/会话标签/输入区域/深色模式适配）
- [x] 消息 Markdown 渲染
- [x] 代码高亮
- [x] 文件上传（前后端完整链路 + 测试覆盖）
- [x] 主题切换（light/dark/system + 持久化 + 测试覆盖）

#### 工具系统
- [-] 浏览器控制（规划中，延期至 Phase 2）
- [-] 代码执行（已有代码分析工具，执行沙箱延期至 Phase 2）
- [x] 文件工具（读取/目录）
- [x] 系统命令工具（白名单扩展至 ~60 命令 + 参数化/路径限制/输出限制/环境过滤/超时/危险字符过滤 + 跨平台测试覆盖）

### 技术债务

- [x] 错误处理一致性
- [x] 类型检查覆盖
- [x] 性能优化
- [x] 重复代码重构（通道适配器基类 + 工具函数 + ChannelResponse 工厂函数）

---

## 已完成 ✅（里程碑）

### Week 1（2026-04-01）
- [x] 项目架构设计
- [x] Monorepo 搭建
- [x] 基础类型定义
- [x] Gateway 基础框架
- [x] Web UI 基础框架
- [x] CLI 基础框架
- [x] 文档初始化

### Week 1-2（阶段增量）
- [x] 工具注册与执行引擎
- [x] 工具编排器（DAG + 并行）
- [x] 预定义工作流模板（5 个）
- [x] 会话/消息 SQLite 持久化链路

---

## 任务状态图例

- `[ ]` - 待办
- `[/]` - 进行中
- `[x]` - 完成
- `[-]` - 取消/跳过
- `[?]` - 待定/需讨论

## 更新记录

- 2026-04-01: 初始化任务清单
- 2026-04-14: 根据当前代码实现校准状态
- 2026-04-14: 完成通道插件化边界收口（配置/鉴权/路由契约）
- 2026-04-14: 完成多模型能力矩阵收口（统一能力字段与查询接口）
- 2026-04-15: 完成性能基准常规回归接入（基线文件 + CI 回归流程）
- 2026-04-15: 完成错误处理一致性收口（统一错误码 + HTTP/WS/Queue 错误结构）
- 2026-04-15: 完成类型检查覆盖收口（边界 DTO zod 校验 + WS 协议对象共享类型）
- 2026-04-15: 完成性能优化首轮（会话列表消息计数改为聚合查询，benchmark 对比通过）
- 2026-04-15: 推进重复代码重构（SessionManager 收口会话计数回填，HTTP/WS 共用）
- 2026-04-15: 推进重复代码重构（HTTP 路由输入校验模板收口，统一 `parseRequestInput`）
- 2026-04-15: 推进重复代码重构（新增 `sendInvalidRequestError`，统一 HTTP fallback 错误模板）
- 2026-04-15: 完成 benchmark 波动隔离复测（确认门禁存在阈值敏感场景，`ws.connect` 波动可触发单轮 FAIL）
- 2026-04-15: 推进重复代码重构（新增 `sendNotFoundError`/`sendBadRequestError`，收口会话与 webhook 重复错误模板）
- 2026-04-15: 推进重复代码重构（WS `handleRequest` 新增错误响应 helper，收口验证与鉴权失败模板）
- 2026-04-15: 推进重复代码重构（WS 参数校验统一 `parseWsRequestInput`，补齐 validation/not_found/invalid_request/unauthorized E2E 用例）
- 2026-04-22: Phase 1 Week 8 MVP 收口完成
- 2026-04-22: Phase 2 Week 9-10 启动 — 企业微信通道适配器
  - 新增 `WeComAdapter`（继承 `AbstractChannelAdapter`）
  - 支持 GET URL 验证（echostr 返回 + SHA1 签名校验）
  - 支持 POST XML 消息解析（text/image/voice/video/file + 事件过滤）
  - 支持通过企业微信 API 发送消息（access_token 获取与缓存）
  - 15 个单元测试覆盖
  - 扩展 `WebhookCapableAdapter` 接口：`verifyWebhookUrl` 可选方法
  - 网关新增 `GET /api/webhooks/:adapterId` 路由处理 URL 验证
  - 构建 5/5 通过，全量测试 159 通过
- 2026-04-22: Phase 2 Week 11-12 — 国内云模型 Provider 接入
  - 通义千问 `QwenProvider`：DashScope 兼容模式 + 4 模型 + SSE 流式 + 8 测试
  - 文心一言 `ErnieProvider`：千帆 OpenAI 兼容模式 + 3 模型 + SSE 流式 + 8 测试
  - 豆包 `DoubaoProvider`：火山方舟兼容模式 + 3 模型 + SSE 流式 + Vision + 8 测试
  - 接入 Gateway/CLI 注册链路 + 能力矩阵
- 2026-04-22: Phase 2 Week 9-10 — 邮件通道适配器
  - 新增 `EmailAdapter`（继承 `AbstractChannelAdapter`）
  - SMTP 发送：nodemailer + 自动 TLS 判断（端口 465）
  - IMAP 接收：imapflow 轮询 INBOX + `mailparser` 解析邮件内容
  - 支持配置：smtpHost/port/user/pass/secure、imapHost/port/user/pass/secure、fromAddress、pollingInterval、markAsRead
  - access_token 缓存机制（提前 60 秒刷新）
  - 9 个单元测试覆盖（初始化/SMTP 发送/IMAP 轮询/错误处理/未配置场景）
  - 构建 5/5 通过，全量测试 168 通过（shared 1 + web-ui 1 + cli 7 + core 159）
  - P1-1 文件上传：前后端完整链路（multipart + UploadService + HTTP 路由）+ 6 测试
  - P1-2 主题切换：light/dark/system + Ant Design ConfigProvider + TailwindCSS dark 变体 + localStorage 持久化
  - P1-3 系统命令工具加固：白名单扩展至 ~60 命令 + 参数化/路径限制/输出限制/环境过滤/超时/危险字符过滤 + 跨平台测试
  - 聊天界面优化：消息气泡/空状态/会话标签/输入区域/深色模式适配/智能时间/Streaming 光标
  - 微信集成（wechaty）：WeChatAdapter + 动态导入 + 消息缓存回复 + 10 测试覆盖
  - 重复代码重构：AbstractChannelAdapter 基类 + 适配器工具函数 + ChannelResponse 工厂函数，消除 ~311 行重复代码
  - 系统测试跨平台修复：echo/pwd/sleep/seq 替换为 node -e 脚本，确保 Windows 通过
  - 全量测试 144 通过（shared 1 + web-ui 1 + cli 7 + core 135），构建 5/5 通过
- 2026-04-22: Phase 2 Week 13-14 — 高级功能（使用统计 + 记忆系统 + 导入导出 + 插件系统 MVP）
  - 使用统计：`usage_records` 表 + `StatsService` + `/api/stats/*` 路由 + Prometheus 扩展 + Dashboard 真实数据 + 4 测试
  - 记忆系统：`channel_sessions` DB 持久化 + `maxContextMessages=20` 截断 + 超长上下文保留 system + 最近 N 条
  - 导入/导出：`ExportService`/`ImportService` + ZIP 打包 + `POST /api/export`/`POST /api/import` + 3 测试
  - 插件系统 MVP：`Plugin` 接口 + `PluginManager` 动态加载 + `PluginContext` 暴露核心服务 + `plugins/deepseek` 包装为 Plugin
  - 构建 5/5 通过，全量测试 206 通过（shared 1 + web-ui 1 + cli 7 + core 197），29 个测试文件
- 2026-04-22: Phase 3 Week 15 — 多用户系统 + RBAC
  - `users` 表启用：role_id + status，PBKDF2-HMAC-SHA256 密码哈希（内置 crypto，无新增依赖）
  - `roles` 表 + `RoleService`：内置 admin/user/guest 三角色，支持自定义角色
  - `UserService`：用户 CRUD + 密码验证 + 角色分配
  - `TokenManager` DB 化：`tokens` 表持久化，向后兼容内存模式
  - `AuthService`：login/logout/me/changePassword
  - 登录改造：email/password 查 DB，保留 config masterPassword 向后兼容
  - 资源所有权中间件：非 admin 只能访问自己的 session/message
  - 新增路由：`/api/auth/logout`, `/api/auth/me`, `/api/users/*`, `/api/roles/*`, `/api/users/me/password`
  - 新增测试 28 个（password 5 + user-service 10 + role-service 7 + token-db 6）
- 2026-04-22: Phase 3 Week 16 — 审计日志 + 工作流持久化
  - `audit_logs` 表 + `AuditService`：log/query/stats，异步写入不阻塞主流程
  - 审计查询 API：`GET /api/audit/logs` + `/api/audit/stats`（admin only，时间范围/分页过滤）
  - `workflows` 表 + `WorkflowService`：自定义工作流 CRUD + 执行
  - 工作流 HTTP API：`POST /api/workflows`, `GET/PUT/DELETE /api/workflows/:id`, `POST /api/workflows/:id/run`
  - 内置模板保留（`builtin:` 前缀），与自定义工作流统一列表
  - 新增测试 13 个（audit 6 + workflow 7）
  - 构建 5/5 通过，全量测试 247 通过（shared 1 + web-ui 1 + cli 7 + core 238），35 个测试文件
- 2026-04-22: Phase 3 Week 17 — SSO/OAuth2 + LDAP 认证
  - 新增依赖：`openid-client@^5.7.0` + `ldapjs@^3.0.7` + `@types/ldapjs`
  - 数据库 Schema 扩展：`users` 表新增 `auth_provider`/`external_id`，新增 `oauth_states` 临时表
  - Config Schema 扩展：`auth.oauth.providers[]` + `auth.ldap` 完整配置
  - `OAuthService`：OIDC 自动发现 + OAuth2 手动配置，state CSRF 防护，用户匹配/创建/角色映射
  - `LDAPService`：bind/search 认证，group 查询 + groupRoleMapping 角色解析
  - `SSOService`：统一认证入口，聚合本地/OAuth/LDAP 方法列表
  - HTTP 路由：`GET /api/auth/providers`, `GET /api/auth/oauth/:provider`, `GET /api/auth/oauth/callback`, `POST /api/auth/ldap`
  - 新增测试 13 个（oauth-service 6 + ldap-service 4 + sso-service 3）
  - 构建 5/5 通过，全量测试 269 通过（shared 1 + web-ui 1 + cli 7 + core 260），41 个测试文件
- 2026-04-22: Phase 3 Week 18 — 插件市场
  - 数据库 Schema 扩展：新增 `plugins` 表（id/name/version/source/enabled/installed_at/manifest）
  - Config Schema 扩展：`plugins.registryUrl` 自定义 registry 地址
  - `PluginManifest` 扩展：新增 `id`/`author`/`permissions`/`dependencies`
  - `PluginMarketService`：远程 registry 查询 + ZIP 下载解压 + 安装/卸载/更新/版本检查
  - `PluginManager` 改造：DB 驱动加载 + unload/reload 支持
  - HTTP 路由：`/api/market/plugins`, `/api/market/plugins/:id`, `/api/plugins`, `/api/plugins/install`, `/api/plugins/uninstall`, `/api/plugins/update`, `/api/plugins/updates`, `/api/plugins/:id/enable`
  - 新增测试 13 个（market-service 13）
  - 构建 5/5 通过，全量测试 273 通过（shared 1 + web-ui 1 + cli 7 + core 264），42 个测试文件
- 2026-04-22: Phase 3 Week 19 — 前端管理面板 + Auth 体系
  - 新增 `dayjs` 依赖（web-ui）
  - 登录页（`Login.tsx`）：本地邮箱密码登录 + SSO 提供商选择 + 自动跳转
  - Auth Store（`stores/auth.ts`）：Zustand + persist，token/user/scopes/isAdmin/logout
  - API Client（`api/client.ts`）：统一 GET/POST/PUT/DELETE + Bearer Token
  - 路由守卫：`AuthGuard` + `AdminGuard`
  - Sidebar 改造：用户头像/名称/邮箱 + 下拉登出 + admin「管理」菜单分组
  - 用户管理页（`/admin/users`）：列表/新建/编辑/删除 + 角色分配
  - 角色管理页（`/admin/roles`）：列表/新建/编辑/删除 + 权限标签 + 内置保护
  - 审计日志页（`/admin/audit`）：日志列表 + 时间范围筛选 + 统计卡片
  - 构建 5/5 通过，全量测试 273 通过（shared 1 + web-ui 1 + cli 7 + core 264），42 个测试文件
- 2026-04-22: Phase 3 Week 20 — v1.0.0 正式版收尾
  - 插件市场前端（`/plugins`）：已安装管理 + 市场浏览/安装/卸载/更新/启用禁用
  - 工作流管理前端（`/workflows`）：CRUD + 执行 + JSON 定义编辑器 + 执行结果 + 详情查看
  - Dashboard 增强：14 天每日趋势表格 + 模型使用统计表格
  - 版本号升级：全部包 `0.1.0` → `1.0.0`（含 CLI 硬编码版本号）
  - 构建 5/5 通过，全量测试 273 通过（shared 1 + web-ui 1 + cli 7 + core 264），42 个测试文件
- 2026-04-23: Bugfix 轮次 — Ollama 工具调用 + 仪表盘统计 + 设置页渠道类型
  - **Ollama 工具调用修复**：
    - 流式解析丢弃 `tool_calls`：中间 chunk 的 `if (!content && !isDone) continue` 跳过了含 `tool_calls` 的行
    - `arguments` 格式错误：`gemma4:31b` 要求 `tool_calls.function.arguments` 为对象而非字符串
    - Node.js 两轮对话验证通过
  - **仪表盘统计修复**：
    - `configuredModels` 从 `config.json5` 读取（原从空数据库表读取）
    - 每日趋势/模型使用 API 返回格式与前端字段名对齐
    - 统计卡片布局改为响应式 `xs={24} sm={12} lg={6}`
  - **设置页渠道类型修复**：
    - 渠道类型下拉菜单从 `/api/channels/contracts` 动态加载（原硬编码 webhook/lark/dingtalk）
    - 表单字段根据 `configFields` 动态渲染，支持全部 10 种渠道类型
  - **设置页模型配置增强**：
    - 提供者下拉从 `/api/models/capabilities` 动态加载
    - Ollama 模式下模型 ID 变为下拉选择（本地已部署模型列表）
    - Ollama 模式下 API Key 隐藏、Base URL 默认填充
    - 模型名称自动同步
