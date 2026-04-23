import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager } from './token.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('TokenManager (DB mode)', () => {
  let dbManager: DatabaseManager;
  let tokenManager: TokenManager;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-token-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    tokenManager = new TokenManager(dbManager);
  });

  it('should create and validate token with DB storage', () => {
    const result = tokenManager.createToken('user-1', 'device-1');
    expect(result.token).toBeDefined();
    expect(result.token).toMatch(/^mc_/);

    const payload = tokenManager.validateToken(result.token);
    expect(payload).toBeDefined();
    expect(payload?.userId).toBe('user-1');
    expect(payload?.deviceId).toBe('device-1');
  });

  it('should revoke token in DB', () => {
    const { token } = tokenManager.createToken('user-1', 'device-1');
    expect(tokenManager.validateToken(token)).toBeDefined();

    tokenManager.revokeToken(token);
    expect(tokenManager.validateToken(token)).toBeNull();
  });

  it('should revoke all tokens for a user', () => {
    const t1 = tokenManager.createToken('user-1', 'd1');
    const t2 = tokenManager.createToken('user-1', 'd2');
    const t3 = tokenManager.createToken('user-2', 'd1');

    tokenManager.revokeUserTokens('user-1');

    expect(tokenManager.validateToken(t1.token)).toBeNull();
    expect(tokenManager.validateToken(t2.token)).toBeNull();
    expect(tokenManager.validateToken(t3.token)).toBeDefined();
  });

  it('should cleanup expired tokens', () => {
    const { token } = tokenManager.createToken('user-1', 'device-1', -1); // already expired
    expect(tokenManager.validateToken(token)).toBeNull();

    const cleaned = tokenManager.cleanup();
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });

  it('should return null for unknown token', () => {
    expect(tokenManager.validateToken('invalid-token')).toBeNull();
  });

  it('should store scopes in DB', () => {
    const result = tokenManager.createToken('user-1', 'device-1', {
      scopes: ['sessions:read', 'messages:read'],
      ttlHours: 1,
    });

    const payload = tokenManager.validateToken(result.token);
    expect(payload?.scopes).toEqual(['sessions:read', 'messages:read']);
  });
});
