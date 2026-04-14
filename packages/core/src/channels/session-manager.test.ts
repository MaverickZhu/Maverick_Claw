import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelSessionManager, getChannelSessionManager, resetChannelSessionManager } from './session-manager.js';
import type { SessionManager } from '../storage/session.js';

// Mock SessionManager
const createMockSessionManager = (): SessionManager => ({
  createSession: vi.fn().mockResolvedValue({ id: 'session-123', title: 'Test' }),
  getSession: vi.fn().mockResolvedValue({ id: 'session-123' }),
  listSessions: vi.fn().mockResolvedValue([]),
  updateSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  createMessage: vi.fn().mockResolvedValue({ id: 'msg-123' }),
  getMessage: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  getMessageCount: vi.fn().mockResolvedValue(0),
} as unknown as SessionManager);

describe('ChannelSessionManager', () => {
  let sessionManager: SessionManager;
  let manager: ChannelSessionManager;

  beforeEach(() => {
    sessionManager = createMockSessionManager();
    manager = new ChannelSessionManager({
      sessionManager,
      defaultModelId: 'deepseek:deepseek-chat',
      sessionTimeoutMs: 1000, // 1 second for testing
    });
  });

  it('should create new session for new user', async () => {
    const { sessionId, isNew } = await manager.getOrCreateSession('channel-1', 'user-1', 'Test User');
    
    expect(isNew).toBe(true);
    expect(sessionId).toBe('session-123');
    expect(sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Chat with Test User',
      modelId: 'deepseek:deepseek-chat',
    }));
  });

  it('should return existing session for same user', async () => {
    // First call creates session
    await manager.getOrCreateSession('channel-1', 'user-1');
    
    // Second call should return existing
    const { sessionId, isNew } = await manager.getOrCreateSession('channel-1', 'user-1');
    
    expect(isNew).toBe(false);
    expect(sessionId).toBe('session-123');
  });

  it('should create different sessions for different users', async () => {
    const result1 = await manager.getOrCreateSession('channel-1', 'user-1');
    const result2 = await manager.getOrCreateSession('channel-1', 'user-2');
    
    expect(result1.isNew).toBe(true);
    expect(result2.isNew).toBe(true);
    expect(sessionManager.createSession).toHaveBeenCalledTimes(2);
  });

  it('should expire session after timeout', async () => {
    // Create session
    await manager.getOrCreateSession('channel-1', 'user-1');
    
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Should create new session
    const { isNew } = await manager.getOrCreateSession('channel-1', 'user-1');
    expect(isNew).toBe(true);
  });

  it('should end session manually', async () => {
    await manager.getOrCreateSession('channel-1', 'user-1');
    
    const ended = await manager.endSession('channel-1', 'user-1');
    expect(ended).toBe(true);
    
    // Should create new session next time
    const { isNew } = await manager.getOrCreateSession('channel-1', 'user-1');
    expect(isNew).toBe(true);
  });

  it('should return false when ending non-existent session', async () => {
    const ended = await manager.endSession('channel-1', 'non-existent');
    expect(ended).toBe(false);
  });

  it('should get existing session without creating', async () => {
    // Create session first
    await manager.getOrCreateSession('channel-1', 'user-1');
    
    // Get existing
    const sessionId = manager.getExistingSession('channel-1', 'user-1');
    expect(sessionId).toBe('session-123');
    
    // Non-existent returns null
    const nonExistent = manager.getExistingSession('channel-1', 'user-2');
    expect(nonExistent).toBeNull();
  });

  it('should get channel sessions', async () => {
    await manager.getOrCreateSession('channel-1', 'user-1');
    await manager.getOrCreateSession('channel-1', 'user-2');
    await manager.getOrCreateSession('channel-2', 'user-3');
    
    const sessions = manager.getChannelSessions('channel-1');
    expect(sessions).toHaveLength(2);
  });

  it('should cleanup expired sessions', async () => {
    await manager.getOrCreateSession('channel-1', 'user-1');
    
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    const cleaned = manager.cleanup();
    expect(cleaned).toBe(1);
    
    const stats = manager.getStats();
    expect(stats.total).toBe(0);
  });

  it('should get stats', async () => {
    await manager.getOrCreateSession('channel-1', 'user-1');
    await manager.getOrCreateSession('channel-1', 'user-2');
    await manager.getOrCreateSession('channel-2', 'user-3');
    
    const stats = manager.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byChannel['channel-1']).toBe(2);
    expect(stats.byChannel['channel-2']).toBe(1);
  });
});

describe('Global ChannelSessionManager', () => {
  beforeEach(() => {
    resetChannelSessionManager();
  });

  it('should return singleton instance', () => {
    const manager1 = getChannelSessionManager({ sessionManager: createMockSessionManager() });
    const manager2 = getChannelSessionManager();
    
    expect(manager1).toBe(manager2);
  });
});
