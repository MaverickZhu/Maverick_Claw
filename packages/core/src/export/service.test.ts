import { describe, it, expect, beforeEach } from 'vitest';
import { ExportService } from './service.js';
import { ImportService } from '../import/service.js';
import { DatabaseManager } from '../storage/db.js';
import { ConfigManager } from '../config/manager.js';
import { getUploadService } from '../upload/index.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('Export/Import Service', () => {
  let dbManager: DatabaseManager;
  let exportService: ExportService;
  let importService: ImportService;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-export-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();

    // Insert test data
    const db = dbManager.getDb();
    db.prepare('INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('session-1', 'Test Session', 1000, 1000);
    db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('msg-1', 'session-1', 'user', 'Hello', 1001);

    const configManager = new ConfigManager();
    await configManager.load();

    exportService = new ExportService(dbManager, configManager, getUploadService());
    importService = new ImportService(dbManager);
  });

  it('should export data to zip buffer', async () => {
    const buffer = await exportService.exportAll();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('should import data from zip buffer', async () => {
    const buffer = await exportService.exportAll();

    // Clear data
    const db = dbManager.getDb();
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM sessions').run();

    const result = await importService.importFromBuffer(buffer);
    expect(result.success).toBe(true);
    expect(result.sessionsImported).toBe(1);
    expect(result.messagesImported).toBe(1);
  });

  it('should report error for invalid buffer', async () => {
    const result = await importService.importFromBuffer(Buffer.from('invalid'));
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
