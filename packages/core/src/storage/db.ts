import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { logger } from '../utils/logger.js';

// Database schema
const SCHEMA = `
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '新会话',
  model_id TEXT,
  user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT -- JSON
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT, -- JSON: { model, tokens, tools, etc. }
  tool_call_id TEXT, -- For tool response messages
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Config table
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT, -- for local auth
  role_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  auth_provider TEXT NOT NULL DEFAULT 'local',
  external_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL, -- JSON array
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tokens table (DB-backed token storage)
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT,
  scopes TEXT NOT NULL, -- JSON array
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT, -- JSON
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL, -- JSON (ExecutionPlan compatible)
  owner_id TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Usage records table
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Channel sessions mapping table (persist in-memory mappings)
CREATE TABLE IF NOT EXISTS channel_sessions (
  channel_id TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (channel_id, channel_user_id)
);

-- Session summaries table (for long-term memory)
CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_session_id ON usage_records(session_id);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_session_id ON channel_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_workflows_owner ON workflows(owner_id);

-- OAuth state temporary table (CSRF protection)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  redirect_uri TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_created ON oauth_states(created_at);

-- Plugins table (for plugin market / installed plugins)
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  author TEXT,
  source TEXT, -- 'builtin', 'local', or remote URL
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  manifest TEXT -- JSON
);
CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled);
`;

export interface DatabaseOptions {
  dbPath?: string;
}

export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(options: DatabaseOptions = {}) {
    this.dbPath = options.dbPath || this.getDefaultDbPath();
  }

  private getDefaultDbPath(): string {
    const dataDir = process.env.MAVERICK_CLAW_DATA_DIR || 
      path.join(os.homedir(), '.maverick-claw');
    return path.join(dataDir, 'data.db');
  }

  async init(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    // Run migrations first (add missing columns to existing tables)
    this.runMigrations();
    
    // Create tables and indexes
    this.db.exec(SCHEMA);
    
    logger.info(`Database initialized at ${this.dbPath}`);
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database closed');
    }
  }

  // Run database migrations
  private runMigrations(): void {
    if (!this.db) return;
    
    try {
      // Check if tool_call_id column exists
      const messagesInfo = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
      const hasToolCallId = messagesInfo.some(col => col.name === 'tool_call_id');
      
      if (!hasToolCallId) {
        this.db.exec('ALTER TABLE messages ADD COLUMN tool_call_id TEXT');
        logger.info('Migration: Added tool_call_id column to messages table');
      }

      // Check if users table has required columns
      const usersInfo = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      const hasRoleId = usersInfo.some(col => col.name === 'role_id');
      const hasStatus = usersInfo.some(col => col.name === 'status');
      const hasUpdatedAt = usersInfo.some(col => col.name === 'updated_at');
      const hasAuthProvider = usersInfo.some(col => col.name === 'auth_provider');
      const hasExternalId = usersInfo.some(col => col.name === 'external_id');
      
      if (!hasRoleId) {
        this.db.exec('ALTER TABLE users ADD COLUMN role_id TEXT');
        logger.info('Migration: Added role_id column to users table');
      }
      if (!hasStatus) {
        this.db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
        logger.info('Migration: Added status column to users table');
      }
      if (!hasUpdatedAt) {
        this.db.exec("ALTER TABLE users ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch())");
        logger.info('Migration: Added updated_at column to users table');
      }
      if (!hasAuthProvider) {
        this.db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'");
        logger.info('Migration: Added auth_provider column to users table');
      }
      if (!hasExternalId) {
        this.db.exec('ALTER TABLE users ADD COLUMN external_id TEXT');
        logger.info('Migration: Added external_id column to users table');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Migration failed, may already have the column');
    }
  }

  // Health check
  isHealthy(): boolean {
    try {
      if (!this.db) return false;
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let globalDbManager: DatabaseManager | null = null;

export function getDatabaseManager(options?: DatabaseOptions): DatabaseManager {
  if (!globalDbManager) {
    globalDbManager = new DatabaseManager(options);
  }
  return globalDbManager;
}

export async function initDatabase(options?: DatabaseOptions): Promise<DatabaseManager> {
  const manager = getDatabaseManager(options);
  await manager.init();
  return manager;
}
