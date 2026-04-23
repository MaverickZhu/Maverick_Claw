import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthService } from './oauth-service.js';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';
import { TokenManager } from './token.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock openid-client
vi.mock('openid-client', () => ({
  Issuer: {
    discover: vi.fn().mockResolvedValue({
      Client: vi.fn().mockImplementation(() => ({
        authorizationUrl: vi.fn().mockImplementation((params: { state?: string }) => {
      const state = params?.state || 'test-state';
      return `https://auth.example.com/authorize?state=${state}`;
    }),
        callback: vi.fn().mockResolvedValue({ access_token: 'test-token' }),
        userinfo: vi.fn().mockResolvedValue({ sub: 'github-123', name: 'Test User', email: 'test@example.com' }),
      })),
    }),
  },
  generators: {
    state: vi.fn().mockReturnValue('mock-state'),
    nonce: vi.fn().mockReturnValue('mock-nonce'),
  },
}));

describe('OAuthService', () => {
  let dbManager: DatabaseManager;
  let userService: UserService;
  let roleService: RoleService;
  let tokenManager: TokenManager;
  let oauthService: OAuthService;
  let dbPath: string;

  const providerConfig = {
    id: 'github',
    name: 'GitHub',
    type: 'oidc' as const,
    clientId: 'test-client-id',
    clientSecret: 'test-secret',
    issuerUrl: 'https://github.com',
    redirectUri: 'http://localhost:31987/api/auth/oauth/callback',
    scopes: ['openid', 'profile', 'email'],
    enabled: true,
  };

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-oauth-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    userService = new UserService(dbManager);
    roleService = new RoleService(dbManager);
    await roleService.initBuiltinRoles();
    tokenManager = new TokenManager(dbManager);
    oauthService = new OAuthService(dbManager, userService, roleService, tokenManager);
  });

  it('should get safe provider list', () => {
    const providers = oauthService.getProviders([providerConfig]);
    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({ id: 'github', name: 'GitHub', type: 'oidc' });
    expect(providers[0]).not.toHaveProperty('clientSecret');
  });

  it('should generate auth URL and store state', async () => {
    const url = await oauthService.getAuthUrl(providerConfig);
    expect(url).toContain('state=mock-state');

    // Verify state stored in DB
    const db = dbManager.getDb();
    const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get('mock-state');
    expect(row).toBeDefined();
  });

  it('should handle callback and create new user', async () => {
    const url = await oauthService.getAuthUrl(providerConfig);
    const result = await oauthService.handleCallback(providerConfig, 'test-code', 'mock-state');

    expect(result).not.toBeNull();
    expect(result?.isNewUser).toBe(true);
    expect(result?.user.name).toBe('Test User');
    expect(result?.token).toBeDefined();
  });

  it('should handle callback and link existing user by email', async () => {
    await userService.createUser({ name: 'Existing', email: 'test@example.com', password: 'pw' });

    await oauthService.getAuthUrl(providerConfig);
    const result = await oauthService.handleCallback(providerConfig, 'test-code', 'mock-state');

    expect(result).not.toBeNull();
    expect(result?.isNewUser).toBe(false);
    expect(result?.user.email).toBe('test@example.com');
  });

  it('should reject invalid state', async () => {
    const result = await oauthService.handleCallback(providerConfig, 'test-code', 'invalid-state');
    expect(result).toBeNull();
  });

  it('should cleanup expired states', async () => {
    const db = dbManager.getDb();
    db.prepare('INSERT INTO oauth_states (state, provider_id, created_at) VALUES (?, ?, ?)').run(
      'old-state', 'github', Math.floor(Date.now() / 1000) - 1000
    );

    const cleaned = oauthService.cleanupStates();
    expect(cleaned).toBeGreaterThanOrEqual(1);

    const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get('old-state');
    expect(row).toBeUndefined();
  });
});
