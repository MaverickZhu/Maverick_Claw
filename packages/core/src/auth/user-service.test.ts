import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('UserService', () => {
  let dbManager: DatabaseManager;
  let userService: UserService;
  let roleService: RoleService;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-user-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    userService = new UserService(dbManager);
    roleService = new RoleService(dbManager);
    await roleService.initBuiltinRoles();
  });

  it('should create a user', async () => {
    const user = await userService.createUser({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });
    expect(user.name).toBe('Test User');
    expect(user.email).toBe('test@example.com');
    expect(user.status).toBe('active');
  });

  it('should get user by id', async () => {
    const created = await userService.createUser({ name: 'Alice', password: 'pw' });
    const found = await userService.getUser(created.id);
    expect(found?.name).toBe('Alice');
  });

  it('should get user by email', async () => {
    await userService.createUser({ name: 'Bob', email: 'bob@test.com', password: 'pw' });
    const found = await userService.getUserByEmail('bob@test.com');
    expect(found?.name).toBe('Bob');
  });

  it('should list users', async () => {
    await userService.createUser({ name: 'User1', password: 'pw' });
    await userService.createUser({ name: 'User2', password: 'pw' });
    const users = await userService.listUsers();
    expect(users.length).toBe(2);
  });

  it('should update user', async () => {
    const created = await userService.createUser({ name: 'Old', password: 'pw' });
    await userService.updateUser(created.id, { name: 'New' });
    const updated = await userService.getUser(created.id);
    expect(updated?.name).toBe('New');
  });

  it('should delete user', async () => {
    const created = await userService.createUser({ name: 'ToDelete', password: 'pw' });
    await userService.deleteUser(created.id);
    const found = await userService.getUser(created.id);
    expect(found).toBeNull();
  });

  it('should validate correct password', async () => {
    const created = await userService.createUser({ name: 'Check', password: 'secret123' });
    const valid = await userService.validatePassword(created.id, 'secret123');
    expect(valid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const created = await userService.createUser({ name: 'Check', password: 'secret123' });
    const valid = await userService.validatePassword(created.id, 'wrong');
    expect(valid).toBe(false);
  });

  it('should update password', async () => {
    const created = await userService.createUser({ name: 'Check', password: 'oldpass' });
    await userService.updatePassword(created.id, 'newpass');
    const validOld = await userService.validatePassword(created.id, 'oldpass');
    const validNew = await userService.validatePassword(created.id, 'newpass');
    expect(validOld).toBe(false);
    expect(validNew).toBe(true);
  });

  it('should assign role to user', async () => {
    const adminRole = await roleService.getRoleByName('admin');
    const user = await userService.createUser({
      name: 'AdminUser',
      password: 'pw',
      roleId: adminRole?.id,
    });
    expect(user.roleId).toBe(adminRole?.id);
    expect(user.roleName).toBe('admin');
  });
});
