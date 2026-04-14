import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import WebSocket, { type RawData } from 'ws';

type ArgValue = string | boolean;
type ArgMap = Map<string, ArgValue>;

interface BenchmarkOptions {
  baseUrl: string;
  wsUrl: string;
  token?: string;
  timeoutMs: number;
  outputDir: string;
  httpTotal: number;
  httpConcurrency: number;
  wsConnectTotal: number;
  wsConnectConcurrency: number;
  wsRequestTotal: number;
  wsRequestConcurrency: number;
}

interface LatencySummary {
  min: number | null;
  max: number | null;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

interface ScenarioResult {
  name: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
  durationMs: number;
  throughputRps: number;
  latencyMs: LatencySummary;
  sampleErrors: string[];
}

interface BenchmarkReport {
  generatedAt: string;
  target: {
    baseUrl: string;
    wsUrl: string;
  };
  config: Omit<BenchmarkOptions, 'baseUrl' | 'wsUrl'>;
  scenarios: ScenarioResult[];
}

interface RunConcurrentResult {
  latencies: number[];
  failures: number;
  errors: string[];
  durationMs: number;
}

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:31987',
  timeoutMs: 10_000,
  outputDir: 'benchmark-results',
  httpTotal: 400,
  httpConcurrency: 20,
  wsConnectTotal: 120,
  wsConnectConcurrency: 10,
  wsRequestTotal: 80,
  wsRequestConcurrency: 8,
} as const;

function parseArgs(argv: string[]): ArgMap {
  const args = new Map<string, ArgValue>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }

    const normalized = current.replace(/^--/, '');
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(normalized, true);
      continue;
    }

    args.set(normalized, next);
    index += 1;
  }

  return args;
}

function getArgString(args: ArgMap, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = args.get(key);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return fallback;
}

function getArgNumber(args: ArgMap, keys: string[], fallback: number): number {
  const raw = getArgString(args, keys, String(fallback));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getArgBoolean(args: ArgMap, keys: string[]): boolean {
  return keys.some((key) => args.get(key) === true);
}

function toWsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  return url.toString();
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function percentile(samples: number[], ratio: number): number | null {
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return round(sorted[position]);
}

function summarizeLatency(samples: number[]): LatencySummary {
  if (samples.length === 0) {
    return {
      min: null,
      max: null,
      avg: null,
      p50: null,
      p95: null,
      p99: null,
    };
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = samples.reduce((acc, current) => acc + current, 0) / samples.length;

  return {
    min: round(min),
    max: round(max),
    avg: round(avg),
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

async function runConcurrent(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<number>
): Promise<RunConcurrentResult> {
  if (total <= 0) {
    return {
      latencies: [],
      failures: 0,
      errors: [],
      durationMs: 0,
    };
  }

  let cursor = 0;
  let failures = 0;
  const latencies: number[] = [];
  const errors = new Set<string>();
  const workerCount = Math.max(1, Math.min(concurrency, total));
  const startedAt = performance.now();

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;

      if (current >= total) {
        return;
      }

      try {
        const latency = await task(current);
        latencies.push(latency);
      } catch (error) {
        failures += 1;
        if (errors.size < 5) {
          errors.add(normalizeError(error));
        }
      }
    }
  });

  await Promise.all(workers);

  return {
    latencies,
    failures,
    errors: [...errors],
    durationMs: performance.now() - startedAt,
  };
}

function buildScenarioResult(name: string, total: number, result: RunConcurrentResult): ScenarioResult {
  const success = result.latencies.length;
  const failed = Math.max(0, total - success);
  const successRate = total > 0 ? (success / total) * 100 : 100;
  const durationSec = result.durationMs > 0 ? result.durationMs / 1000 : 0;
  const throughputRps = durationSec > 0 ? success / durationSec : 0;

  return {
    name,
    total,
    success,
    failed,
    successRate: round(successRate),
    durationMs: round(result.durationMs),
    throughputRps: round(throughputRps),
    latencyMs: summarizeLatency(result.latencies),
    sampleErrors: result.errors,
  };
}

function parseRawData(raw: RawData): unknown {
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString()
        : Buffer.isBuffer(raw)
          ? raw.toString()
          : Buffer.from(new Uint8Array(raw)).toString();

  return JSON.parse(text);
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 300);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.close();
  });
}

