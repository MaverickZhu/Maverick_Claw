import { v4 as uuidv4 } from 'uuid';
import type { SessionManager } from '../storage/session.js';
import { logger } from '../utils/logger.js';

export interface ChannelSessionMapping {
  channelId: string;
  channelUserId: string;
  sessionId: string;
  createdAt: Date;
  lastActivityAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ChannelSessionOptions {
  sessionManager: SessionManager;
  defaultModelId?: string;
  sessionTimeoutMs?: number;
}

/**
 * Manages mapping between external channel users and internal sessions
 */
export class ChannelSessionManager {
  private mappings = new Map<string, ChannelSessionMapping>();
  private sessionManager: SessionManager;
  private defaultModelId: string;
  private sessionTimeoutMs: number;

  constructor(options: ChannelSessionOptions) {
    this.sessionManager = options.sessionManager;
    this.defaultModelId = options.defaultModelId || 'deepseek:deepseek-chat';
    this.sessionTimeoutMs = options.sessionTimeoutMs || 24 * 60 * 60 * 1000; // 24 hours
  }

  private getMappingKey(channelId: string, channelUserId: string): string {
    return `${channelId}:${channelUserId}`;
  }

  /**
   * Get or create a session for a channel user
   */
  async getOrCreateSession(
    channelId: string,
    channelUserId: string,
    userName?: string
  ): Promise<{ sessionId: string; isNew: boolean }> {
    const key = this.getMappingKey(channelId, channelUserId);
    const existing = this.mappings.get(key);

    // Check if existing session is still valid
    if (existing) {
      const now = new Date();
      const lastActivity = new Date(existing.lastActivityAt);
      const elapsed = now.getTime() - lastActivity.getTime();

      if (elapsed < this.sessionTimeoutMs) {
        // Update activity timestamp
        existing.lastActivityAt = now;
        this.mappings.set(key, existing);
        
        // Also update session in database
        await this.sessionManager.getSession(existing.sessionId);
        
        return { sessionId: existing.sessionId, isNew: false };
      } else {
        // Session expired, remove it
        this.mappings.delete(key);
        logger.info({ channelId, channelUserId, sessionId: existing.sessionId }, 'Session expired');
      }
    }

    // Create new session
    const session = await this.sessionManager.createSession({
      title: userName ? `Chat with ${userName}` : `Channel: ${channelId}`,
      modelId: this.defaultModelId,
      metadata: {
        source: 'channel',
        channelId,
        channelUserId,
        userName,
      },
    });

    // Store mapping
    const mapping: ChannelSessionMapping = {
      channelId,
      channelUserId,
      sessionId: session.id,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {
        userName,
      },
    };

    this.mappings.set(key, mapping);
    logger.info({ channelId, channelUserId, sessionId: session.id }, 'Created new channel session');

    return { sessionId: session.id, isNew: true };
  }

  /**
   * Get existing session without creating
   */
  getExistingSession(channelId: string, channelUserId: string): string | null {
    const key = this.getMappingKey(channelId, channelUserId);
    const mapping = this.mappings.get(key);
    
    if (!mapping) return null;

    // Check expiration
    const now = new Date();
    const lastActivity = new Date(mapping.lastActivityAt);
    const elapsed = now.getTime() - lastActivity.getTime();

    if (elapsed >= this.sessionTimeoutMs) {
      this.mappings.delete(key);
      return null;
    }

    return mapping.sessionId;
  }

  /**
   * Update last activity timestamp
   */
  touchSession(channelId: string, channelUserId: string): void {
    const key = this.getMappingKey(channelId, channelUserId);
    const mapping = this.mappings.get(key);
    
    if (mapping) {
      mapping.lastActivityAt = new Date();
      this.mappings.set(key, mapping);
    }
  }

  /**
   * End a session manually
   */
  async endSession(channelId: string, channelUserId: string): Promise<boolean> {
    const key = this.getMappingKey(channelId, channelUserId);
    const mapping = this.mappings.get(key);

    if (mapping) {
      this.mappings.delete(key);
      logger.info({ channelId, channelUserId, sessionId: mapping.sessionId }, 'Session ended');
      return true;
    }

    return false;
  }

  /**
   * Get all active sessions for a channel
   */
  getChannelSessions(channelId: string): ChannelSessionMapping[] {
    const sessions: ChannelSessionMapping[] = [];
    
    for (const mapping of this.mappings.values()) {
      if (mapping.channelId === channelId) {
        sessions.push(mapping);
      }
    }

    return sessions;
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [key, mapping] of this.mappings.entries()) {
      const lastActivity = new Date(mapping.lastActivityAt);
      const elapsed = now.getTime() - lastActivity.getTime();

      if (elapsed >= this.sessionTimeoutMs) {
        this.mappings.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up expired channel sessions');
    }

    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; byChannel: Record<string, number> } {
    const byChannel: Record<string, number> = {};

    for (const mapping of this.mappings.values()) {
      byChannel[mapping.channelId] = (byChannel[mapping.channelId] || 0) + 1;
    }

    return {
      total: this.mappings.size,
      byChannel,
    };
  }
}

// Singleton instance
let globalManager: ChannelSessionManager | null = null;

export function getChannelSessionManager(options?: ChannelSessionOptions): ChannelSessionManager {
  if (!globalManager && options) {
    globalManager = new ChannelSessionManager(options);
  }
  return globalManager!;
}

export function resetChannelSessionManager(): void {
  globalManager = null;
}
