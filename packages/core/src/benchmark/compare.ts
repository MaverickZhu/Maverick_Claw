import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

type ArgValue = string | boolean;
type ArgMap = Map<string, ArgValue>;

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
  config: Record<string, unknown>;
  scenarios: ScenarioResult[];
}

interface RegressionThresholds {
  minSuccessRate: number;
  maxFailures: number;
  maxP95RegressionPct: number;
  maxAvgRegressionPct: number;
  maxThroughputDropPct: number;
}

interface ScenarioGateResult {
  name: string;
  passed: boolean;
  reasons: string[];
  baseline: ScenarioResult;
  candidate: ScenarioResult;
  deltas: {
    successRatePctPoint: number;
    throughputPct: number | null;
    p95Pct: number | null;
    avgPct: number | null;
  };
}

interface RegressionReport {
  generatedAt: string;
  baselinePath: string;
  candidatePath: string;
  thresholds: RegressionThresholds;
  summary: {
    passed: boolean;
    totalScenarios: number;
    passedScenarios: number;
    failedScenarios: number;
  };
  scenarios: ScenarioGateResult[];
}

const DEFAULTS = {
  outputDir: 'benchmark-results',
  minSuccessRate: 99.5,
  maxFailures: 0,
  maxP95RegressionPct: 20,
  maxAvgRegressionPct: 20,
  maxThroughputDropPct: 15,
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

function getArgString(args: ArgMap, keys: string[], fallback = ''): string {
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
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function getArgBoolean(args: ArgMap, keys: string[]): boolean {
  return keys.some((key) => args.get(key) === true);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function percentDelta(candidate: number | null, baseline: number | null): number | null {
  if (candidate === null || baseline === null || baseline === 0) {
    return null;
  }
  return round(((candidate - baseline) / baseline) * 100);
}

function validateReport(raw: unknown, filePath: string): BenchmarkReport {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid report structure: ${filePath}`);
  }

  const report = raw as Partial<BenchmarkReport>;
  if (!Array.isArray(report.scenarios)) {
    throw new Error(`Missing scenarios in report: ${filePath}`);
  }

  return report as BenchmarkReport;
}

async function readBenchmarkReport(filePath: string): Promise<BenchmarkReport> {
  const content = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  return validateReport(parsed, filePath);
}

async function findLatestBenchmarkJson(outputDir: string): Promise<string | null> {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^benchmark-.*\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? 1 : -1));

  if (candidates.length === 0) {
    return null;
  }

  return path.join(outputDir, candidates[0]);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveInputPath(rawPath: string, outputDir: string): Promise<string> {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const byCwd = path.resolve(rawPath);
  if (await pathExists(byCwd)) {
    return byCwd;
  }

  const byOutputDir = path.resolve(outputDir, rawPath);
  if (await pathExists(byOutputDir)) {
    return byOutputDir;
  }

  return byCwd;
}

function evaluateScenario(
  baseline: ScenarioResult,
  candidate: ScenarioResult,
  thresholds: RegressionThresholds
): ScenarioGateResult {
  const reasons: string[] = [];
  const successRateDelta = round(candidate.successRate - baseline.successRate);
  const throughputDelta = percentDelta(candidate.throughputRps, baseline.throughputRps);
  const p95Delta = percentDelta(candidate.latencyMs.p95, baseline.latencyMs.p95);
  const avgDelta = percentDelta(candidate.latencyMs.avg, baseline.latencyMs.avg);

  if (candidate.successRate < thresholds.minSuccessRate) {
    reasons.push(
      `successRate ${candidate.successRate}% < minSuccessRate ${thresholds.minSuccessRate}%`
    );
  }

  if (candidate.failed > thresholds.maxFailures) {
    reasons.push(`failed ${candidate.failed} > maxFailures ${thresholds.maxFailures}`);
  }

  if (p95Delta !== null && p95Delta > thresholds.maxP95RegressionPct) {
    reasons.push(`p95 regression ${p95Delta}% > ${thresholds.maxP95RegressionPct}%`);
  }

  if (avgDelta !== null && avgDelta > thresholds.maxAvgRegressionPct) {
    reasons.push(`avg regression ${avgDelta}% > ${thresholds.maxAvgRegressionPct}%`);
  }

  if (throughputDelta !== null && throughputDelta < -thresholds.maxThroughputDropPct) {
    reasons.push(
      `throughput drop ${Math.abs(throughputDelta)}% > ${thresholds.maxThroughputDropPct}%`
    );
  }

  return {
    name: candidate.name,
    passed: reasons.length === 0,
    reasons,
    baseline,
    candidate,
    deltas: {
      successRatePctPoint: successRateDelta,
      throughputPct: throughputDelta,
      p95Pct: p95Delta,
      avgPct: avgDelta,
    },
  };
}

function renderMarkdown(report: RegressionReport): string {
  const lines: string[] = [];
  lines.push('# Maverick Claw 回归对比报告');
  lines.push('');
  lines.push(`- 生成时间: ${report.generatedAt}`);
  lines.push(`- Baseline: ${report.baselinePath}`);
  lines.push(`- Candidate: ${report.candidatePath}`);
  lines.push(`- 总体结果: ${report.summary.passed ? '✅ 通过' : '❌ 失败'}`);
  lines.push('');
  lines.push('## 误差预算阈值');
  lines.push('');
  lines.push(`- 最小成功率: ${report.thresholds.minSuccessRate}%`);
  lines.push(`- 最大失败数: ${report.thresholds.maxFailures}`);
  lines.push(`- P95 最大回归: ${report.thresholds.maxP95RegressionPct}%`);
  lines.push(`- 平均延迟最大回归: ${report.thresholds.maxAvgRegressionPct}%`);
  lines.push(`- 吞吐最大下降: ${report.thresholds.maxThroughputDropPct}%`);
  lines.push('');
  lines.push('## 场景对比');
  lines.push('');
  lines.push(
    '| 场景 | 结果 | 成功率变化(pp) | 吞吐变化(%) | P95变化(%) | AVG变化(%) | 失败数(candidate) |'
  );
  lines.push('|------|------|----------------|------------|------------|------------|------------------|');

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.name} | ${scenario.passed ? '✅' : '❌'} | ${scenario.deltas.successRatePctPoint} | ${scenario.deltas.throughputPct ?? '-'} | ${scenario.deltas.p95Pct ?? '-'} | ${scenario.deltas.avgPct ?? '-'} | ${scenario.candidate.failed} |`
    );
  }

  lines.push('');
  lines.push('## 失败原因');
  lines.push('');

  const failedScenarios = report.scenarios.filter((scenario) => !scenario.passed);
  if (failedScenarios.length === 0) {
    lines.push('- 无');
  } else {
    for (const scenario of failedScenarios) {
      lines.push(`- ${scenario.name}`);
      for (const reason of scenario.reasons) {
        lines.push(`  - ${reason}`);
      }
    }
  }

  return lines.join('\n');
}

function printUsage(): void {
  console.log(`用法:
  pnpm benchmark:compare -- --baseline <path> [options]

可选参数:
  --baseline <path>                    baseline 报告 JSON（必填，可填绝对路径或 output-dir 下文件名）
  --candidate <path>                   candidate 报告 JSON（默认取 output-dir 最新 benchmark-*.json）
  --output-dir <dir>                   报告目录（默认: ${DEFAULTS.outputDir}）
  --min-success-rate <number>          最小成功率（默认: ${DEFAULTS.minSuccessRate}）
  --max-failures <number>              最大失败数（默认: ${DEFAULTS.maxFailures}）
  --max-p95-regression <number>        P95 最大回归百分比（默认: ${DEFAULTS.maxP95RegressionPct}）
  --max-avg-regression <number>        平均延迟最大回归百分比（默认: ${DEFAULTS.maxAvgRegressionPct}）
  --max-throughput-drop <number>       吞吐最大下降百分比（默认: ${DEFAULTS.maxThroughputDropPct}）
  --help                               显示帮助
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (getArgBoolean(args, ['help', 'h'])) {
    printUsage();
    return;
  }

  const outputDir = path.resolve(getArgString(args, ['output-dir', 'outputDir'], DEFAULTS.outputDir));
  const baselinePath = getArgString(args, ['baseline'], '');
  if (!baselinePath) {
    throw new Error('Missing required argument: --baseline');
  }

  const candidateArg = getArgString(args, ['candidate'], '');
  const candidatePath = candidateArg || (await findLatestBenchmarkJson(outputDir));
  if (!candidatePath) {
    throw new Error('No candidate benchmark report found');
  }

  const resolvedBaselinePath = await resolveInputPath(baselinePath, outputDir);
  const resolvedCandidatePath = await resolveInputPath(candidatePath, outputDir);
  if (resolvedBaselinePath === resolvedCandidatePath) {
    throw new Error('Baseline and candidate report must be different files');
  }

  const thresholds: RegressionThresholds = {
    minSuccessRate: getArgNumber(args, ['min-success-rate', 'minSuccessRate'], DEFAULTS.minSuccessRate),
    maxFailures: getArgNumber(args, ['max-failures', 'maxFailures'], DEFAULTS.maxFailures),
    maxP95RegressionPct: getArgNumber(
      args,
      ['max-p95-regression', 'maxP95Regression'],
      DEFAULTS.maxP95RegressionPct
    ),
    maxAvgRegressionPct: getArgNumber(
      args,
      ['max-avg-regression', 'maxAvgRegression'],
      DEFAULTS.maxAvgRegressionPct
    ),
    maxThroughputDropPct: getArgNumber(
      args,
      ['max-throughput-drop', 'maxThroughputDrop'],
      DEFAULTS.maxThroughputDropPct
    ),
  };

  const baseline = await readBenchmarkReport(resolvedBaselinePath);
  const candidate = await readBenchmarkReport(resolvedCandidatePath);

  const baselineMap = new Map(baseline.scenarios.map((scenario) => [scenario.name, scenario]));
  const comparisons: ScenarioGateResult[] = [];
  for (const candidateScenario of candidate.scenarios) {
    const baselineScenario = baselineMap.get(candidateScenario.name);
    if (!baselineScenario) {
      continue;
    }
    comparisons.push(evaluateScenario(baselineScenario, candidateScenario, thresholds));
  }

  if (comparisons.length === 0) {
    throw new Error('No overlapping scenarios between baseline and candidate reports');
  }

  const failedScenarios = comparisons.filter((scenario) => !scenario.passed);
  const report: RegressionReport = {
    generatedAt: new Date().toISOString(),
    baselinePath: resolvedBaselinePath,
    candidatePath: resolvedCandidatePath,
    thresholds,
    summary: {
      passed: failedScenarios.length === 0,
      totalScenarios: comparisons.length,
      passedScenarios: comparisons.length - failedScenarios.length,
      failedScenarios: failedScenarios.length,
    },
    scenarios: comparisons,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outputDir, `regression-${timestamp}.json`);
  const markdownPath = path.join(outputDir, `regression-${timestamp}.md`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');

  console.log('回归对比完成');
  console.log(`Baseline: ${resolvedBaselinePath}`);
  console.log(`Candidate: ${resolvedCandidatePath}`);
  console.log(`结果: ${report.summary.passed ? 'PASS' : 'FAIL'}`);
  console.log(`JSON 报告: ${jsonPath}`);
  console.log(`Markdown 报告: ${markdownPath}`);

  if (!report.summary.passed) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`回归对比失败: ${message}`);
  process.exitCode = 1;
});
