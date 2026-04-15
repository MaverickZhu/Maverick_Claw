# Benchmark Baselines

该目录用于存放性能回归的基线报告（JSON）。

## 当前基线

- `core-baseline.json`：`@maverick-claw/core` 默认场景基线
  - `http.health`
  - `ws.connect`
  - `ws.sessions.list`

## 本地回归对比（推荐）

1. 启动 Gateway。
2. 运行基准：

```powershell
pnpm --filter @maverick-claw/core benchmark -- --output-dir ../../benchmark-results --http-total 200 --http-concurrency 20 --ws-connect-total 80 --ws-connect-concurrency 8 --ws-request-total 60 --ws-request-concurrency 6
```

3. 对比基线：

```powershell
pnpm --filter @maverick-claw/core benchmark:compare -- --output-dir ../../benchmark-results --baseline ../../benchmark-baselines/core-baseline.json
```

## 基线更新流程

当确认性能改善是预期且稳定时，更新基线：

1. 选定新的 `benchmark-*.json` 作为候选。
2. 用候选覆盖 `core-baseline.json`。
3. 在 PR 描述中说明基线更新原因与关键指标变化。