async function connectWebSocket(
  wsUrl: string,
  timeoutMs: number,
  token: string | undefined,
  deviceId: string
): Promise<{ socket: WebSocket; connectLatencyMs: number }> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = new WebSocket(wsUrl);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error('WebSocket connect timeout'));
    }, timeoutMs);

    const finish = (handler: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler();
    };

    socket.once('error', (error) => {
      finish(() => reject(error));
    });

    socket.once('open', () => {
      const payload = {
        type: 'connect',
        id: `bench-connect-${randomUUID()}`,
        params: {
          clientType: 'node',
          clientVersion: 'benchmark',
          deviceId,
          ...(token ? { token } : {}),
        },
      };
      socket.send(JSON.stringify(payload));
    });

    socket.on('message', (raw) => {
      let parsed: unknown;

      try {
        parsed = parseRawData(raw);
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const record = parsed as Record<string, unknown>;
      if (record.type !== 'connect') {
        return;
      }

      const error = typeof record.error === 'string' ? record.error : undefined;
      if (error) {
        finish(() => {
          socket.close();
          reject(new Error(error));
        });
        return;
      }

      finish(() => {
        resolve({
          socket,
          connectLatencyMs: performance.now() - startedAt,
        });
      });
    });
  });
}

async function waitForWsResponse(
  socket: WebSocket,
  requestId: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('WebSocket request timeout'));
    }, timeoutMs);

    const onMessage = (raw: RawData): void => {
      let parsed: unknown;
      try {
        parsed = parseRawData(raw);
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const record = parsed as Record<string, unknown>;
      const type = record.type;

      if (type === 'res' && record.id === requestId) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(record);
        return;
      }

      const requestIdInError =
        typeof record.requestId === 'string'
          ? record.requestId
          : typeof record.id === 'string'
            ? record.id
            : undefined;

      if (type === 'error' && requestIdInError === requestId) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(record);
      }
    };

    socket.on('message', onMessage);
  });
}

async function runHttpHealthScenario(options: BenchmarkOptions): Promise<ScenarioResult> {
  const target = new URL('/api/health', options.baseUrl).toString();
  const headers: HeadersInit = options.token
    ? { Authorization: `Bearer ${options.token}` }
    : {};

  const runResult = await runConcurrent(options.httpTotal, options.httpConcurrency, async () => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(target, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await response.arrayBuffer();
      return performance.now() - startedAt;
    } finally {
      clearTimeout(timer);
    }
  });

  return buildScenarioResult('http.health', options.httpTotal, runResult);
}

async function runWsConnectScenario(options: BenchmarkOptions): Promise<ScenarioResult> {
  const runResult = await runConcurrent(
    options.wsConnectTotal,
    options.wsConnectConcurrency,
    async (index) => {
      const { socket, connectLatencyMs } = await connectWebSocket(
        options.wsUrl,
        options.timeoutMs,
        options.token,
        `benchmark-connect-${index}`
      );
      await closeSocket(socket);
      return connectLatencyMs;
    }
  );

  return buildScenarioResult('ws.connect', options.wsConnectTotal, runResult);
}

async function runWsRequestScenario(options: BenchmarkOptions): Promise<ScenarioResult> {
  const runResult = await runConcurrent(
    options.wsRequestTotal,
    options.wsRequestConcurrency,
    async (index) => {
      const { socket } = await connectWebSocket(
        options.wsUrl,
        options.timeoutMs,
        options.token,
        `benchmark-request-${index}`
      );

      try {
        const requestId = `bench-req-${randomUUID()}`;
        const requestPayload = {
          type: 'req',
          id: requestId,
          method: 'sessions.list',
          params: {},
        };

        const startedAt = performance.now();
        socket.send(JSON.stringify(requestPayload));
        const response = await waitForWsResponse(socket, requestId, options.timeoutMs);

        const errorMessage = typeof response.error === 'string' ? response.error : undefined;
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return performance.now() - startedAt;
      } finally {
        await closeSocket(socket);
      }
    }
  );

  return buildScenarioResult('ws.sessions.list', options.wsRequestTotal, runResult);
}

function renderMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Maverick Claw 性能基准报告');
  lines.push('');
  lines.push(`- 生成时间: ${report.generatedAt}`);
  lines.push(`- HTTP 目标: ${report.target.baseUrl}`);
  lines.push(`- WebSocket 目标: ${report.target.wsUrl}`);
  lines.push('');
  lines.push('## 场景结果');
  lines.push('');
  lines.push('| 场景 | 总请求 | 成功 | 失败 | 成功率 | 吞吐 (req/s) | P95 延迟 (ms) | 平均延迟 (ms) |');
  lines.push('|------|--------|------|------|--------|--------------|---------------|---------------|');

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.name} | ${scenario.total} | ${scenario.success} | ${scenario.failed} | ${scenario.successRate}% | ${scenario.throughputRps} | ${scenario.latencyMs.p95 ?? '-'} | ${scenario.latencyMs.avg ?? '-'} |`
    );
  }

  lines.push('');
  lines.push('## 采样错误');
  lines.push('');

  const errors = report.scenarios.flatMap((scenario) =>
    scenario.sampleErrors.map((error) => `${scenario.name}: ${error}`)
  );

  if (errors.length === 0) {
    lines.push('- 无');
  } else {
    for (const error of errors) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join('\n');
}

function printUsage(): void {
  console.log(`用法:
  pnpm benchmark -- [options]

