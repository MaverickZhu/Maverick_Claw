import { describe, it, expect, beforeEach } from 'vitest';
import { SSOService } from './sso-service.js';
import { OAuthService } from './oauth-service.js';
import { LDAPService } from './ldap-service.js';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';
import { TokenManager } from './token.js';
import { DatabaseManager } from '../storage/db.js';
import type { GatewayConfig } from '@maverick-claw/shared';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('SSOService', () => {
  let dbManager: DatabaseManager;
  let oauthService: OAuthService;
  let ldapService: LDAPService;
  let ssoService: SSOService;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sso-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    const userService = new UserService(dbManager);
    const roleService = new RoleService(dbManager);
    await roleService.initBuiltinRoles();
    const tokenManager = new TokenManager(dbManager);
    oauthService = new OAuthService(dbManager, userService, roleService, tokenManager);
    ldapService = new LDAPService(userService, roleService, tokenManager);
    ssoService = new SSOService(oauthService, ldapService);
  });

  it('should return all auth methods when configured', () => {
    const config: GatewayConfig = {
      port: 31987,
      host: '127.0.0.1',
      auth: {
        type: 'token',
        token: 'test',
        oauth: {
          providers: [
            { id: 'github', name: 'GitHub', type: 'oidc', clientId: 'c', clientSecret: 's', redirectUri: 'r', scopes: [], enabled: true },
          ],
        },
        ldap: {
          enabled: true,
          server: 'ldap://localhost',
          baseDN: 'dc=example,dc=com',
          userFilter: '(uid={{username}})',
          tls: false,
        },
      },
      models: [],
      channels: [],
      storage: { type: 'sqlite' },
    };

    const methods = ssoService.getAuthMethods(config);
    expect(methods.local).toBe(true);
    expect(methods.oauth).toHaveLength(1);
    expect(methods.ldap).toBe(true);
  });

  it('should return only local when no SSO configured', () => {
    const config: GatewayConfig = {
      port: 31987,
      host: '127.0.0.1',
      auth: {
        type: 'token',
      },
      models: [],
      channels: [],
      storage: { type: 'sqlite' },
    };

    const methods = ssoService.getAuthMethods(config);
    expect(methods.local).toBe(true);
    expect(methods.oauth).toHaveLength(0);
    expect(methods.ldap).toBe(false);
  });

  it('should filter disabled oauth providers', () => {
    const config: GatewayConfig = {
      port: 31987,
      host: '127.0.0.1',
      auth: {
        type: 'token',
        oauth: {
          providers: [
            { id: 'github', name: 'GitHub', type: 'oidc', clientId: 'c', clientSecret: 's', redirectUri: 'r', scopes: [], enabled: true },
            { id: 'google', name: 'Google', type: 'oidc', clientId: 'c', clientSecret: 's', redirectUri: 'r', scopes: [], enabled: false },
          ],
        },
      },
      models: [],
      channels: [],
      storage: { type: 'sqlite' },
    };

    const methods = ssoService.getAuthMethods(config);
    expect(methods.oauth).toHaveLength(1);
    expect(methods.oauth[0].id).toBe('github');
  });
});
