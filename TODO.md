# Maverick_Claw 任务清单

> 本清单已按当前代码状态校准：`[x] 已完成`、`[/] 进行中`、`[ ] 待办`。

## 当前 Sprint（进行中）

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
- [ ] 微信集成（wechaty）
- [x] 钉钉机器人（DingTalkAdapter + 机器人 webhook 回消息 + 签名支持）
- [x] 飞书机器人（LarkAdapter + 事件订阅 URL 验证 + 回消息链路）
- [x] 通道插件化边界梳理（配置契约校验 + 鉴权声明 + 消息路由契约）

#### Web UI
- [/] 聊天界面优化
- [x] 消息 Markdown 渲染
- [x] 代码高亮
- [ ] 文件上传
- [ ] 主题切换

#### 工具系统
- [/] 浏览器控制（规划中，未默认内置）
- [/] 代码执行（已有代码分析工具，执行沙箱待补）
- [x] 文件工具（读取/目录）
- [/] 系统命令工具（白名单模式，需扩展与加固）

### 技术债务

- [x] 错误处理一致性
- [x] 类型检查覆盖
- [x] 性能优化
- [/] 重复代码重构

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
