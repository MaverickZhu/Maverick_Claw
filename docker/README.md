# Maverick Claw Docker 部署指南

本项目使用 Docker 部署后端数据库服务，实现本地数据存储，避免供应链投毒风险。

## 架构概述

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                        │
│              maverick-claw-network                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌───────────┐   │
│  │   Redis     │    │  PostgreSQL │    │  pgAdmin  │   │
│  │   :6379     │    │    :5432    │    │   :5050   │   │
│  │  (消息队列)  │    │  (数据存储)  │    │  (管理工具) │   │
│  └─────────────┘    └─────────────┘    └───────────┘   │
└─────────────────────────────────────────────────────────┘
         ↑
    本地应用连接
```

## 快速开始

### 1. 环境准备

确保已安装：
- Docker Desktop (Windows/Mac)
- Docker Engine + Docker Compose (Linux)

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，设置安全的密码
nano .env
```

### 3. 启动服务

**Windows:**
```powershell
.\docker\setup.bat
```

**Linux/Mac:**
```bash
./docker/setup.sh
```

或直接使用 Docker Compose：
```bash
# 启动核心服务
docker compose up -d redis postgres

# 启动包含管理工具
docker compose --profile tools up -d
```

## 服务说明

| 服务 | 端口 | 用途 | 必需 |
|------|------|------|------|
| Redis | 6379 | BullMQ 消息队列 | ✅ |
| PostgreSQL | 5432 | 可选远程数据库 | ❌ |
| RedisInsight | 5540 | Redis 可视化工具 | ❌ |
| pgAdmin | 5050 | PostgreSQL 管理工具 | ❌ |

## 数据持久化

所有数据通过 Docker Volumes 持久化：

| Volume | 用途 |
|--------|------|
| `maverick-claw-redis-data` | Redis 数据 |
| `maverick-claw-postgres-data` | PostgreSQL 数据 |
| `maverick-claw-redisinsight-data` | RedisInsight 配置 |
| `maverick-claw-pgadmin-data` | pgAdmin 配置 |

## 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f redis

# 停止服务
docker compose down

# 停止并删除数据卷（⚠️ 危险）
docker compose down -v

# 重启服务
docker compose restart

# 进入 Redis 控制台
docker exec -it mc-redis redis-cli

# 进入 PostgreSQL 控制台
docker exec -it mc-postgres psql -U maverick -d maverick_claw
```

## 安全配置

### Redis
- 默认监听所有接口（Docker 网络隔离）
- 启用 AOF 持久化
- 未设置密码（依赖网络隔离）

### PostgreSQL
- 使用环境变量设置强密码
- 创建独立应用用户 `mc_app`
- 默认监听所有接口

### 生产环境建议
1. 启用 Redis 密码认证
2. 使用 TLS/SSL 加密连接
3. 限制 Docker 网络访问
4. 定期备份数据卷

## 连接到应用

### 使用 SQLite（默认）
```typescript
// 无需配置，自动使用本地文件
storage: {
  type: 'sqlite'
}
```

### 使用 PostgreSQL
```typescript
storage: {
  type: 'postgres',
  url: 'postgresql://maverick:password@localhost:5432/maverick_claw'
}
```

### 使用 Redis
```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  // password: 'your-password' // 如启用认证
});
```

## 故障排除

### 端口冲突
如果端口被占用，修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "6380:6379"  # 使用 6380 代替 6379
```

### 权限问题 (Linux/Mac)
```bash
# 修复 Docker 权限
sudo chown -R $USER:$USER docker/
```

### 数据卷问题
```bash
# 列出数据卷
docker volume ls

# 删除特定数据卷
docker volume rm maverick-claw-redis-data
```

## 网络隔离

所有服务运行在独立的 Docker 网络 `maverick-claw-network` 中：
- 容器间可相互访问
- 外部访问通过端口映射控制
- 增强安全性，防止未授权访问
