import { describe, it, expect, beforeEach } from 'vitest';
import { StatsService } from './service.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('StatsService', () => {
  let dbManager: DatabaseManager;
  let statsService: StatsService;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stats-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    statsService = new StatsService(dbManager);
  });

  it('should record usage', () => {
    statsService.recordUsage({
      sessionId: 'session-1',
      modelId: 'gpt-4',
      provider: 'openai',
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 1200,
    });

    const overview = statsService.getOverview();
    expect(overview.totalRequests).toBe(1);
    expect(overview.totalPromptTokens).toBe(100);
    expect(overview.totalCompletionTokens).toBe(50);
    expect(overview.totalTokens).toBe(150);
  });

  it('should get daily stats', () => {
    statsService.recordUsage({
      modelId: 'gpt-4',
      provider: 'openai',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 100,
    });

    const daily = statsService.getDailyStats(7);
    expect(daily.length).toBeGreaterThanOrEqual(1);
    expect(daily[0].totalRequests).toBe(1);
    expect(daily[0].totalTokens).toBe(15);
  });

  it('should get model stats', () => {
    statsService.recordUsage({
      modelId: 'gpt-4',
      provider: 'openai',
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 100,
    });
    statsService.recordUsage({
      modelId: 'deepseek-chat',
      provider: 'deepseek',
      promptTokens: 200,
      completionTokens: 100,
      latencyMs: 200,
    });

    const modelStats = statsService.getModelStats();
    expect(modelStats.length).toBe(2);
    const deepseek = modelStats.find(m => m.modelId === 'deepseek-chat');
    expect(deepseek?.totalTokens).toBe(300);
  });

  it('should handle empty stats gracefully', () => {
    const overview = statsService.getOverview();
    expect(overview.totalRequests).toBe(0);
    expect(overview.totalTokens).toBe(0);
    expect(overview.todayMessages).toBe(0);
  });
});
