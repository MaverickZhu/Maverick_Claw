# Maverick Claw 开发日志

## 📅 2026-04-15 工作记录

### ✅ 今日完成

#### 1. 主线 C 第 1 项：性能基准纳入常规回归

- 新增基线目录：`benchmark-baselines/`
- 入库首个基线报告：`benchmark-baselines/core-baseline.json`
- 补充基线维护说明：`benchmark-baselines/README.md`

#### 2. CI 回归链路接入

- `ci.yml` 新增性能回归步骤：
  - 启动 core 网关并等待健康检查
  - 运行 HTTP + WebSocket 基准场景
  - 使用仓库基线执行 `benchmark:compare`
  - 自动上传 `benchmark-results/**` 与 core 启动日志 artifact

#### 3. 文档与计划同步

- 更新 `README.md`、`USER_GUIDE.md`（补齐常规回归用法）
- 更新 `TODO.md`、`ROADMAP.md`、`CHANGELOG.md`（标记主线 C 第 1 项完成）

#### 4. 主线 C 第 2 项：错误处理一致性收口

- 新增统一错误契约模块：`packages/core/src/errors/standard-error.ts`
- HTTP 统一错误响应结构：`error/errorCode/requestId/details`
- WebSocket 失败响应补齐 `errorDetail`（兼容保留 `error` 字符串）
- Queue 统一错误码映射（`queue_not_found` / `queue_not_initialized` / `queue_job_failed`）
- `JobResult` 新增 `errorCode/errorDetails`

#### 5. 回归验证

- `pnpm --filter @maverick-claw/shared typecheck` ✅
- `pnpm --filter @maverick-claw/shared build` ✅
- `pnpm --filter @maverick-claw/core typecheck` ✅
- `pnpm --filter @maverick-claw/web-ui typecheck` ✅
- `pnpm --filter @maverick-claw/core test` ✅（17 文件 / 101 测试）
- `pnpm --filter @maverick-claw/core lint` ✅（仅既有 warning）

#### 6. 主线 C 第 3 项：类型检查覆盖持续提升

- HTTP 路由边界 DTO 收口：
  - `:id` / `:queueName` / `:adapterId` 路径参数统一 zod 校验
  - `config/system`、`config/auth`、`config/models` 请求体统一 zod 校验
  - 新增 `parseRequestInput(...)`，统一校验失败返回 `validation_failed`
- 协议对象收口：
  - `@maverick-claw/shared` 新增 `ChatChunkEventPayload` / `ChatCompleteEventPayload` / `ChatErrorEventPayload`
  - Core WebSocket 事件发送侧改为直接引用共享协议类型
  - Web UI 聊天页对 REST/WS payload 全部改为 zod 解析，移除 `payload as {...}` 断言

#### 7. 主线 D 第 1 项：技术债务性能优化（会话列表热点）

- 热点定位：
  - 以 `benchmark` 基线定位 `ws.sessions.list` 为可优化链路
  - 识别瓶颈为会话列表中对每个 session 单独执行 `COUNT(*)`（N+1 查询）
- 改造内容：
  - `MessageManager` 新增 `getMessageCounts(sessionIds)` 批量聚合计数接口
  - HTTP `/api/sessions` 改为批量查询并回填 `messageCount`
  - WebSocket `sessions.list` 改为批量查询并回填 `messageCount`
  - 新增测试：
    - `storage/message.test.ts` 增加批量计数单测
    - `integration.test.ts` 增加 `sessions` 列表 `messageCount` 回归用例
- 性能对比（同参数）：
  - baseline：`ws.sessions.list` p95 `9.14ms`，吞吐 `1018.22 req/s`
  - candidate：`ws.sessions.list` p95 `5.96ms`，吞吐 `1214.48 req/s`
  - `benchmark:compare` 结果：PASS（误差预算门禁通过）

#### 8. 本轮验证

- `pnpm --filter @maverick-claw/core typecheck` ✅
- `pnpm --filter @maverick-claw/core test` ✅（17 文件 / 103 测试）
- `pnpm --filter @maverick-claw/core benchmark -- --output-dir ../../benchmark-results/perf-pass1 ...` ✅
- `pnpm --filter @maverick-claw/core benchmark -- --output-dir ../../benchmark-results/perf-pass2 ...` ✅
- `pnpm --filter @maverick-claw/core benchmark:compare -- --baseline ... --candidate ...` ✅

