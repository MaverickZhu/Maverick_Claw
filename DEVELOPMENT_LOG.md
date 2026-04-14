# Maverick Claw 开发日志

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
