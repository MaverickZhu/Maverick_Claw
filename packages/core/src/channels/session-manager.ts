import type { SessionManager } from '../storage/session.js';
import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';

export interface ChannelSessionMapping {
  channelId: string;
  channelUserId: string;
  sessionId: string;
  createdAt: Date;
  lastActivityAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ChannelSessionOptions {
  sessionManager: SessionManager;
  dbManager?: DatabaseManager;
  defaultModelId?: string;
  sessionTimeoutMs?: number;
}

/**
 * Manages mapping between external channel users and internal sessions
 * Persisted to SQLite channel_sessions table when dbManager is available
 */
export class ChannelSessionManager {
  private sessionManager: SessionManager;
  private dbManager?: DatabaseManager;
  private defaultModelId: string;
  private sessionTimeoutMs: number;
  // Fallback in-memory map when dbManager is not available (e.g. tests)
  private memoryMappings = new Map<string, ChannelSessionMapping>();

  constructor(options: ChannelSessionOptions) {
    this.sessionManager = options.sessionManager;
    this.dbManager = options.dbManager;
    this.defaultModelId = options.defaultModelId || 'deepseek:deepseek-chat';
    this.sessionTimeoutMs = options.sessionTimeoutMs || 24 * 60 * 60 * 1000; // 24 hours
  }

  private rowToMapping(row: {
    channel_id: string;
    channel_user_id: string;
    session_id: string;
    created_at: number;
    updated_at: number;
  }): ChannelSessionMapping {
    return {
      channelId: row.channel_id,
      channelUserId: row.channel_user_id,
      sessionId: row.session_id,
      createdAt: new Date(row.created_at * 1000),
      lastActivityAt: new Date(row.updated_at * 1000),
    };
  }

  private getDb() {
    return this.dbManager?.getDb();
  }

  /**
   * Get or create a session for a channel user
   */
  async getOrCreateSession(
    channelId: string,
    channelUserId: string,
    userName?: string
  ): Promise<{ sessionId: string; isNew: boolean }> {
    const db = this.getDb();
    const nowSec = Math.floor(Date.now() / 1000);
    const key = `${channelId}:${channelUserId}`;

    // Try to load from database first
    if (db) {
      const row = db.prepare(
        'SELECT * FROM channel_sessions WHERE channel_id = ? AND channel_user_id = ?'
      ).get(channelId, channelUserId) as {
        channel_id: string;
        channel_user_id: string;
        session_id: string;
        created_at: number;
        updated_at: number;
      } | undefined;

      if (row) {
        const elapsed = (nowSec - row.updated_at) * 1000;
        if (elapsed < this.sessionTimeoutMs) {
          // Update activity timestamp
          db.prepare(
            'UPDATE channel_sessions SET updated_at = ? WHERE channel_id = ? AND channel_user_id = ?'
          ).run(nowSec, channelId, channelUserId);

          await this.sessionManager.getSession(row.session_id);
          return { sessionId: row.session_id, isNew: false };
        } else {
          // Expired - delete old mapping
          db.prepare(
            'DELETE FROM channel_sessions WHERE channel_id = ? AND channel_user_id = ?'
          ).run(channelId, channelUserId);
          logger.info({ channelId, channelUserId, sessionId: row.session_id }, 'Channel session expired');
        }
      }
    } else {
      // Memory fallback
      const existing = this.memoryMappings.get(key);
      if (existing) {
        const elapsed = Date.now() - existing.lastActivityAt.getTime();
        if (elapsed < this.sessionTimeoutMs) {
          existing.lastActivityAt = new Date();
          this.memoryMappings.set(key, existing);
          await this.sessionManager.getSession(existing.sessionId);
          return { sessionId: existing.sessionId, isNew: false };
        } else {
          this.memoryMappings.delete(key);
        }
      }
    }

    // Create new session
    const session = await this.sessionManager.createSession({
      title: userName ? `Chat with ${userName}` : `Channel: ${channelId}`,
      modelId: this.defaultModelId,
      metadata: {
        source: 'channel',
        channelId,
        channelUserId,
        userName,
      },
    });

    // Store mapping
    if (db) {
      db.prepare(
        `INSERT INTO channel_sessions (channel_id, channel_user_id, session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, channel_user_id) DO UPDATE SET
           session_id = excluded.session_id,
           updated_at = excluded.updated_at`
      ).run(channelId, channelUserId, session.id, nowSec, nowSec);
    } else {
      this.memoryMappings.set(key, {
        channelId,
        channelUserId,
        sessionId: session.id,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        metadata: { userName },
      });
    }

    logger.info({ channelId, channelUserId, sessionId: session.id }, 'Created new channel session');
    return { sessionId: session.id, isNew: true };
  }