#### 9. 主线 D 第 2 项（进行中）：重复代码重构（会话计数视图）

- 重构目标：
  - 消除 `HTTP /api/sessions`、`HTTP /api/sessions/:id`、WS `sessions.list`、WS `sessions.get`
    中重复的 `messageCount` 拼装逻辑
- 实施内容：
  - `SessionManager` 新增：
    - `getSessionWithMessageCount(id)`
    - `listSessionsWithMessageCount(filter)`
    - 私有辅助 `attachMessageCount(sessions)`
  - Gateway 层改造：
    - HTTP 会话列表/详情改为统一调用 `SessionManager` 的计数视图方法
    - WS 会话列表/详情改为统一调用 `SessionManager` 的计数视图方法
- 新增测试：
  - `storage/session.test.ts`（聚合计数列表 + 单会话计数视图）
- 验证结果：
  - `pnpm --filter @maverick-claw/core typecheck` ✅
  - `pnpm --filter @maverick-claw/core test` ✅（18 文件 / 105 测试）
  - benchmark：`perf-pass2` vs `perf-pass3` 回归对比 PASS

#### 10. 主线 D 第 2 项（进行中）：HTTP 输入校验模板收口

- 重构内容：
  - 将以下路由从手写 `safeParse + sendHttpError` 迁移为统一 `parseRequestInput(...)`：
    - `POST /api/auth/login`
    - `POST /api/sessions`
    - `POST /api/sessions/:id/messages`
    - `POST /api/workflows/run`
    - `PUT /api/config/models/default`
    - `POST /api/config/channels`
    - `PUT /api/config/channels/:id`
  - 统一错误返回结构与日志路径，减少重复模板代码。
- 验证结果：
  - `pnpm --filter @maverick-claw/core typecheck` ✅
  - `pnpm --filter @maverick-claw/core test` ✅（18 文件 / 105 测试）
  - `pnpm --filter @maverick-claw/core lint` ✅（仅既有 warning）
- 性能观察：
  - `perf-pass3` → `perf-pass4` / `perf-pass4c` 对比出现 FAIL（WS 吞吐下降）
  - 本次改动未触达 WebSocket 请求处理链路，初步判断为运行环境波动；后续需在更稳定环境复测确认。

#### 11. 主线 D 第 2 项（进行中）：benchmark 波动隔离复测 + HTTP fallback 模板收口

- 1) 隔离复测（先做）：
  - 使用独立 `MAVERICK_CLAW_CONFIG_DIR/MAVERICK_CLAW_DATA_DIR` 启动隔离网关（`core start`）
  - 连续运行 3 轮 benchmark（同代码同阈值）：
    - run1 vs run2：`benchmark:compare` FAIL（`ws.connect` 吞吐下降 `18.15%`）
    - run1 vs run3：`benchmark:compare` PASS
  - 在同参数（`wsRequestTotal=300`, `wsRequestConcurrency=20`）下复测：
    - 隔离环境 `ws.sessions.list` p95 `4.33ms`，吞吐 `1378.84 req/s`
    - 对照 `perf-pass4d`（31987 目标）`ws.sessions.list` p95 `8.14ms`，吞吐 `868 req/s`
  - 结论：
    - 回归门禁对 `ws.connect` 存在阈值敏感区间（同代码单轮可 FAIL/PASS）
    - `ws.sessions.list` 的极端回退更可能来自运行模式/环境差异，而非本轮 HTTP 模板重构本身

- 2) 重复模板收口（后做）：
  - `packages/core/src/gateway/http.ts` 新增 `sendInvalidRequestError(...)`
  - `packages/core/src/gateway/http.ts` 新增 `sendNotFoundError(...)` / `sendBadRequestError(...)`
  - 将以下异常分支统一改为 helper：
    - `workflow` 执行失败
    - `config/system`、`config/auth` 更新失败
    - `config/models`（add/update/setDefault/remove）失败
    - `config/channels`（add/update/remove）失败
    - `queue pause/resume` 失败
    - `sessions` 查询与 `webhooks` 适配器校验失败
  - 效果：统一 fallback 策略，减少重复 `sendHttpError` 样板，降低后续分支参数漂移风险

