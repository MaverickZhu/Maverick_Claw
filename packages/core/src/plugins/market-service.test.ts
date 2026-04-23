import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginMarketService } from './market-service.js';
import { DatabaseManager } from '../storage/db.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock https/http (use vi.hoisted so mocks are available in the hoisted vi.mock factory)
const mockGet = vi.hoisted(() => vi.fn());
vi.mock('https', () => ({
  default: { get: mockGet },
  get: mockGet,
}));
vi.mock('http', () => ({
  default: { get: mockGet },
  get: mockGet,
}));

describe('PluginMarketService', () => {
  let dbManager: DatabaseManager;
  let marketService: PluginMarketService;
  let dbPath: string;
  let pluginsDir: string;

  const sampleRegistry = {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    plugins: [
      {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        downloadUrl: 'https://example.com/test-plugin.zip',
        permissions: ['model'],
      },
      {
        id: 'test-plugin-2',
        name: 'Test Plugin 2',
        version: '2.0.0',
        description: 'Another test plugin',
        author: 'Test Author 2',
        downloadUrl: 'https://example.com/test-plugin-2.zip',
      },
    ],
  };

  function setupMockGet(responseData: string | Buffer, statusCode = 200, redirectUrl?: string) {
    mockGet.mockImplementation((url: string, callback: (res: unknown) => void) => {
      const req = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      };

      if (redirectUrl) {
        process.nextTick(() => {
          callback({
            statusCode: 302,
            headers: { location: redirectUrl },
            on: vi.fn(),
          });
        });
        return req;
      }

      process.nextTick(() => {
        // If URL ends with .json, always return JSON string even if responseData is Buffer
        const isJsonUrl = typeof url === 'string' && url.endsWith('.json');
        const data = isJsonUrl && Buffer.isBuffer(responseData)
          ? JSON.stringify(sampleRegistry)
          : responseData;

        const res = {
          statusCode,
          headers: {},
          on: (event: string, handler: unknown) => {
            if (event === 'data') {
              if (Buffer.isBuffer(data)) {
                (handler as (chunk: Buffer) => void)(data);
              } else {
                (handler as (chunk: string) => void)(data);
              }
            }
            if (event === 'end') {
              (handler as () => void)();
            }
          },
        };
        callback(res);
      });

      return req;
    });
  }

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-market-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    pluginsDir = path.join(tmpDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });

    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();

    marketService = new PluginMarketService(dbManager, {
      registryUrl: 'https://registry.test/plugins.json',
      pluginsDir,
    });

    mockGet.mockClear();
  });

  it('should fetch registry index', async () => {
    setupMockGet(JSON.stringify(sampleRegistry));
    const registry = await marketService.fetchRegistry();
    expect(registry).not.toBeNull();
    expect(registry?.plugins).toHaveLength(2);
    expect(registry?.plugins[0].id).toBe('test-plugin');
  });

  it('should return null when registry fetch fails', async () => {
    setupMockGet('Error', 500);
    const registry = await marketService.fetchRegistry();
    expect(registry).toBeNull();
  });

  it('should list market plugins', async () => {
    setupMockGet(JSON.stringify(sampleRegistry));
    const plugins = await marketService.listMarketPlugins();
    expect(plugins).toHaveLength(2);
  });

  it('should get a market plugin by id', async () => {
    setupMockGet(JSON.stringify(sampleRegistry));
    const plugin = await marketService.getMarketPlugin('test-plugin');
    expect(plugin).not.toBeNull();
    expect(plugin?.name).toBe('Test Plugin');
  });

  it('should return null for unknown market plugin', async () => {
    setupMockGet(JSON.stringify(sampleRegistry));
    const plugin = await marketService.getMarketPlugin('unknown');
    expect(plugin).toBeNull();
  });

  it('should install a plugin', async () => {
    // Create a minimal ZIP with manifest.json
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: 'Test Author',
      entry: 'index.js',
    }));
    zip.file('index.js', 'module.exports = { name: "Test Plugin", version: "1.0.0", init: async () => {} };');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    setupMockGet(zipBuffer);

    const result = await marketService.install('test-plugin');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('test-plugin');
    expect(result?.version).toBe('1.0.0');

    // Verify directory exists
    const pluginDir = path.join(pluginsDir, 'test-plugin');
    expect(fs.existsSync(pluginDir)).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'manifest.json'))).toBe(true);

    // Verify DB record
    const installed = marketService.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].id).toBe('test-plugin');
  });

  it('should not install if plugin already installed', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      entry: 'index.js',
    }));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    setupMockGet(zipBuffer);

    await marketService.install('test-plugin');
    const result = await marketService.install('test-plugin');
    expect(result).toBeNull();
  });

  it('should uninstall a plugin', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      entry: 'index.js',
    }));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    setupMockGet(zipBuffer);

    await marketService.install('test-plugin');
    const success = await marketService.uninstall('test-plugin');
    expect(success).toBe(true);

    const pluginDir = path.join(pluginsDir, 'test-plugin');
    expect(fs.existsSync(pluginDir)).toBe(false);

    const installed = marketService.listInstalled();
    expect(installed).toHaveLength(0);
  });

  it('should return false when uninstalling non-existent plugin', async () => {
    const success = await marketService.uninstall('non-existent');
    expect(success).toBe(false);
  });

  it('should list installed plugins', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      entry: 'index.js',
    }));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    setupMockGet(zipBuffer);

    await marketService.install('test-plugin');
    const installed = marketService.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].enabled).toBe(true);
  });

  it('should enable/disable a plugin', async () => {
    const db = dbManager.getDb();
    db.prepare('INSERT INTO plugins (id, name, version, enabled) VALUES (?, ?, ?, ?)').run('test-plugin', 'Test', '1.0.0', 1);

    const result = marketService.setEnabled('test-plugin', false);
    expect(result).toBe(true);

    const plugin = marketService.getInstalled('test-plugin');
    expect(plugin?.enabled).toBe(false);
  });

  it('should check for updates', async () => {
    // Install old version
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      entry: 'index.js',
    }));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    setupMockGet(zipBuffer);
    await marketService.install('test-plugin');

    // Registry now has v2.0.0
    const updatedRegistry = {
      ...sampleRegistry,
      plugins: [
        { ...sampleRegistry.plugins[0], version: '2.0.0' },
        sampleRegistry.plugins[1],
      ],
    };
    setupMockGet(JSON.stringify(updatedRegistry));

    const updates = await marketService.checkUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].current).toBe('1.0.0');
    expect(updates[0].latest).toBe('2.0.0');
  });

  it('should update a plugin', async () => {
    // Install v1.0.0
    const JSZip = (await import('jszip')).default;
    const zip1 = new JSZip();
    zip1.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      entry: 'index.js',
    }));
    const zipBuffer1 = await zip1.generateAsync({ type: 'nodebuffer' });
    setupMockGet(zipBuffer1);
    await marketService.install('test-plugin');

    // Registry has v2.0.0
    const updatedRegistry = {
      ...sampleRegistry,
      plugins: [
        { ...sampleRegistry.plugins[0], version: '2.0.0' },
        sampleRegistry.plugins[1],
      ],
    };

    // Update download returns v2.0.0
    const zip2 = new JSZip();
    zip2.file('manifest.json', JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '2.0.0',
      entry: 'index.js',
    }));
    const zipBuffer2 = await zip2.generateAsync({ type: 'nodebuffer' });

    // First call = registry fetch, second = download
    let callCount = 0;
    mockGet.mockImplementation((url: string, callback: (res: unknown) => void) => {
      callCount++;
      const req = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
      process.nextTick(() => {
        const data = callCount === 1 ? JSON.stringify(updatedRegistry) : zipBuffer2;
        const res = {
          statusCode: 200,
          headers: {},
          on: (event: string, handler: unknown) => {
            if (event === 'data') (handler as (chunk: Buffer) => void)(Buffer.from(data));
            if (event === 'end') (handler as () => void)();
          },
        };
        callback(res);
      });
      return req;
    });

    const result = await marketService.update('test-plugin');
    expect(result).not.toBeNull();
    expect(result?.version).toBe('2.0.0');
  });
});
