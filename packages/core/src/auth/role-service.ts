import { v4 as uuidv4 } from 'uuid';
import type { Role } from '@maverick-claw/shared';
import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import { ADMIN_SCOPE, USER_DEFAULT_SCOPES } from './scopes.js';

export interface CreateRoleParams {
  name: string;
  scopes: string[];
}

export class RoleService {
  constructor(private dbManager: DatabaseManager) {}

  private get db() {
    return this.dbManager.getDb();
  }

  async initBuiltinRoles(): Promise<void> {
    const builtinRoles = [
      { id: 'role-admin', name: 'admin', scopes: [ADMIN_SCOPE] },
      { id: 'role-user', name: 'user', scopes: [...USER_DEFAULT_SCOPES] },
      { id: 'role-guest', name: 'guest', scopes: [Scope.SessionsRead, Scope.MessagesRead, Scope.ModelsRead] },
    ];

    for (const role of builtinRoles) {
      const existing = this.db.prepare('SELECT id FROM roles WHERE id = ?').get(role.id);
      if (!existing) {
        this.db.prepare(
          'INSERT INTO roles (id, name, scopes, is_builtin, created_at) VALUES (?, ?, ?, 1, ?)'
        ).run(role.id, role.name, JSON.stringify(role.scopes), Math.floor(Date.now() / 1000));
        logger.info({ role: role.name }, 'Created builtin role');
      }
    }
  }

  async createRole(params: CreateRoleParams): Promise<Role> {
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(
      'INSERT INTO roles (id, name, scopes, is_builtin, created_at) VALUES (?, ?, ?, 0, ?)'
    ).run(id, params.name, JSON.stringify(params.scopes), now);

    logger.info({ roleId: id, name: params.name }, 'Created role');

    return {
      id,
      name: params.name,
      scopes: params.scopes,
      isBuiltin: false,
      createdAt: new Date(now * 1000),
    };
  }

  async getRole(id: string): Promise<Role | null> {
    const row = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined;
    return row ? this.rowToRole(row) : null;
  }

  async getRoleByName(name: string): Promise<Role | null> {
    const row = this.db.prepare('SELECT * FROM roles WHERE name = ?').get(name) as RoleRow | undefined;
    return row ? this.rowToRole(row) : null;
  }

  async listRoles(): Promise<Role[]> {
    const rows = this.db.prepare('SELECT * FROM roles ORDER BY is_builtin DESC, name ASC').all() as RoleRow[];
    return rows.map((row) => this.rowToRole(row));
  }

  async updateRole(id: string, params: Partial<CreateRoleParams>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      sets.push('name = ?');
      values.push(params.name);
    }
    if (params.scopes !== undefined) {
      sets.push('scopes = ?');
      values.push(JSON.stringify(params.scopes));
    }

    if (sets.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    logger.info({ roleId: id }, 'Updated role');
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (role?.isBuiltin) {
      throw new Error('Cannot delete builtin role');
    }
    this.db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    logger.info({ roleId: id }, 'Deleted role');
  }

  private rowToRole(row: RoleRow): Role {
    return {
      id: row.id,
      name: row.name,
      scopes: JSON.parse(row.scopes),
      isBuiltin: row.is_builtin === 1,
      createdAt: new Date(row.created_at * 1000),
    };
  }
}

interface RoleRow {
  id: string;
  name: string;
  scopes: string;
  is_builtin: number;
  created_at: number;
}

// Re-import scopes for guest role
import { Scope } from './scopes.js';