- 验证结果：
  - `pnpm --filter @maverick-claw/core typecheck` ✅
  - `pnpm --filter @maverick-claw/core lint` ✅（仅既有 warning）
  - `pnpm --filter @maverick-claw/core test` ✅（18 文件 / 105 测试）

- 3) WS 错误模板同步收口：
  - `packages/core/src/gateway/websocket.ts` 新增：
    - `createWsValidationFailureResponse(...)`
    - `createWsNotFoundFailureResponse(...)`
    - `createWsBadRequestFailureResponse(...)`
    - `createWsUnauthorizedFailureResponse(...)`
    - `createWsForbiddenFailureResponse(...)`
  - `handleRequest` 中 `sessions/chat/workflow` 的校验失败、模型非法、会话不存在、未鉴权、scope 不足分支统一改为 helper
  - 目标：与 HTTP 层收口策略对齐，继续降低重复模板与 fallback 参数漂移

- 4) 验证结果：
  - `pnpm --filter @maverick-claw/core typecheck` ✅
  - `pnpm --filter @maverick-claw/core test` ✅（18 文件 / 105 测试）

#### 12. 主线 D 第 2 项（进行中）：WS 默认失败分支与参数校验模板继续收口

- 重构内容：
  - `packages/core/src/gateway/websocket.ts` 新增 `parseWsRequestInput(...)`，统一 `safeParse` 与 `validation_failed` 返回模板
  - 将 `sessions.create/get/delete/watch`、`chat.stream`、`workflow.run` 的参数解析分支改为复用统一 helper
  - 新增 `createWsMethodNotFoundFailureResponse(...)` 与 `createWsInternalFailureResponse(...)`，统一 default/catch fallback 分支
- 测试补齐：
  - `packages/core/src/__tests__/e2e.test.ts` 新增 4 条 WS 错误分支回归：
    - 非法参数 -> `validation_failed`
    - 会话不存在 -> `not_found`
    - 非法模型 -> `invalid_request`
    - token 鉴权开启下匿名调用 `chat.stream` -> `unauthorized`
- 验证结果：
  - `pnpm --filter @maverick-claw/core typecheck` ✅
  - `pnpm --filter @maverick-claw/core test` ✅（18 文件 / 109 测试）
  - `pnpm --filter @maverick-claw/core lint` ✅（仅既有 warning）

---

## 📅 2026-04-14 工作记录

### ✅ 今日完成

#### 1. 主线 B 第 2 项：通道插件化边界梳理

- 新增 `channels/contracts` 契约层，统一通道配置校验与归一化
- `ConfigManager` 在 `load/update/addChannel/updateChannel` 全链路执行配置契约
- 增加通道契约查询接口：`GET /api/channels/contracts`
- 统一消息路由入队元数据：`isGroup/groupId/userName/mentions/metadata`

#### 2. 主线 B 第 3 项：多模型接入标准化

- `ModelProvider` 新增 `getCapabilities()`，统一能力矩阵协议
- `DeepSeek/OpenAI/Kimi` 三个 Provider 完成能力矩阵对齐
- 新增模型能力查询：
  - HTTP: `GET /api/models/capabilities`
  - WS: `models.capabilities`
- `ChatService` / `ToolAgent` 改为按能力矩阵读取参数默认值（移除 provider 特判硬编码）

#### 3. 测试与文档同步

- 新增/更新单测与集成测试（含能力矩阵与契约接口）
- 校准 `ROADMAP.md`、`TODO.md`、`README.md`、`USER_GUIDE.md`、`CHANGELOG.md`
- 当前主线 B 三项已全部完成

### 📊 验证结果

- `pnpm --filter @maverick-claw/core lint` ✅（仅既有 warning）
- `pnpm --filter @maverick-claw/core typecheck` ✅
- `pnpm --filter @maverick-claw/shared typecheck` ✅
- `pnpm --filter @maverick-claw/core test` ✅（17 文件 / 100 测试）

---

## 📅 2026-04-03 工作记录

### ✅ 今日完成

#### 1. 多工具联合调用系统

**核心组件：**
- `ToolOrchestrator` - 工具编排器，支持 DAG 依赖图和并行执行
- `workflows.ts` - 预定义工作流模板