  /**
   * Get existing session without creating
   */
  getExistingSession(channelId: string, channelUserId: string): string | null {
    const db = this.getDb();
    const key = `${channelId}:${channelUserId}`;

    if (db) {
      const row = db.prepare(
        'SELECT session_id, updated_at FROM channel_sessions WHERE channel_id = ? AND channel_user_id = ?'
      ).get(channelId, channelUserId) as { session_id: string; updated_at: number } | undefined;

      if (!row) return null;

      const now = Math.floor(Date.now() / 1000);
      const elapsed = (now - row.updated_at) * 1000;

      if (elapsed >= this.sessionTimeoutMs) {
        db.prepare(
          'DELETE FROM channel_sessions WHERE channel_id = ? AND channel_user_id = ?'
        ).run(channelId, channelUserId);
        return null;
      }

      return row.session_id;
    }

    // Memory fallback
    const mapping = this.memoryMappings.get(key);
    if (!mapping) return null;
    const elapsed = Date.now() - mapping.lastActivityAt.getTime();
    if (elapsed >= this.sessionTimeoutMs) {
      this.memoryMappings.delete(key);
      return null;
    }
    return mapping.sessionId;
  }

  /**
   * Update last activity timestamp
   */
  touchSession(channelId: string, channelUserId: string): void {
    const db = this.getDb();
    const key = `${channelId}:${channelUserId}`;

    if (db) {
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        'UPDATE channel_sessions SET updated_at = ? WHERE channel_id = ? AND channel_user_id = ?'
      ).run(now, channelId, channelUserId);
    } else {
      const mapping = this.memoryMappings.get(key);
      if (mapping) {
        mapping.lastActivityAt = new Date();
        this.memoryMappings.set(key, mapping);
      }
    }
  }

  /**
   * End a session manually
   */
  async endSession(channelId: string, channelUserId: string): Promise<boolean> {
    const db = this.getDb();
    const key = `${channelId}:${channelUserId}`;

    if (db) {
      const result = db.prepare(
        'DELETE FROM channel_sessions WHERE channel_id = ? AND channel_user_id = ?'
      ).run(channelId, channelUserId);

      if (result.changes > 0) {
        logger.info({ channelId, channelUserId }, 'Channel session ended');
        return true;
      }
    } else {
      if (this.memoryMappings.has(key)) {
        this.memoryMappings.delete(key);
        logger.info({ channelId, channelUserId }, 'Channel session ended');
        return true;
      }
    }

    return false;
  }

  /**
   * Get all active sessions for a channel
   */
  getChannelSessions(channelId: string): ChannelSessionMapping[] {
    const db = this.getDb();

    if (db) {
      const now = Math.floor(Date.now() / 1000);
      const timeoutSeconds = Math.floor(this.sessionTimeoutMs / 1000);

      const rows = db.prepare(
        `SELECT * FROM channel_sessions
         WHERE channel_id = ? AND updated_at >= ?`
      ).all(channelId, now - timeoutSeconds) as Array<{
        channel_id: string;
        channel_user_id: string;
        session_id: string;
        created_at: number;
        updated_at: number;
      }>;

      return rows.map(r => this.rowToMapping(r));
    }

    // Memory fallback
    const sessions: ChannelSessionMapping[] = [];
    for (const mapping of this.memoryMappings.values()) {
      if (mapping.channelId === channelId) {
        const elapsed = Date.now() - mapping.lastActivityAt.getTime();
        if (elapsed < this.sessionTimeoutMs) {
          sessions.push(mapping);
        }
      }
    }
    return sessions;
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    const db = this.getDb();

    if (db) {
      const now = Math.floor(Date.now() / 1000);
      const timeoutSeconds = Math.floor(this.sessionTimeoutMs / 1000);

      const result = db.prepare(
        'DELETE FROM channel_sessions WHERE updated_at < ?'
      ).run(now - timeoutSeconds);

      const cleaned = result.changes;
      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up expired channel sessions');
      }
      return cleaned;
    }

    // Memory fallback
    const now = Date.now();
    let cleaned = 0;
    for (const [key, mapping] of this.memoryMappings.entries()) {
      const elapsed = now - mapping.lastActivityAt.getTime();
      if (elapsed >= this.sessionTimeoutMs) {
        this.memoryMappings.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up expired channel sessions');
    }
    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; byChannel: Record<string, number> } {
    const db = this.getDb();

    if (db) {
      const now = Math.floor(Date.now() / 1000);
      const timeoutSeconds = Math.floor(this.sessionTimeoutMs / 1000);

      const rows = db.prepare(
        `SELECT channel_id, COUNT(*) as count
         FROM channel_sessions
         WHERE updated_at >= ?
         GROUP BY channel_id`
      ).all(now - timeoutSeconds) as Array<{ channel_id: string; count: number }>;

      const byChannel: Record<string, number> = {};
      for (const row of rows) {
        byChannel[row.channel_id] = row.count;
      }

      return {
        total: rows.reduce((sum, r) => sum + r.count, 0),
        byChannel,
      };
    }

    // Memory fallback
    const byChannel: Record<string, number> = {};
    for (const mapping of this.memoryMappings.values()) {
      const elapsed = Date.now() - mapping.lastActivityAt.getTime();
      if (elapsed < this.sessionTimeoutMs) {
        byChannel[mapping.channelId] = (byChannel[mapping.channelId] || 0) + 1;
      }
    }

    return {
      total: Object.values(byChannel).reduce((sum, c) => sum + c, 0),
      byChannel,
    };
  }
}

// Singleton instance
let globalManager: ChannelSessionManager | null = null;

export function getChannelSessionManager(options?: ChannelSessionOptions): ChannelSessionManager {
  if (!globalManager && options) {
    globalManager = new ChannelSessionManager(options);
  }
  return globalManager!;
}

export function resetChannelSessionManager(): void {
  globalManager = null;
}
