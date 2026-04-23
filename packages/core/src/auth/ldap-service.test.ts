import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LDAPService } from './ldap-service.js';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';
import { TokenManager } from './token.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock ldapjs (use vi.hoisted so mocks are available in the hoisted vi.mock factory)
const { mockBind, mockSearch, mockUnbind } = vi.hoisted(() => ({
  mockBind: vi.fn(),
  mockSearch: vi.fn(),
  mockUnbind: vi.fn(),
}));

vi.mock('ldapjs', () => ({
  default: {
    createClient: vi.fn().mockReturnValue({
      bind: mockBind,
      search: mockSearch,
      unbind: mockUnbind,
    }),
  },
}));

describe('LDAPService', () => {
  let dbManager: DatabaseManager;
  let userService: UserService;
  let roleService: RoleService;
  let tokenManager: TokenManager;
  let ldapService: LDAPService;
  let dbPath: string;

  const ldapConfig = {
    enabled: true,
    server: 'ldap://localhost:389',
    bindDN: 'cn=admin,dc=example,dc=com',
    bindPassword: 'admin-pass',
    baseDN: 'dc=example,dc=com',
    userFilter: '(uid={{username}})',
    groupFilter: '(member={{userDN}})',
    tls: false,
    defaultRoleId: 'role-user',
  };

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ldap-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    userService = new UserService(dbManager);
    roleService = new RoleService(dbManager);
    await roleService.initBuiltinRoles();
    tokenManager = new TokenManager(dbManager);
    ldapService = new LDAPService(userService, roleService, tokenManager);

    mockBind.mockClear();
    mockSearch.mockClear();
    mockUnbind.mockClear();
  });

  it('should authenticate via LDAP and create new user', async () => {
    // Mock admin bind success
    mockBind.mockImplementation((_dn, _pw, cb) => cb(null));
    // Mock user search
    mockSearch.mockImplementation((_base, _opts, cb) => {
      const res = {
        on: (event: string, handler: unknown) => {
          if (event === 'searchEntry') {
            (handler as (entry: unknown) => void)({
              dn: { toString: () => 'uid=john,dc=example,dc=com' },
              pojo: {
                attributes: [
                  { type: 'cn', values: ['John Doe'] },
                  { type: 'mail', values: ['john@example.com'] },
                ],
              },
            });
          }
          if (event === 'end') {
            (handler as () => void)();
          }
        },
      };
      cb(null, res);
    });

    const result = await ldapService.authenticate('john', 'password', ldapConfig);

    expect(result).not.toBeNull();
    expect(result?.user.name).toBe('John Doe');
  });

  it('should reject invalid password', async () => {
    mockBind.mockImplementation((dn, _pw, cb) => {
      if (dn.includes('john')) {
        cb(new Error('Invalid credentials'));
      } else {
        cb(null);
      }
    });
    mockSearch.mockImplementation((_base, _opts, cb) => {
      const res = {
        on: (event: string, handler: unknown) => {
          if (event === 'searchEntry') {
            (handler as (entry: unknown) => void)({
              dn: { toString: () => 'uid=john,dc=example,dc=com' },
              pojo: { attributes: [] },
            });
          }
          if (event === 'end') {
            (handler as () => void)();
          }
        },
      };
      cb(null, res);
    });

    const result = await ldapService.authenticate('john', 'wrong', ldapConfig);
    expect(result).toBeNull();
  });

  it('should return null when user not found', async () => {
    mockBind.mockImplementation((_dn, _pw, cb) => cb(null));
    mockSearch.mockImplementation((_base, _opts, cb) => {
      const res = {
        on: (event: string, handler: unknown) => {
          if (event === 'end') {
            (handler as () => void)();
          }
        },
      };
      cb(null, res);
    });

    const result = await ldapService.authenticate('unknown', 'pass', ldapConfig);
    expect(result).toBeNull();
  });

  it('should authenticate via LDAP and link existing user', async () => {
    await userService.createUser({ name: 'John', email: 'john@example.com', password: 'pw' });

    mockBind.mockImplementation((_dn, _pw, cb) => cb(null));
    mockSearch.mockImplementation((_base, _opts, cb) => {
      const res = {
        on: (event: string, handler: unknown) => {
          if (event === 'searchEntry') {
            (handler as (entry: unknown) => void)({
              dn: { toString: () => 'uid=john,dc=example,dc=com' },
              pojo: {
                attributes: [
                  { type: 'cn', values: ['John Doe'] },
                  { type: 'mail', values: ['john@example.com'] },
                ],
              },
            });
          }
          if (event === 'end') {
            (handler as () => void)();
          }
        },
      };
      cb(null, res);
    });

    const result = await ldapService.authenticate('john', 'password', ldapConfig);
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('john@example.com');
  });
});
