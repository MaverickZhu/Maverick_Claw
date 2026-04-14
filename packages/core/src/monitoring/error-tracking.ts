import { logger } from '../utils/logger.js';

export interface ErrorCaptureContext {
  area?: string;
  requestId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

interface ErrorTrackingInitOptions {
  serviceName?: string;
  release?: string;
}

let sentrySdk: typeof import('@sentry/node') | null = null;
let enabled = false;
let initialized = false;
let initializing: Promise<void> | null = null;

export async function initErrorTracking(options: ErrorTrackingInitOptions = {}): Promise<void> {
  if (initialized) {
    return;
  }
  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
    const dsn = process.env.SENTRY_DSN?.trim();
    if (!dsn) {
      initialized = true;
      logger.info('External error tracking disabled (SENTRY_DSN not configured)');
      return;
    }

    try {
      const Sentry = await import('@sentry/node');
      const tracesSampleRate = parseRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0);

      Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        release: options.release || process.env.SENTRY_RELEASE || 'maverick-claw@0.1.0',
        tracesSampleRate,
        sendDefaultPii: false,
        initialScope: {
          tags: {
            service: options.serviceName || 'maverick-claw-core',
          },
        },
        beforeSend(event) {
          sanitizeRequestHeaders(event);
          return event;
        },
      });

      sentrySdk = Sentry;
      enabled = true;
      initialized = true;
      logger.info({ tracesSampleRate }, 'External error tracking enabled');
    } catch (error) {
      initialized = true;
      enabled = false;
      logger.warn({ err: error }, 'Failed to initialize external error tracking');
    }
  })();

  await initializing;
}

export function reportError(error: unknown, context: ErrorCaptureContext = {}): void {
  if (!enabled || !sentrySdk) {
    return;
  }

  const exception = normalizeError(error);
  sentrySdk.withScope((scope) => {
    if (context.area) {
      scope.setTag('area', context.area);
    }
    if (context.requestId) {
      scope.setTag('request_id', context.requestId);
    }
    if (context.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    if (context.extra) {
      scope.setExtras(context.extra);
    }

    sentrySdk?.captureException(exception);
  });
}

export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (!enabled || !sentrySdk) {
    return;
  }
  await sentrySdk.flush(timeoutMs);
}

export function isErrorTrackingEnabled(): boolean {
  return enabled;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('Unknown error');
}

function parseRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function sanitizeRequestHeaders(event: import('@sentry/node').Event): void {
  const headers = event.request?.headers;
  if (!headers) {
    return;
  }

  for (const key of Object.keys(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization' || lowerKey === 'cookie' || lowerKey === 'set-cookie') {
      headers[key] = '[REDACTED]';
    }
  }
}
