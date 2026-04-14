# Maverick_Claw 架构设计

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户交互层                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 Web UI (浏览器为主)                      │ │
│  │                   React + Ant Design                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                         ↑ WebSocket/HTTP                      │
├─────────────────────────────────────────────────────────────┤
│                      Maverick_Claw Gateway                    │
│                       Node.js + Fastify                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Core Services                                          │ │
│  │  ├── Session Manager    (会话管理)                       │ │
│  │  ├── Agent Runtime      (AI Agent 执行)                  │ │
│  │  ├── Channel Router     (消息通道路由)                   │ │
│  │  ├── Tool Registry      (工具注册表)                     │ │
│  │  └── Plugin System      (插件系统)                       │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                      消息通道层                               │
│  微信 │ 钉钉 │ 飞书 │ 企业微信 │ WebChat │ Telegram │ Slack   │
├─────────────────────────────────────────────────────────────┤
│                      AI 模型层                                │
│  DeepSeek │ 文心一言 │ 通义千问 │ 豆包 │ OpenAI │ Claude    │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### Gateway (packages/core)

基于 Fastify 的 HTTP/WebSocket 服务器，负责：
- 客户端连接管理
- 消息路由
- 会话管理
- 插件生命周期

### Web UI (packages/web-ui)

基于 React + Ant Design 的单页应用：
- 聊天界面
- 配置管理
- 状态监控
- 插件管理

### CLI (packages/cli)

命令行工具，用于：
- 启动/停止 Gateway
- 配置管理
- 快速操作

## WebSocket 协议

### 连接握手

```typescript
// Client -> Server
{
  type: 'connect',
  id: 'uuid',
  params: {
    clientType: 'web' | 'cli' | 'node',
    clientVersion: '0.1.0',
    deviceId: 'uuid',
    token: 'optional-auth-token'
  }
}

// Server -> Client
{
  type: 'connect',
  id: 'uuid',
  ok: true,
  payload: {
    serverVersion: '0.1.0',
    sessionToken: 'token',
    config: {
      models: ['deepseek-chat'],
      channels: ['webchat']
    }
  }
}
```

### 请求/响应模式

```typescript
// Request
{
  type: 'req',
  id: 'uuid',
  method: 'chat.send',
  params: {
    sessionId: 'uuid',
    message: '你好'
  }
}

// Response
{
  type: 'res',
  id: 'uuid',
  ok: true,
  payload: { messageId: 'uuid' }
}
```

### 服务器推送事件

```typescript
{
  type: 'event',
  event: 'chat.chunk',
  payload: {
    messageId: 'uuid',
    content: '流式回复内容'
  },
  timestamp: 1234567890
}
```

## 插件系统

插件是一个独立的 npm 包，通过以下方式集成：

```typescript
// 插件入口
export default {
  name: 'wechat',
  version: '0.1.0',
  
  // 初始化
  async init(context) {
    // 注册通道/模型/工具
  },
  
  // 启动
  async start() {
    // 连接服务
  },
  
  // 停止
  async stop() {
    // 清理资源
  }
};
```

## 数据存储

### SQLite (默认)

适合个人用户，零配置：
- 会话数据
- 消息历史
- 配置

### PostgreSQL（预留）

当前代码主链路默认使用 SQLite。PostgreSQL 相关配置与容器已预留，后续用于：
- 多用户部署
- 高可用与备份恢复

## 安全设计

1. **本地优先** - 默认只监听 localhost
2. **Token 认证** - HTTP 与 WebSocket 握手均支持 Token 校验
3. **数据加密** - 敏感配置加密存储
4. **沙箱执行** - 代码执行在隔离环境

## 部署架构

### 单机部署

```
[Browser] ←→ [Maverick_Claw Gateway + Web UI]
                    ↓
              [SQLite]
```

### 服务器部署

```
[Browser] ←→ [Nginx] ←→ [Maverick_Claw Gateway]
                              ↓
                        [PostgreSQL]
```
