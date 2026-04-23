import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from './service.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('AuditService', () => {
  let dbManager: DatabaseManager;
  let auditService: AuditService;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-audit-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    auditService = new AuditService(dbManager);
  });

  it('should log an event', async () => {
    await auditService.log({
      userId: 'user-1',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: 'user-1',
      details: { method: 'password' },
    });

    const result = await auditService.query();
    expect(result.total).toBe(1);
    expect(result.logs[0].action).toBe('auth.login');
    expect(result.logs[0].details).toEqual({ method: 'password' });
  });

  it('should query by action', async () => {
    await auditService.log({ action: 'auth.login' });
    await auditService.log({ action: 'session.create' });
    await auditService.log({ action: 'auth.login' });

    const result = await auditService.query({ action: 'auth.login' });
    expect(result.total).toBe(2);
  });

  it('should query by userId', async () => {
    await auditService.log({ userId: 'user-1', action: 'a' });
    await auditService.log({ userId: 'user-2', action: 'b' });

    const result = await auditService.query({ userId: 'user-1' });
    expect(result.total).toBe(1);
  });

  it('should support pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await auditService.log({ action: `action-${i}` });
    }

    const result = await auditService.query({ limit: 2, offset: 0 });
    expect(result.logs.length).toBe(2);
    expect(result.total).toBe(5);
  });

  it('should get stats', async () => {
    await auditService.log({ action: 'auth.login' });
    await auditService.log({ action: 'auth.login' });
    await auditService.log({ action: 'session.create' });

    const stats = await auditService.getStats(7);
    expect(stats.totalEvents).toBe(3);
    expect(stats.actions['auth.login']).toBe(2);
    expect(stats.actions['session.create']).toBe(1);
  });

  it('should handle empty stats gracefully', async () => {
    const stats = await auditService.getStats(7);
    expect(stats.totalEvents).toBe(0);
  });
});
