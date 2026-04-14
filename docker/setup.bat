@echo off
chcp 65001 >nul
REM Maverick Claw Docker 部署脚本 (Windows)

echo ========================================
echo  Maverick Claw Docker 部署脚本
echo ========================================
echo.

REM 检查 Docker 是否运行
docker info >nul 2>&1
if errorlevel 1 (
    echo [错误] Docker 未运行，请先启动 Docker Desktop
    exit /b 1
)

REM 创建网络（如果不存在）
echo [1/4] 检查 Docker 网络...
docker network inspect maverick-claw-network >nul 2>&1
if errorlevel 1 (
    echo       创建网络: maverick-claw-network
    docker network create maverick-claw-network
) else (
    echo       网络已存在
)

REM 启动核心服务
echo.
echo [2/4] 启动核心服务 (Redis, PostgreSQL)...
docker compose up -d redis postgres

REM 等待服务就绪
echo.
echo [3/4] 等待服务就绪...
timeout /t 5 /nobreak >nul

REM 检查服务状态
echo.
echo [4/4] 检查服务状态...
docker compose ps

echo.
echo ========================================
echo  部署完成！
echo ========================================
echo.
echo 服务地址:
echo   - Redis:     localhost:6379
echo   - PostgreSQL: localhost:5432
echo.
echo 查看日志: docker compose logs -f
echo 停止服务: docker compose down
echo.

pause
