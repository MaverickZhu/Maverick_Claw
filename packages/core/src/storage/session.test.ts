import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseManager } from './db.js';
import { SessionManager } from './session.js';

describe('SessionManager', () => {
  let dbManager: DatabaseManager;
  let sessionManager: SessionManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-session-manager-'));
    dbManager = new DatabaseManager({ dbPath: path.join(tempDir, 'data.db') });
    await dbManager.init();

    sessionManager = new SessionManager(dbManager);
  });

  afterEach(async () => {
    await dbManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should list sessions with aggregated message counts', async () => {
    const sessionA = await sessionManager.createSession({ title: 'session-a' });
    const sessionB = await sessionManager.createSession({ title: 'session-b' });

    await sessionManager.createMessage({
      sessionId: sessionA.id,
      role: 'user',
      content: 'a-1',
    });
    await sessionManager.createMessage({
      sessionId: sessionA.id,
      role: 'assistant',
      content: 'a-2',
    });
    await sessionManager.createMessage({
      sessionId: sessionB.id,
      role: 'user',
      content: 'b-1',
    });

    const sessions = await sessionManager.listSessionsWithMessageCount({ limit: 10 });
    const countById = new Map(sessions.map((session) => [session.id, session.messageCount]));

    expect(countById.get(sessionA.id)).toBe(2);
    expect(countById.get(sessionB.id)).toBe(1);
  });

  it('should return a single session with message count', async () => {
    const session = await sessionManager.createSession({ title: 'single' });
    await sessionManager.createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'hello',
    });

    const hydrated = await sessionManager.getSessionWithMessageCount(session.id);

    expect(hydrated).not.toBeNull();
    expect(hydrated?.id).toBe(session.id);
    expect(hydrated?.messageCount).toBe(1);
    expect(await sessionManager.getSessionWithMessageCount('missing-session')).toBeNull();
  });
});
