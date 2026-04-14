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

-- Users table (for future multi-user support)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT, -- for local auth
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
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
    
    // Create tables
    this.db.exec(SCHEMA);
    
    // Run migrations
    this.runMigrations();
    
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
      const tableInfo = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
      const hasToolCallId = tableInfo.some(col => col.name === 'tool_call_id');
      
      if (!hasToolCallId) {
        this.db.exec('ALTER TABLE messages ADD COLUMN tool_call_id TEXT');
        logger.info('Migration: Added tool_call_id column to messages table');
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
