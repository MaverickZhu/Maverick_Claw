import { v4 as uuidv4 } from 'uuid';
import type { Message } from '@maverick-claw/shared';
import type { DatabaseManager } from './db.js';
import { logger } from '../utils/logger.js';

export interface CreateMessageParams {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  toolCallId?: string;
}

export interface MessageListOptions {
  limit?: number;
  offset?: number;
}

export class MessageManager {
  constructor(private dbManager: DatabaseManager) {}

  private get db() {
    return this.dbManager.getDb();
  }

  async createMessage(params: CreateMessageParams): Promise<Message> {
    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at, metadata, tool_call_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.sessionId,
      params.role,
      params.content,
      Math.floor(now / 1000),
      JSON.stringify(params.metadata || {}),
      params.toolCallId || null
    );

    // Keep session activity in sync with message writes.
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(Math.floor(now / 1000), params.sessionId);

    logger.debug(`Created message: ${id} in session: ${params.sessionId}`);

    return {
      id,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      createdAt: new Date(now),
      metadata: params.metadata,
      toolCallId: params.toolCallId,
    };
  }

  async getMessage(id: string): Promise<Message | null> {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as MessageRow | undefined;

    if (!row) return null;
    return this.rowToMessage(row);
  }

  async listMessages(sessionId: string, options: MessageListOptions = {}): Promise<Message[]> {
    let sql = 'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC';
    const params: (string | number)[] = [sessionId];

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as MessageRow[];

    return rows.map((row) => this.rowToMessage(row));
  }

  async deleteMessage(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
    stmt.run(id);
    logger.debug(`Deleted message: ${id}`);
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
    const row = stmt.get(sessionId) as { count: number };
    return row.count;
  }

  async getMessageCounts(sessionIds: string[]): Promise<Record<string, number>> {
    if (sessionIds.length === 0) {
      return {};
    }

    const uniqueSessionIds = Array.from(new Set(sessionIds));
    const placeholders = uniqueSessionIds.map(() => '?').join(', ');
    const stmt = this.db.prepare(`
      SELECT session_id, COUNT(*) as count
      FROM messages
      WHERE session_id IN (${placeholders})
      GROUP BY session_id
    `);
    const rows = stmt.all(...uniqueSessionIds) as Array<{
      session_id: string;
      count: number;
    }>;

    const counts: Record<string, number> = {};
    for (const sessionId of uniqueSessionIds) {
      counts[sessionId] = 0;
    }
    for (const row of rows) {
      counts[row.session_id] = row.count;
    }

    return counts;
  }

  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as 'user' | 'assistant' | 'system' | 'tool',
      content: row.content,
      createdAt: new Date(row.created_at * 1000),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      toolCallId: row.tool_call_id || undefined,
    };
  }
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  metadata: string | null;
  tool_call_id: string | null;
}
