import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import type { ConfigManager } from '../config/manager.js';

export interface UsageRecord {
  id: string;
  sessionId?: string;
  modelId: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  createdAt: number;
}

export interface DailyStats {
  date: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export interface ModelStats {
  modelId: string;
  provider: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export interface StatsOverview {
  totalSessions: number;
  totalMessages: number;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  todayMessages: number;
  todayRequests: number;
  todayTokens: number;
  activeSessions: number;
  configuredModels: number;
}

export class StatsService {
  constructor(
    private dbManager: DatabaseManager,
    private configManager?: ConfigManager,
  ) {}

  /**
   * Record a usage entry after chat completion
   */
  recordUsage(params: {
    sessionId?: string;
    modelId: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
  }): void {
    try {
      const db = this.dbManager.getDb();
      const stmt = db.prepare(
        `INSERT INTO usage_records (id, session_id, model_id, provider, prompt_tokens, completion_tokens, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        crypto.randomUUID(),
        params.sessionId || null,
        params.modelId,
        params.provider,
        params.promptTokens,
        params.completionTokens,
        params.latencyMs,
        Math.floor(Date.now() / 1000)
      );
    } catch (error) {
      logger.warn({ err: error }, 'Failed to record usage');
    }
  }

  /**
   * Get overall statistics
   */
  getOverview(): StatsOverview {
    const db = this.dbManager.getDb();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;

    const totalSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    const totalMessages = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
    const totalRequests = (db.prepare('SELECT COUNT(*) as count FROM usage_records').get() as { count: number }).count;
    const totalPromptTokens = (db.prepare('SELECT COALESCE(SUM(prompt_tokens), 0) as sum FROM usage_records').get() as { sum: number }).sum;
    const totalCompletionTokens = (db.prepare('SELECT COALESCE(SUM(completion_tokens), 0) as sum FROM usage_records').get() as { sum: number }).sum;
    const totalTokens = totalPromptTokens + totalCompletionTokens;

    const todayMessages = (db.prepare('SELECT COUNT(*) as count FROM messages WHERE created_at >= ?').get(todayStart) as { count: number }).count;
    const todayRequests = (db.prepare('SELECT COUNT(*) as count FROM usage_records WHERE created_at >= ?').get(todayStart) as { count: number }).count;
    const todayTokens = (db.prepare('SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) as sum FROM usage_records WHERE created_at >= ?').get(todayStart) as { sum: number }).sum;

    // Active sessions = sessions with messages in the last 24h
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const activeSessions = (db.prepare(
      'SELECT COUNT(DISTINCT session_id) as count FROM messages WHERE created_at >= ?'
    ).get(dayAgo) as { count: number }).count;

    // Configured models from config.json5
    let configuredModels = 0;
    try {
      if (this.configManager) {
        const config = this.configManager.get();
        if (config.models && Array.isArray(config.models)) {
          configuredModels = config.models.filter((m: { enabled?: boolean }) => m.enabled !== false).length;
        }
      }
    } catch {
      // Fallback: count from usage_records distinct models
      configuredModels = (db.prepare('SELECT COUNT(DISTINCT model_id) as count FROM usage_records').get() as { count: number }).count;
    }

    return {
      totalSessions,
      totalMessages,
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      todayMessages,
      todayRequests,
      todayTokens,
      activeSessions,
      configuredModels,
    };
  }

  /**
   * Get daily aggregated stats for the last N days
   */
  getDailyStats(days: number = 30): DailyStats[] {
    const db = this.dbManager.getDb();
    const stmt = db.prepare(
      `SELECT
        DATE(created_at, 'unixepoch', 'localtime') as date,
        COUNT(*) as totalRequests,
        COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
        COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) as totalTokens
      FROM usage_records
      WHERE created_at >= unixepoch('now', '-${days} days')
      GROUP BY date
      ORDER BY date DESC`
    );
    return stmt.all() as DailyStats[];
  }

  /**
   * Get per-model aggregated stats
   */
  getModelStats(): ModelStats[] {
    const db = this.dbManager.getDb();
    const stmt = db.prepare(
      `SELECT
        model_id as modelId,
        provider,
        COUNT(*) as totalRequests,
        COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
        COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) as totalTokens
      FROM usage_records
      GROUP BY model_id, provider
      ORDER BY totalTokens DESC`
    );
    return stmt.all() as ModelStats[];
  }
}

let globalStatsService: StatsService | null = null;

export function getStatsService(dbManager: DatabaseManager, configManager?: ConfigManager): StatsService {
  if (!globalStatsService || configManager) {
    globalStatsService = new StatsService(dbManager, configManager);
  }
  return globalStatsService;
}
