# Maverick Claw 快速启动指南

## 3 步启动

### 第 1 步：准备依赖（必需 + 可选）

```powershell
# 必需：安装 Node.js 20+ 与 pnpm 9+
node -v
pnpm -v

# 可选：仅当你需要 Redis/队列能力时启动
docker compose up -d redis

# 可选：PostgreSQL 当前为预留能力（默认存储仍为 SQLite）
# docker compose up -d postgres
```

### 第 2 步：安装并构建

```powershell
pnpm install
pnpm build
```

### 第 3 步：启动 Gateway

```powershell
# 推荐后台启动
pnpm --filter @maverick-claw/cli build
node packages/cli/dist/cli.js gateway start --daemon

# 验证状态
node packages/cli/dist/cli.js status
```

---

## 常用命令速查

```powershell
# 启动/停止
node packages/cli/dist/cli.js start
node packages/cli/dist/cli.js stop

# 状态与日志
node packages/cli/dist/cli.js status
node packages/cli/dist/cli.js logs -f

# 配置
node packages/cli/dist/cli.js config view
node packages/cli/dist/cli.js config validate

# 聊天与工作流
node packages/cli/dist/cli.js send "你好"
node packages/cli/dist/cli.js workflow list
```

---

## 访问地址

| 服务 | 地址 |
|------|------|
| Web UI | http://127.0.0.1:31987 |
| API | http://127.0.0.1:31987/api |
| WebSocket | ws://127.0.0.1:31987/ws |

---

## 说明

- 默认数据存储：SQLite（本机 `~/.maverick-claw`）。
- Web UI 与 CLI 均可触发聊天链路，建议首次排障优先看 `node packages/cli/dist/cli.js logs -f`。
