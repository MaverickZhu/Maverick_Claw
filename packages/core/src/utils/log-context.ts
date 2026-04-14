import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  requestId?: string;
  traceId?: string;
  method?: string;
  route?: string;
  clientId?: string;
  sessionId?: string;
  userId?: string;
}

const logContextStorage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

export function setLogContext(context: LogContext): void {
  const previous = getLogContext() || {};
  logContextStorage.enterWith({
    ...previous,
    ...context,
  });
}

export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const previous = getLogContext() || {};
  return logContextStorage.run(
    {
      ...previous,
      ...context,
    },
    fn
  );
}
