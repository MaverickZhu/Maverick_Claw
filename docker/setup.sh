#!/bin/bash
# Maverick Claw Docker 部署脚本 (Linux/Mac)

set -e

echo "========================================"
echo " Maverick Claw Docker 部署脚本"
echo "========================================"
echo

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "[错误] Docker 未运行，请先启动 Docker"
    exit 1
fi

# 创建网络（如果不存在）
echo "[1/4] 检查 Docker 网络..."
if ! docker network inspect maverick-claw-network > /dev/null 2>&1; then
    echo "      创建网络: maverick-claw-network"
    docker network create maverick-claw-network
else
    echo "      网络已存在"
fi

# 启动核心服务
echo
echo "[2/4] 启动核心服务 (Redis, PostgreSQL)..."
docker compose up -d redis postgres

# 等待服务就绪
echo
echo "[3/4] 等待服务就绪..."
sleep 5

# 检查服务状态
echo
echo "[4/4] 检查服务状态..."
docker compose ps

echo
echo "========================================"
echo " 部署完成！"
echo "========================================"
echo
echo "服务地址:"
echo "  - Redis:      localhost:6379"
echo "  - PostgreSQL: localhost:5432"
echo
echo "查看日志: docker compose logs -f"
echo "停止服务: docker compose down"
echo

# 使脚本可执行
chmod +x "$0"