可选参数:
  --base-url <url>               HTTP 地址（默认: ${DEFAULTS.baseUrl}）
  --ws-url <url>                 WS 地址（默认: 从 base-url 推导）
  --token <token>                认证 token（可选）
  --output-dir <dir>             报告输出目录（默认: ${DEFAULTS.outputDir}）
  --timeout-ms <number>          单请求超时毫秒（默认: ${DEFAULTS.timeoutMs}）
  --http-total <number>          HTTP 场景总请求数（默认: ${DEFAULTS.httpTotal}）
  --http-concurrency <number>    HTTP 并发（默认: ${DEFAULTS.httpConcurrency}）
  --ws-connect-total <number>    WS connect 总请求数（默认: ${DEFAULTS.wsConnectTotal}）
  --ws-connect-concurrency <n>   WS connect 并发（默认: ${DEFAULTS.wsConnectConcurrency}）
  --ws-request-total <number>    WS sessions.list 总请求数（默认: ${DEFAULTS.wsRequestTotal}）
  --ws-request-concurrency <n>   WS sessions.list 并发（默认: ${DEFAULTS.wsRequestConcurrency}）
  --skip-ws                      仅执行 HTTP 基准
  --help                         显示帮助
`);
}

function resolveOptions(args: ArgMap): BenchmarkOptions {
  const baseUrl = getArgString(args, ['base-url', 'baseUrl'], DEFAULTS.baseUrl);
  const wsUrl = getArgString(args, ['ws-url', 'wsUrl'], toWsUrl(baseUrl));
  const skipWs = getArgBoolean(args, ['skip-ws', 'skipWs']);

  return {
    baseUrl,
    wsUrl,
    token: getArgString(args, ['token'], ''),
    outputDir: getArgString(args, ['output-dir', 'outputDir'], DEFAULTS.outputDir),
    timeoutMs: getArgNumber(args, ['timeout-ms', 'timeoutMs'], DEFAULTS.timeoutMs),
    httpTotal: getArgNumber(args, ['http-total', 'httpTotal'], DEFAULTS.httpTotal),
    httpConcurrency: getArgNumber(args, ['http-concurrency', 'httpConcurrency'], DEFAULTS.httpConcurrency),
    wsConnectTotal: skipWs
      ? 0
      : getArgNumber(args, ['ws-connect-total', 'wsConnectTotal'], DEFAULTS.wsConnectTotal),
    wsConnectConcurrency: getArgNumber(
      args,
      ['ws-connect-concurrency', 'wsConnectConcurrency'],
      DEFAULTS.wsConnectConcurrency
    ),
    wsRequestTotal: skipWs
      ? 0
      : getArgNumber(args, ['ws-request-total', 'wsRequestTotal'], DEFAULTS.wsRequestTotal),
    wsRequestConcurrency: getArgNumber(
      args,
      ['ws-request-concurrency', 'wsRequestConcurrency'],
      DEFAULTS.wsRequestConcurrency
    ),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (getArgBoolean(args, ['help', 'h'])) {
    printUsage();
    return;
  }

  const options = resolveOptions(args);
  const token = options.token && options.token.length > 0 ? options.token : undefined;
  options.token = token;

  console.log('开始性能基准测试...');
  console.log(`HTTP: ${options.baseUrl}`);
  console.log(`WS: ${options.wsUrl}`);

  const scenarios: ScenarioResult[] = [];
  scenarios.push(await runHttpHealthScenario(options));

  if (options.wsConnectTotal > 0) {
    scenarios.push(await runWsConnectScenario(options));
  }

  if (options.wsRequestTotal > 0) {
    scenarios.push(await runWsRequestScenario(options));
  }

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: options.baseUrl,
      wsUrl: options.wsUrl,
    },
    config: {
      token: options.token,
      timeoutMs: options.timeoutMs,
      outputDir: options.outputDir,
      httpTotal: options.httpTotal,
      httpConcurrency: options.httpConcurrency,
      wsConnectTotal: options.wsConnectTotal,
      wsConnectConcurrency: options.wsConnectConcurrency,
      wsRequestTotal: options.wsRequestTotal,
      wsRequestConcurrency: options.wsRequestConcurrency,
    },
    scenarios,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.resolve(options.outputDir);
  const jsonPath = path.join(outputDir, `benchmark-${timestamp}.json`);
  const markdownPath = path.join(outputDir, `benchmark-${timestamp}.md`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');

  console.log('\n场景结果:');
  for (const scenario of scenarios) {
    console.log(
      `- ${scenario.name}: success=${scenario.success}/${scenario.total}, p95=${scenario.latencyMs.p95 ?? '-'}ms, rps=${scenario.throughputRps}`
    );
  }

  console.log(`\nJSON 报告: ${jsonPath}`);
  console.log(`Markdown 报告: ${markdownPath}`);

  const hasFailure = scenarios.some((scenario) => scenario.failed > 0);
  if (hasFailure) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error('性能基准执行失败:', normalizeError(error));
  process.exitCode = 1;
});
