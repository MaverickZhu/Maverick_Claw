import { v4 as uuidv4 } from 'uuid';
import type { AuditLog } from '@maverick-claw/shared';
import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';

export interface AuditEvent {
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditQueryFilters {
  action?: string;
  resourceType?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export class AuditService {
  constructor(private dbManager: DatabaseManager) {}

  private get db() {
    return this.dbManager.getDb();
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      const id = uuidv4();
      const now = Math.floor(Date.now() / 1000);

      this.db.prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        event.userId || null,
        event.action,
        event.resourceType || null,
        event.resourceId || null,
        event.details ? JSON.stringify(event.details) : null,
        event.ipAddress || null,
        event.userAgent || null,
        now
      );
    } catch (err) {
      // Audit logging should never fail the main operation
      logger.warn({ err, action: event.action }, 'Failed to write audit log');
    }
  }

  async query(filters: AuditQueryFilters = {}): Promise<{ logs: AuditLog[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.action) {
      where.push('action = ?');
      params.push(filters.action);
    }
    if (filters.resourceType) {
      where.push('resource_type = ?');
      params.push(filters.resourceType);
    }
    if (filters.userId) {
      where.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.from) {
      where.push('created_at >= ?');
      params.push(Math.floor(filters.from.getTime() / 1000));
    }
    if (filters.to) {
      where.push('created_at <= ?');
      params.push(Math.floor(filters.to.getTime() / 1000));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // Count total
    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${whereClause}`).get(...params) as { count: number };
    const total = countRow.count;

    // Query logs
    let sql = `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC`;
    const queryParams = [...params];

    if (filters.limit) {
      sql += ' LIMIT ?';
      queryParams.push(filters.limit);
    }
    if (filters.offset) {
      sql += ' OFFSET ?';
      queryParams.push(filters.offset);
    }

    const rows = this.db.prepare(sql).all(...queryParams) as AuditRow[];
    const logs = rows.map((row) => this.rowToLog(row));

    return { logs, total };
  }

  async getStats(days = 7): Promise<{ totalEvents: number; actions: Record<string, number> }> {
    const from = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

    const totalRow = this.db.prepare(
      'SELECT COUNT(*) as count FROM audit_logs WHERE created_at >= ?'
    ).get(from) as { count: number };

    const actionRows = this.db.prepare(
      'SELECT action, COUNT(*) as count FROM audit_logs WHERE created_at >= ? GROUP BY action'
    ).all(from) as { action: string; count: number }[];

    const actions: Record<string, number> = {};
    for (const row of actionRows) {
      actions[row.action] = row.count;
    }

    return { totalEvents: totalRow.count, actions };
  }

  private rowToLog(row: AuditRow): AuditLog {
    return {
      id: row.id,
      userId: row.user_id || undefined,
      action: row.action,
      resourceType: row.resource_type || undefined,
      resourceId: row.resource_id || undefined,
      details: row.details ? JSON.parse(row.details) : undefined,
      ipAddress: row.ip_address || undefined,
      userAgent: row.user_agent || undefined,
      createdAt: new Date(row.created_at * 1000),
    };
  }
}

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
}
