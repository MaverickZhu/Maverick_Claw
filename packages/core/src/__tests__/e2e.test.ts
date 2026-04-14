import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGatewayServer } from '../gateway/server.js';
import { ConfigManager } from '../config/manager.js';
import { initDatabase } from '../storage/db.js';
import type { GatewayServer } from '../gateway/server.js';
import type { DatabaseManager } from '../storage/db.js';
import WebSocket from 'ws';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';

/**
 * End-to-End Tests
 * 
 * These tests verify the complete system workflow:
 * 1. Gateway startup
 * 2. WebSocket connection
 * 3. Session creation
 * 4. Message exchange
 */
describe('E2E Tests', () => {
  let server: GatewayServer;
  let dbManager: DatabaseManager;
  let configManager: ConfigManager;
  let ws: WebSocket;
  let tempDir: string;
  let port: number;

  beforeAll(async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => resolve());
    });
    port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      probe.close((err) => (err ? reject(err) : resolve()));
    });

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-e2e-'));

    // Setup
    dbManager = await initDatabase({ dbPath: path.join(tempDir, 'e2e.db') });
    configManager = new ConfigManager({
      configPath: path.join(tempDir, 'config.json5'),
      enableHotReload: false,
    });
    await configManager.load();

    server = createGatewayServer({
      port,
      host: '127.0.0.1',
      configManager,
      dbManager,
    });

    await server.start();
  });

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    await server.stop();
    await dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should connect via WebSocket', async () => {
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('should handle WebSocket handshake', async () => {
    const responsePromise = new Promise<{ type: string; ok: boolean }>((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    ws.send(JSON.stringify({
      type: 'connect',
      id: 'test-1',
      params: {
        clientType: 'node',
        clientVersion: '1.0.0',
        deviceId: 'test-device',
      },
    }));

    const response = await responsePromise;
    expect(response.type).toBe('connect');
    expect(response.ok).toBe(true);
  });

  it('should create session via WebSocket', async () => {
    const responsePromise = new Promise<{ type: string; ok: boolean }>((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    ws.send(JSON.stringify({
      type: 'req',
      id: 'req-1',
      method: 'sessions.create',
      params: { title: 'E2E Test Session' },
    }));

    const response = await responsePromise;
    expect(response.type).toBe('res');
    expect(response.ok).toBe(true);
    expect((response as { payload?: { session?: { id?: string } } }).payload?.session?.id).toBeDefined();
  });

  it('should handle health check', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.services.gateway).toBe(true);
  });

  it('should handle full REST API flow', async () => {
    // Create session
    const sessionRes = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'API Test' }),
    });
    const session = await sessionRes.json();
    expect(session.id).toBeDefined();

    // Add message
    const msgRes = await fetch(`http://127.0.0.1:${port}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Test message' }),
    });
    expect(msgRes.status).toBe(201);

    // Get messages
    const listRes = await fetch(`http://127.0.0.1:${port}/api/sessions/${session.id}/messages`);
    const { messages } = await listRes.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Test message');

    // Delete session
    const deleteRes = await fetch(`http://127.0.0.1:${port}/api/sessions/${session.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);
  });
});
