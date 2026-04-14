import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGatewayServer } from '../gateway/server.js';
import { ConfigManager } from '../config/manager.js';
import { initDatabase } from '../storage/db.js';
import type { GatewayServer } from '../gateway/server.js';
import type { DatabaseManager } from '../storage/db.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';

describe('Integration Tests', () => {
  let server: GatewayServer;
  let dbManager: DatabaseManager;
  let configManager: ConfigManager;
  let tempDir: string;
  let port: number;
  let baseUrl: string;

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
    baseUrl = `http://127.0.0.1:${port}`;

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-integration-'));
    dbManager = await initDatabase({ dbPath: path.join(tempDir, 'integration.db') });
    
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
    await server.stop();
    await dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should have started server', () => {
    expect(server).toBeDefined();
  });

  it('should return health status', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.version).toBeDefined();
  });

  it('should return x-request-id header for traceability', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const requestId = response.headers.get('x-request-id');

    expect(response.status).toBe(200);
    expect(requestId).toBeTruthy();
    expect((requestId || '').length).toBeGreaterThan(0);
  });

  it('should return API status', async () => {
    const response = await fetch(`${baseUrl}/api/status`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.config).toBeDefined();
    expect(data.config.models).toBeDefined();
  });

  it('should return channel contracts', async () => {
    const response = await fetch(`${baseUrl}/api/channels/contracts`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.contracts)).toBe(true);
    expect(data.contracts.some((item: { type: string }) => item.type === 'webhook')).toBe(true);
  });

  it('should return provider capability matrix', async () => {
    const response = await fetch(`${baseUrl}/api/models/capabilities`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(
      data.providers.some(
        (item: { providerId: string; parameterSupport?: { temperature?: { default?: number } } }) =>
          item.providerId === 'deepseek' &&
          typeof item.parameterSupport?.temperature?.default === 'number'
      )
    ).toBe(true);
  });

  it('should expose prometheus metrics', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(text).toContain('maverick_claw_http_requests_total');
    expect(text).toContain('maverick_claw_http_request_duration_seconds');
    expect(text).toContain('maverick_claw_ws_connected_clients');
  });

  it('should apply default model to new sessions', async () => {
    await configManager.addModel({
      id: 'integration-default-model',
      name: 'Integration Default Model',
      provider: 'deepseek',
      enabled: true,
    });

    const modelsResponse = await fetch(`${baseUrl}/api/models`);
    expect(modelsResponse.status).toBe(200);
    const modelsPayload = await modelsResponse.json();
    expect(modelsPayload.defaultModel).toBe('deepseek:integration-default-model');

    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Default Model Session' }),
    });
    expect(createResponse.status).toBe(201);

    const session = await createResponse.json();
    expect(session.modelId).toBe('deepseek:integration-default-model');
  });

  it('should create and retrieve session', async () => {
    // Create session
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Session' }),
    });
    
    expect(createResponse.status).toBe(201);
    const session = await createResponse.json();
    expect(session.id).toBeDefined();
    expect(session.title).toBe('Test Session');

    // Get session
    const getResponse = await fetch(`${baseUrl}/api/sessions/${session.id}`);
    expect(getResponse.status).toBe(200);
    
    const retrieved = await getResponse.json();
    expect(retrieved.id).toBe(session.id);
  });

  it('should add message to session', async () => {
    // Create session first
    const sessionResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Message Test' }),
    });
    const session = await sessionResponse.json();

    // Add message
    const messageResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello World' }),
    });
    
    expect(messageResponse.status).toBe(201);
    const message = await messageResponse.json();
    expect(message.content).toBe('Hello World');
    expect(message.role).toBe('user');

    // List messages
    const listResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/messages`);
    const { messages } = await listResponse.json();
    
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello World');
  });

  it('should return 404 for non-existent session', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/non-existent-id`);
    expect(response.status).toBe(404);
  });

  it('should reject invalid session data', async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 123 }), // Invalid type
    });
    
    expect(response.status).toBe(400);
  });
});
