import { v4 as uuidv4 } from 'uuid';
import type { User } from '@maverick-claw/shared';
import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import { hashPassword, verifyPassword } from './password.js';

export interface CreateUserParams {
  name: string;
  email?: string;
  password: string;
  roleId?: string;
}

export interface UpdateUserParams {
  name?: string;
  email?: string;
  roleId?: string;
  status?: 'active' | 'inactive';
  authProvider?: 'local' | 'oauth' | 'ldap';
  externalId?: string;
}

export class UserService {
  constructor(private dbManager: DatabaseManager) {}

  private get db() {
    return this.dbManager.getDb();
  }

  async createUser(params: CreateUserParams): Promise<User> {
    const id = uuidv4();
    const now = Date.now();
    const passwordHash = await hashPassword(params.password);

    this.db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.name,
      params.email || null,
      passwordHash,
      params.roleId || null,
      'active',
      Math.floor(now / 1000),
      Math.floor(now / 1000)
    );

    logger.info({ userId: id, email: params.email }, 'Created user');

    return this.getUser(id) as Promise<User>;
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.db.prepare(
      `SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`
    ).get(id) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const row = this.db.prepare(
      `SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.email = ?`
    ).get(email) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  async listUsers(): Promise<User[]> {
    const rows = this.db.prepare(
      `SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id ORDER BY u.created_at DESC`
    ).all() as UserRow[];
    return rows.map((row) => this.rowToUser(row));
  }

  async updateUser(id: string, params: UpdateUserParams): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      sets.push('name = ?');
      values.push(params.name);
    }
    if (params.email !== undefined) {
      sets.push('email = ?');
      values.push(params.email || null);
    }
    if (params.roleId !== undefined) {
      sets.push('role_id = ?');
      values.push(params.roleId || null);
    }
    if (params.status !== undefined) {
      sets.push('status = ?');
      values.push(params.status);
    }
    if (params.authProvider !== undefined) {
      sets.push('auth_provider = ?');
      values.push(params.authProvider);
    }
    if (params.externalId !== undefined) {
      sets.push('external_id = ?');
      values.push(params.externalId || null);
    }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);

    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    logger.info({ userId: id }, 'Updated user');
  }

  async deleteUser(id: string): Promise<void> {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logger.info({ userId: id }, 'Deleted user');
  }

  async validatePassword(userId: string, password: string): Promise<boolean> {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
    if (!row?.password_hash) return false;
    return verifyPassword(password, row.password_hash);
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    this.db.prepare(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'
    ).run(passwordHash, Math.floor(Date.now() / 1000), userId);
    logger.info({ userId }, 'Updated password');
  }

  private rowToUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      email: row.email || undefined,
      roleId: row.role_id || undefined,
      roleName: row.role_name || undefined,
      status: (row.status as 'active' | 'inactive') || 'active',
      authProvider: (row.auth_provider as 'local' | 'oauth' | 'ldap') || 'local',
      externalId: row.external_id || undefined,
      createdAt: new Date(row.created_at * 1000),
      updatedAt: new Date(row.updated_at * 1000),
    };
  }
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  password_hash: string | null;
  role_id: string | null;
  status: string;
  auth_provider: string;
  external_id: string | null;
  created_at: number;
  updated_at: number;
  role_name: string | null;
}
