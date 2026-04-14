import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';

export interface QueueConnectionOptions {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  maxRetriesPerRequest?: number | null;
  enableReadyCheck?: boolean;
}

export function createRedisConnection(options: QueueConnectionOptions = {}): Redis {
  const {
    host = process.env.REDIS_HOST || 'localhost',
    port = parseInt(process.env.REDIS_PORT || '6379'),
    password = process.env.REDIS_PASSWORD,
    db = parseInt(process.env.REDIS_DB || '0'),
    tls = process.env.REDIS_TLS === 'true',
    maxRetriesPerRequest = null,  // BullMQ requires this to be null
    enableReadyCheck = false,
  } = options;

  const redis = new Redis({
    host,
    port,
    password,
    db,
    tls: tls ? {} : undefined,
    maxRetriesPerRequest,
    enableReadyCheck,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      logger.debug({ attempt: times, delay }, 'Redis retry');
      return delay;
    },
  });

  redis.on('connect', () => {
    logger.info({ host, port }, 'Redis connected');
  });

  redis.on('error', (err) => {
    logger.error({ err }, 'Redis error');
  });

  redis.on('reconnecting', () => {
    logger.warn('Redis reconnecting...');
  });

  return redis;
}

// Singleton connection
let globalConnection: Redis | null = null;

export function getQueueConnection(options?: QueueConnectionOptions): Redis {
  if (!globalConnection) {
    globalConnection = createRedisConnection(options);
  }
  return globalConnection;
}

export async function closeQueueConnection(): Promise<void> {
  if (globalConnection) {
    await globalConnection.quit();
    globalConnection = null;
    logger.info('Redis connection closed');
  }
}