**实现功能：**
- ✅ DAG（有向无环图）依赖解析
- ✅ 并行工具执行（Promise.all）
- ✅ 变量替换系统（`${nodeId.output.field}`）
- ✅ 条件执行（基于前序结果）
- ✅ 智能执行计划生成

**文件位置：**
```
packages/core/src/tools/
├── orchestrator.ts    # 工具编排引擎（NEW）
└── workflows.ts       # 预定义工作流（NEW）
```

#### 2. 预定义工作流（5个）

| 工作流名 | 类型 | 说明 |
|---------|------|------|
| `analyze_project` | 并行 | 分析项目结构和关键文件 |
| `web_research` | 并行 | 同时获取多个网页内容 |
| `system_diagnostics` | 并行 | 系统诊断（信息+磁盘+进程） |
| `code_review` | 顺序 | 代码审查（读取→分析） |
| `data_pipeline` | 顺序 | 数据处理（获取→验证→分析） |

#### 3. ChatService 增强

**新增功能：**
- 工具执行汇总展示（"Executing N tool(s)..."）
- 执行时间和状态显示
- 失败工具提示
- `executeWorkflow()` API 支持直接调用工作流

**执行流程：**
```
AI 返回 tool_calls → 去重 → 创建执行计划 → 并行/顺序执行 → 
汇总结果 → 格式化展示 → 返回给 AI 生成回复
```

### 📊 当前系统状态

```
Gateway: 运行中 (PID: 32476)
端口: 31987
Web UI: http://127.0.0.1:31987

已加载组件:
✅ 10 个内置工具
✅ 5 个预定义工作流
✅ 工具编排引擎 (并行/顺序/依赖/条件)
✅ Kimi Provider (支持工具调用)
✅ Redis 连接
✅ SQLite 数据库
✅ WebSocket 服务
```

### 🔄 待办事项

#### 高优先级

1. **MCP 协议支持** 🔌
   - 研究 MCP (Model Context Protocol) 规范
   - 实现 MCP Client
   - 集成外部 MCP 工具（文件系统等）

2. **前端展示优化** 🎨
   - 工具执行过程可视化
   - 执行时间线展示
   - 结果预览面板

3. **工作流编辑器** 📝
   - 可视化工作流编辑
   - 自定义工作流保存

#### 中优先级

4. **更多工具**
   - 数据库查询工具
   - Git 操作工具
   - 图片处理工具

5. **工具市场** 🛒
   - 插件化工具系统
   - 第三方工具安装

### 📁 文件变更汇总

#### 新增文件（今日）
```
packages/core/src/tools/
├── orchestrator.ts      # 工具编排引擎
└── workflows.ts         # 预定义工作流
```

#### 修改文件（今日）
```
packages/core/src/
├── agent/chat.ts        # 集成工具编排器
└── tools/index.ts       # 导出新模块
```

### 🧠 关键技术决策

#### 1. 工具编排架构
- **DAG 依赖图**：使用 Map 存储节点，Set 跟踪状态
- **并行策略**：独立节点使用 Promise.all 并行执行
- **变量替换**：正则替换 `${nodeId.output.field}` 模式
- **条件执行**：函数回调，基于前序结果 Map

#### 2. 工作流设计
- **模板模式**：WorkflowTemplate 接口，可扩展
- **参数传递**：Record<string, unknown> 统一参数
- **执行计划**：ExecutionPlan 包含 nodes + parallel + timeout

### 💡 明日工作建议

1. **测试 today's 功能** - 验证多工具并行是否正常
2. **MCP 调研** - 阅读 MCP 协议文档，设计集成方案
3. **前端优化** - 丰富工具执行状态的 UI 展示

### 🔗 参考链接

- MCP 协议：https://modelcontextprotocol.io/
- 代码变更：见 git diff (packages/core/src/tools/)

---

## 📅 历史记录

### 2026-04-02
- ✅ 10个内置工具实现
- ✅ ToolExecutionEngine 工具执行引擎
- ✅ ToolResultFormatter 结果格式化
- ✅ 工具策略管控（allow/deny）
- ✅ 执行历史追踪
- ✅ Kimi API 工具调用修复

---

*记录时间: 2026-04-03*
*版本: v0.1.0*
*开发者: Maverick*
