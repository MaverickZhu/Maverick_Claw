# Maverick Claw 工具系统文档

## 概述

Maverick Claw 提供了一套完整的工具系统，让 AI 能够调用外部功能来增强能力。

## 内置工具列表

### 🕐 基础工具

#### `datetime`
获取当前日期和时间。

**参数：**
- `timezone` (string, 可选): 时区，默认 "Asia/Shanghai"
- `format` (string, 可选): 时间格式

**示例：**
```json
{
  "tool": "datetime",
  "arguments": {
    "timezone": "Asia/Shanghai"
  }
}
```

#### `calculator`
执行数学计算，支持基本运算和科学计算。

**参数：**
- `expression` (string, 必填): 数学表达式

**示例：**
```json
{
  "tool": "calculator",
  "arguments": {
    "expression": "123 + 456 * 2"
  }
}
```

### 📁 文件系统工具

#### `read_file`
读取文件内容。

**参数：**
- `path` (string, 必填): 文件路径
- `limit` (number, 可选): 最大读取行数

**安全限制：**
- 最大文件大小：10MB
- 支持相对路径和绝对路径

#### `list_directory`
列出目录内容。

**参数：**
- `path` (string, 可选): 目录路径，默认为当前目录
- `recursive` (boolean, 可选): 是否递归列出子目录

### 💻 系统工具

#### `system_info`
获取系统信息（CPU、内存、负载等）。

**返回：**
```json
{
  "platform": "win32",
  "arch": "x64",
  "cpus": { "count": 8, "model": "Intel Core i7" },
  "memory": { "total": "16 GB", "used": "8 GB", "usagePercent": 50 },
  "uptime": "2h 30m"
}
```

#### `run_command`
执行安全的系统命令。

**参数：**
- `command` (string, 必填): 命令
- `timeout` (number, 可选): 超时时间（秒），默认10秒

**白名单命令：**
`ping`, `echo`, `date`, `whoami`, `pwd`, `ls`, `dir`, `cat`, `head`, `tail`, `grep`, `find`, `wc`

### 🌐 网络工具

#### `fetch_url`
获取网页内容。

**参数：**
- `url` (string, 必填): 网页URL
- `maxLength` (number, 可选): 最大返回字符数，默认5000

**功能：**
- 自动转换 HTML 为文本
- 支持 JSON 内容
- 提取页面标题

#### `web_search`
网络搜索（占位实现，需配置搜索API）。

**参数：**
- `query` (string, 必填): 搜索关键词
- `numResults` (number, 可选): 结果数量，默认5

### 🔧 代码工具

#### `analyze_code`
分析代码质量。

**参数：**
- `code` (string, 必填): 代码内容
- `language` (string, 必填): 代码语言

**检测内容：**
- 代码行数、函数数、类数
- TODO/FIXME 注释
- 调试语句（console.log 等）
- 可能的硬编码密钥

#### `format_json`
格式化和验证 JSON。

**参数：**
- `json` (string, 必填): JSON 字符串
- `indent` (number, 可选): 缩进空格数，默认2

## 工具执行流程

```
用户消息 → AI 判断 → 工具调用 → 执行工具 → 返回结果 → AI 回复
```

1. **请求阶段**：AI 分析用户消息，判断是否需要调用工具
2. **调用阶段**：系统解析 tool_calls，去重处理
3. **执行阶段**：ToolExecutionEngine 按策略执行工具
4. **反馈阶段**：格式化结果，展示执行状态
5. **回复阶段**：AI 根据工具结果生成最终回复

## 工具策略配置

### 默认策略

```typescript
const policy: ToolPolicy = {
  allow: [],      // 白名单（空表示允许所有）
  deny: [],       // 黑名单
  timeout: 30000  // 默认超时30秒
}
```

### 限制特定工具

```typescript
// 只允许基础工具
const policy: ToolPolicy = {
  allow: ['datetime', 'calculator', 'system_info']
}

// 禁止危险操作
const policy: ToolPolicy = {
  deny: ['run_command', 'write_file']
}
```

## 添加自定义工具

### 1. 定义工具

```typescript
// packages/core/src/tools/builtins/my-tool.ts
import type { Tool } from '../types.js';

export const myTool: Tool = {
  definition: {
    name: 'my_tool',
    description: '工具描述',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: '参数描述'
        }
      },
      required: ['param1']
    }
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const param1 = String(args.param1);
    
    // 执行逻辑
    return { result: `处理: ${param1}` };
  }
};
```

### 2. 注册工具

```typescript
// packages/core/src/tools/builtins/index.ts
export { myTool } from './my-tool.js';

import { myTool } from './my-tool.js';

export const builtinTools: Tool[] = [
  // ... 其他工具
  myTool,
];
```

### 3. 重新构建

```bash
cd Maverick_Claw
pnpm build
```

## 工具执行历史

系统会自动记录工具执行历史，包括：
- 工具名称和参数
- 执行结果或错误
- 执行时长
- 时间戳

**查看历史：**
```typescript
const history = chatService.getToolHistory(sessionId);
```

## 安全考虑

1. **命令白名单**：`run_command` 只允许预定义的安全命令
2. **文件大小限制**：`read_file` 限制最大 10MB
3. **超时保护**：所有工具都有超时机制
4. **策略控制**：可通过策略限制可用工具

## 未来计划

- [ ] MCP (Model Context Protocol) 支持
- [ ] 多工具并行执行
- [ ] 工具链编排
- [ ] 外部工具插件系统
- [ ] 工具执行审批流程

---

*文档版本: 2026-04-02*
*对应代码版本: v0.1.0*
