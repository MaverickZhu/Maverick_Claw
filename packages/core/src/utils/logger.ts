import pino from 'pino';
import { getLogContext } from './log-context.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'maverick-claw-core',
    env: process.env.NODE_ENV || 'development',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      'password',
      '*.password',
      'token',
      '*.token',
      'apiKey',
      '*.apiKey',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'request.headers.authorization',
      'request.headers.cookie',
      'Authorization',
      'Cookie',
    ],
    censor: '[REDACTED]',
  },
  mixin() {
    return getLogContext() || {};
  },
  transport: process.env.NODE_ENV === 'development' 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
