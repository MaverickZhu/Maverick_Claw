/**
 * 环境变量配置加载器
 * 从 .env 文件或系统环境变量读取配置
 */

import { logger } from '../utils/logger.js';

export interface EnvConfig {
  // 数据库配置
  database: {
    type: 'sqlite' | 'postgres';
    url?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    name?: string;
  };
  // Redis 配置
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    url?: string;
  };
  // 应用配置
  app: {
    port: number;
    host: string;
    logLevel: string;
    nodeEnv: string;
    configDir?: string;
  };
  // 错误追踪配置
  sentry: {
    dsn?: string;
    environment: string;
    release?: string;
    tracesSampleRate: number;
  };
}

/**
 * 从环境变量加载配置
 */
export function loadEnvConfig(): EnvConfig {
  const sentryRate = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0');

  const config: EnvConfig = {
    database: {
      type: (process.env.DB_TYPE as 'sqlite' | 'postgres') || 'sqlite',
      url: process.env.DB_URL,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      name: process.env.DB_NAME,
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      url: process.env.REDIS_URL,
    },
    app: {
      port: parseInt(process.env.GATEWAY_PORT || '31987', 10),
      host: process.env.GATEWAY_HOST || '127.0.0.1',
      logLevel: process.env.LOG_LEVEL || 'info',
      nodeEnv: process.env.NODE_ENV || 'development',
      configDir: process.env.MAVERICK_CLAW_CONFIG_DIR,
    },
    sentry: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: Number.isFinite(sentryRate) ? sentryRate : 0,
    },
  };

  // 如果提供了 Redis URL，解析它
  if (config.redis.url) {
    try {
      const url = new URL(config.redis.url);
      config.redis.host = url.hostname || config.redis.host;
      config.redis.port = parseInt(url.port || '6379', 10);
      config.redis.password = url.password || config.redis.password;
      config.redis.db = parseInt(url.pathname?.slice(1) || '0', 10);
    } catch (err) {
      logger.warn({ err }, 'Failed to parse Redis URL');
    }
  }

  // 如果提供了 DB URL，解析它
  if (config.database.url) {
    try {
      const url = new URL(config.database.url);
      config.database.type = url.protocol.slice(0, -1) as 'sqlite' | 'postgres';
      config.database.host = url.hostname;
      config.database.port = parseInt(url.port || '5432', 10);
      config.database.user = url.username;
      config.database.password = url.password;
      config.database.name = url.pathname?.slice(1);
    } catch (err) {
      logger.warn({ err }, 'Failed to parse DB URL');
    }
  }

  return config;
}

/**
 * 获取 Redis 连接选项 (用于 ioredis)
 */
export function getRedisOptions() {
  const env = loadEnvConfig();
  return {
    host: env.redis.host,
    port: env.redis.port,
    password: env.redis.password,
    db: env.redis.db,
    maxRetriesPerRequest: null, // BullMQ 要求
  };
}

/**
 * 获取数据库连接 URL
 */
export function getDatabaseUrl(): string {
  const env = loadEnvConfig();
  
  if (env.database.url) {
    return env.database.url;
  }
  
  if (env.database.type === 'postgres' && env.database.host) {
    const { user, password, host, port, name } = env.database;
    return `postgresql://${user}:${password}@${host}:${port}/${name}`;
  }
  
  // 默认 SQLite
  return 'sqlite';
}

// 导出单例配置
export const envConfig = loadEnvConfig();
