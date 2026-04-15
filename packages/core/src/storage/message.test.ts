import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseManager } from './db.js';
import { SessionManager } from './session.js';
import { MessageManager } from './message.js';

describe('MessageManager', () => {
  let dbManager: DatabaseManager;
  let sessionManager: SessionManager;
  let messageManager: MessageManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-message-manager-'));
    dbManager = new DatabaseManager({ dbPath: path.join(tempDir, 'data.db') });
    await dbManager.init();

    sessionManager = new SessionManager(dbManager);
    messageManager = new MessageManager(dbManager);
  });

  afterEach(async () => {
    await dbManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create and list session messages', async () => {
    const session = await sessionManager.createSession({ title: 'test-session' });

    await messageManager.createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'hello',
    });

    await messageManager.createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'world',
    });

    const messages = await messageManager.listMessages(session.id);
    const count = await messageManager.getMessageCount(session.id);

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('hello');
    expect(messages[1].content).toBe('world');
    expect(count).toBe(2);
  });

  it('should aggregate message counts for multiple sessions', async () => {
    const sessionA = await sessionManager.createSession({ title: 'session-a' });
    const sessionB = await sessionManager.createSession({ title: 'session-b' });
    const sessionC = await sessionManager.createSession({ title: 'session-c' });

    await messageManager.createMessage({
      sessionId: sessionA.id,
      role: 'user',
      content: 'a-1',
    });
    await messageManager.createMessage({
      sessionId: sessionA.id,
      role: 'assistant',
      content: 'a-2',
    });
    await messageManager.createMessage({
      sessionId: sessionB.id,
      role: 'user',
      content: 'b-1',
    });

    const counts = await messageManager.getMessageCounts([
      sessionA.id,
      sessionB.id,
      sessionC.id,
      sessionA.id,
    ]);

    expect(counts[sessionA.id]).toBe(2);
    expect(counts[sessionB.id]).toBe(1);
    expect(counts[sessionC.id]).toBe(0);
  });
});
