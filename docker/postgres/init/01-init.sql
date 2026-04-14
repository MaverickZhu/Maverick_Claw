-- Maverick Claw PostgreSQL 初始化脚本
-- 创建必要的表结构和扩展

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 启用全文搜索
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建应用用户（权限分离）
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'mc_app') THEN
        CREATE USER mc_app WITH PASSWORD 'mc_app_secure_2024';
    END IF;
END
$$;

-- 授权
GRANT CONNECT ON DATABASE maverick_claw TO mc_app;
GRANT USAGE ON SCHEMA public TO mc_app;
GRANT CREATE ON SCHEMA public TO mc_app;

-- 注释
COMMENT ON DATABASE maverick_claw IS 'Maverick Claw Gateway 数据库';

-- 打印完成信息
SELECT 'Maverick Claw 数据库初始化完成' AS status;
