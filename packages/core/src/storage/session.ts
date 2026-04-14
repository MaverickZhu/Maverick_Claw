import { v4 as uuidv4 } from 'uuid';
import type { Session, Message } from '@maverick-claw/shared';
import type { DatabaseManager } from './db.js';
import { MessageManager, type CreateMessageParams, type MessageListOptions } from './message.js';
import { logger } from '../utils/logger.js';

export interface CreateSessionParams {
  title?: string;
  modelId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  userId?: string;
  limit?: number;
  offset?: number;
}

export class SessionManager {
  private readonly messageManager: MessageManager;

  constructor(private dbManager: DatabaseManager) {
    this.messageManager = new MessageManager(dbManager);
  }

  private get db() {
    return this.dbManager.getDb();
  }

  // Session operations

  async createSession(params: CreateSessionParams): Promise<Session> {
    const id = uuidv4();
    const now = Date.now();
    const title = params.title || '新会话';

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, model_id, user_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      title,
      params.modelId || null,
      params.userId || null,
      Math.floor(now / 1000),
      Math.floor(now / 1000),
      JSON.stringify(params.metadata || {})
    );

    logger.debug(`Created session: ${id}`);

    return {
      id,
      title,
      userId: params.userId || '',
      modelId: params.modelId || '',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      messageCount: 0,
    };
  }

  async getSession(id: string): Promise<Session | null> {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;

    if (!row) return null;

    return this.rowToSession(row);
  }

  async listSessions(filter: SessionFilter = {}): Promise<Session[]> {
    let sql = 'SELECT * FROM sessions';
    const params: (string | number)[] = [];

    if (filter.userId) {
      sql += ' WHERE user_id = ?';
      params.push(filter.userId);
    }

    sql += ' ORDER BY updated_at DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as SessionRow[];

    return rows.map(row => this.rowToSession(row));
  }

  async updateSession(id: string, updates: Partial<Pick<Session, 'title' | 'modelId'>>): Promise<void> {
    const sets: string[] = [];
    const params: (string | number)[] = [];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      params.push(updates.title);
    }

    if (updates.modelId !== undefined) {
      sets.push('model_id = ?');
      params.push(updates.modelId);
    }

    sets.push('updated_at = ?');
    params.push(Math.floor(Date.now() / 1000));
    params.push(id);

    const sql = `UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    stmt.run(...params);

    logger.debug(`Updated session: ${id}`);
  }

  async deleteSession(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
    logger.debug(`Deleted session: ${id}`);
  }

  // Message operations (delegated to MessageManager)

  async createMessage(params: CreateMessageParams): Promise<Message> {
    return this.messageManager.createMessage(params);
  }

  async getMessage(id: string): Promise<Message | null> {
    return this.messageManager.getMessage(id);
  }

  async listMessages(sessionId: string, options: MessageListOptions = {}): Promise<Message[]> {
    return this.messageManager.listMessages(sessionId, options);
  }

  async deleteMessage(id: string): Promise<void> {
    await this.messageManager.deleteMessage(id);
  }

  // Stats

  async getMessageCount(sessionId: string): Promise<number> {
    return this.messageManager.getMessageCount(sessionId);
  }

  // Helpers

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      title: row.title,
      userId: row.user_id || '',
      modelId: row.model_id || '',
      createdAt: new Date(row.created_at * 1000),
      updatedAt: new Date(row.updated_at * 1000),
      messageCount: 0, // Will be populated separately
    };
  }

}

// Database row types
interface SessionRow {
  id: string;
  title: string;
  model_id: string | null;
  user_id: string | null;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

