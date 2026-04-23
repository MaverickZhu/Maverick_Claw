import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import type { QueueMetrics } from '../queue/types.js';

const registry = new Registry();

collectDefaultMetrics({
  register: registry,
  prefix: 'maverick_claw_',
});

const httpRequestsTotal = new Counter({
  name: 'maverick_claw_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

const httpRequestDuration = new Histogram({
  name: 'maverick_claw_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

const httpInFlightRequests = new Gauge({
  name: 'maverick_claw_http_in_flight_requests',
  help: 'Current number of in-flight HTTP requests',
  registers: [registry],
});

const wsConnectedClients = new Gauge({
  name: 'maverick_claw_ws_connected_clients',
  help: 'Current number of active WebSocket clients',
  registers: [registry],
});

const wsMessagesTotal = new Counter({
  name: 'maverick_claw_ws_messages_total',
  help: 'Total number of WebSocket messages',
  labelNames: ['direction', 'message_type', 'outcome'] as const,
  registers: [registry],
});

const wsErrorsTotal = new Counter({
  name: 'maverick_claw_ws_errors_total',
  help: 'Total number of WebSocket errors',
  labelNames: ['code'] as const,
  registers: [registry],
});

const queueJobsGauge = new Gauge({
  name: 'maverick_claw_queue_jobs',
  help: 'Queue jobs by state',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
});

const sessionsTotal = new Gauge({
  name: 'maverick_claw_sessions_total',
  help: 'Total number of sessions in storage',
  registers: [registry],
});

const messagesTotal = new Gauge({
  name: 'maverick_claw_messages_total',
  help: 'Total number of messages in storage',
  registers: [registry],
});

const appUptimeSeconds = new Gauge({
  name: 'maverick_claw_app_uptime_seconds',
  help: 'Application uptime in seconds',
  registers: [registry],
});

const chatTokensTotal = new Counter({
  name: 'maverick_claw_chat_tokens_total',
  help: 'Total number of tokens used in chat completions',
  labelNames: ['provider', 'model', 'token_type'] as const,
  registers: [registry],
});

const chatLatencySeconds = new Histogram({
  name: 'maverick_claw_chat_latency_seconds',
  help: 'Chat completion latency in seconds',
  labelNames: ['provider', 'model'] as const,
  buckets: [0.1, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 60],
  registers: [registry],
});

const chatRequestsTotal = new Counter({
  name: 'maverick_claw_chat_requests_total',
  help: 'Total number of chat completion requests',
  labelNames: ['provider', 'model'] as const,
  registers: [registry],
});

export const metricsContentType = registry.contentType;

export function markHttpRequestStarted(): bigint {
  httpInFlightRequests.inc();
  return process.hrtime.bigint();
}

export function observeHttpRequestFinished(params: {
  startedAt: bigint;
  method: string;
  route: string;
  statusCode: number;
}): number {
  const elapsedNs = process.hrtime.bigint() - params.startedAt;
  const durationSeconds = Number(elapsedNs) / 1_000_000_000;
  const durationMs = durationSeconds * 1000;
  const labels = {
    method: params.method.toUpperCase(),
    route: normalizeRoute(params.route),
    status_code: String(params.statusCode),
  };

  httpRequestDuration.observe(labels, durationSeconds);
  httpRequestsTotal.inc(labels);
  httpInFlightRequests.dec();
  return durationMs;
}

export function recordWsConnectedClients(count: number): void {
  wsConnectedClients.set(Math.max(0, count));
}

export function recordWsMessage(params: {
  direction: 'in' | 'out';
  messageType: string;
  outcome: 'ok' | 'error' | 'dropped';
}): void {
  wsMessagesTotal.inc({
    direction: params.direction,
    message_type: normalizeLabel(params.messageType),
    outcome: params.outcome,
  });
}

export function recordWsError(code: string): void {
  wsErrorsTotal.inc({ code: normalizeLabel(code) });
}

export function updateQueueMetrics(metrics: QueueMetrics[]): void {
  queueJobsGauge.reset();
  for (const metric of metrics) {
    const queueName = normalizeLabel(metric.name);
    queueJobsGauge.set({ queue: queueName, state: 'waiting' }, metric.waiting);
    queueJobsGauge.set({ queue: queueName, state: 'active' }, metric.active);
    queueJobsGauge.set({ queue: queueName, state: 'completed' }, metric.completed);
    queueJobsGauge.set({ queue: queueName, state: 'failed' }, metric.failed);
    queueJobsGauge.set({ queue: queueName, state: 'delayed' }, metric.delayed);
    queueJobsGauge.set({ queue: queueName, state: 'paused' }, metric.paused ? 1 : 0);
  }
}

export function updateStorageMetrics(params: {
  sessionCount: number;
  messageCount: number;
}): void {
  sessionsTotal.set(Math.max(0, params.sessionCount));
  messagesTotal.set(Math.max(0, params.messageCount));
}

export function updateAppUptime(valueSeconds: number = process.uptime()): void {
  appUptimeSeconds.set(Math.max(0, valueSeconds));
}

export function recordChatTokens(params: {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): void {
  const labels = {
    provider: normalizeLabel(params.provider),
    model: normalizeLabel(params.model),
  };
  chatTokensTotal.inc({ ...labels, token_type: 'prompt' }, params.promptTokens);
  chatTokensTotal.inc({ ...labels, token_type: 'completion' }, params.completionTokens);
}

export function recordChatLatency(params: {
  provider: string;
  model: string;
  latencyMs: number;
}): void {
  chatLatencySeconds.observe(
    {
      provider: normalizeLabel(params.provider),
      model: normalizeLabel(params.model),
    },
    params.latencyMs / 1000
  );
}

export function recordChatRequest(params: {
  provider: string;
  model: string;
}): void {
  chatRequestsTotal.inc({
    provider: normalizeLabel(params.provider),
    model: normalizeLabel(params.model),
  });
}

export async function getMetricsSnapshot(): Promise<string> {
  return registry.metrics();
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 80) || 'unknown';
}

function normalizeRoute(route: string): string {
  if (!route) {
    return 'unknown';
  }
  return route.replace(/[0-9a-f]{8,}/gi, ':id').slice(0, 120);
}
