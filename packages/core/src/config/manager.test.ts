import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigManager } from './manager.js';

describe('ConfigManager', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-test-'));
    configPath = path.join(tempDir, 'config.json5');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create default config when file does not exist', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    const config = manager.get();
    expect(config.port).toBe(31987);
    expect(config.host).toBe('127.0.0.1');
    expect(config.models).toEqual([]);
    expect(config.channels).toHaveLength(1);
  });

  it('should load existing config', async () => {
    const testConfig = {
      port: 8080,
      host: '0.0.0.0',
      models: [{ id: 'test', name: 'Test Model', provider: 'test', enabled: true }],
      channels: [],
      auth: { type: 'token' },
      storage: { type: 'sqlite' },
    };

    await fs.writeFile(configPath, JSON.stringify(testConfig), 'utf-8');

    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    const config = manager.get();
    expect(config.port).toBe(8080);
    expect(config.host).toBe('0.0.0.0');
    expect(config.models).toHaveLength(1);
  });

  it('should add and remove models', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    await manager.addModel({
      id: 'test-model',
      name: 'Test Model',
      provider: 'test',
      enabled: true,
    });

    expect(manager.get().models).toHaveLength(1);

    await manager.removeModel('test-model');
    expect(manager.get().models).toHaveLength(0);
  });

  it('should throw when adding duplicate model', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    await manager.addModel({
      id: 'test',
      name: 'Test',
      provider: 'test',
      enabled: true,
    });

    await expect(
      manager.addModel({ id: 'test', name: 'Test 2', provider: 'test', enabled: true })
    ).rejects.toThrow("already exists");
  });

  it('should maintain default model when model list changes', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    await manager.addModel({
      id: 'model-a',
      name: 'Model A',
      provider: 'deepseek',
      enabled: true,
    });
    await manager.addModel({
      id: 'model-b',
      name: 'Model B',
      provider: 'openai',
      enabled: true,
    });

    await manager.setDefaultModel('openai:model-b');
    expect(manager.get().defaultModel).toBe('openai:model-b');

    await manager.removeModel('model-b');
    expect(manager.get().defaultModel).toBe('deepseek:model-a');
  });

  it('should reject disabled model as default', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    await manager.addModel({
      id: 'model-a',
      name: 'Model A',
      provider: 'deepseek',
      enabled: false,
    });

    await expect(manager.setDefaultModel('deepseek:model-a')).rejects.toThrow('disabled');
  });

  it('should add and remove channels', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    await manager.addChannel({
      id: 'test-channel',
      name: 'Test Channel',
      type: 'webhook',
      enabled: true,
      config: {},
    });

    expect(manager.get().channels).toHaveLength(2);

    await manager.removeChannel('test-channel');
    expect(manager.get().channels).toHaveLength(1);
  });

  it('should reject invalid channel config by contract', async () => {
    const manager = new ConfigManager({ configPath, enableHotReload: false });
    await manager.load();

    await expect(
      manager.addChannel({
        id: 'invalid-lark',
        name: 'Invalid Lark',
        type: 'lark',
        enabled: true,
        config: {
          appId: 'only-app-id',
        },
      })
    ).rejects.toThrow('appId 与 appSecret 必须同时配置');
  });
});
