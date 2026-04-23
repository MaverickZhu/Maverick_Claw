import { describe, it, expect, beforeEach } from 'vitest';
import { RoleService } from './role-service.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('RoleService', () => {
  let dbManager: DatabaseManager;
  let roleService: RoleService;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-role-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    roleService = new RoleService(dbManager);
    await roleService.initBuiltinRoles();
  });

  it('should initialize builtin roles', async () => {
    const roles = await roleService.listRoles();
    expect(roles.length).toBeGreaterThanOrEqual(3);
    const admin = roles.find(r => r.name === 'admin');
    expect(admin).toBeDefined();
    expect(admin?.scopes).toContain('*');
  });

  it('should create a custom role', async () => {
    const role = await roleService.createRole({
      name: 'editor',
      scopes: ['sessions:read', 'sessions:write'],
    });
    expect(role.name).toBe('editor');
    expect(role.scopes).toEqual(['sessions:read', 'sessions:write']);
    expect(role.isBuiltin).toBe(false);
  });

  it('should get role by id', async () => {
    const created = await roleService.createRole({ name: 'viewer', scopes: ['sessions:read'] });
    const found = await roleService.getRole(created.id);
    expect(found?.name).toBe('viewer');
  });

  it('should get role by name', async () => {
    const found = await roleService.getRoleByName('admin');
    expect(found).toBeDefined();
    expect(found?.name).toBe('admin');
  });

  it('should update role', async () => {
    const created = await roleService.createRole({ name: 'temp', scopes: ['sessions:read'] });
    await roleService.updateRole(created.id, { scopes: ['sessions:read', 'messages:read'] });
    const updated = await roleService.getRole(created.id);
    expect(updated?.scopes).toContain('messages:read');
  });

  it('should delete custom role', async () => {
    const created = await roleService.createRole({ name: 'deletable', scopes: [] });
    await roleService.deleteRole(created.id);
    const found = await roleService.getRole(created.id);
    expect(found).toBeNull();
  });

  it('should not delete builtin role', async () => {
    const admin = await roleService.getRoleByName('admin');
    await expect(roleService.deleteRole(admin!.id)).rejects.toThrow('Cannot delete builtin role');
  });
});
