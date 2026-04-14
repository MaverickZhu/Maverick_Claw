import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { ADMIN_SCOPE, USER_DEFAULT_SCOPES } from './scopes.js';

// Token configuration
const TOKEN_PREFIX = 'mc_';
const TOKEN_BYTES = 32;

export interface TokenPayload {
  userId: string;
  deviceId: string;
  scopes: string[];
  iat: number;
  exp: number;
}

export interface TokenResult {
  token: string;
  expiresAt: Date;
  scopes: string[];
}

export interface CreateTokenOptions {
  ttlHours?: number;
  scopes?: string[];
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  const randomBytes = crypto.randomBytes(TOKEN_BYTES);
  return TOKEN_PREFIX + randomBytes.toString('base64url');
}

/**
 * Hash a token for storage (SHA-256)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify if a token matches its hash
 */
export function verifyToken(token: string, hash: string): boolean {
  const computedHash = hashToken(token);
  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(hash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Token manager for session management
 */
export class TokenManager {
  private tokens = new Map<string, TokenPayload>(); // token -> payload
  private revokedTokens = new Set<string>(); // hashed tokens

  /**
   * Create a new token
   */
  createToken(userId: string, deviceId: string, options: number | CreateTokenOptions = 24 * 7): TokenResult {
    const normalizedOptions: CreateTokenOptions =
      typeof options === 'number' ? { ttlHours: options } : options;

    const ttlHours = normalizedOptions.ttlHours ?? 24 * 7;
    const scopes = normalizedOptions.scopes?.length
      ? [...normalizedOptions.scopes]
      : [...USER_DEFAULT_SCOPES];

    const token = generateToken();
    const now = Date.now();
    const exp = now + ttlHours * 60 * 60 * 1000;

    const payload: TokenPayload = {
      userId,
      deviceId,
      scopes,
      iat: now,
      exp,
    };

    this.tokens.set(token, payload);
    logger.debug(`Created token for user: ${userId}, device: ${deviceId}`);

    return {
      token,
      expiresAt: new Date(exp),
      scopes,
    };
  }

  /**
   * Validate a token
   */
  validateToken(token: string): TokenPayload | null {
    // Check if revoked
    if (this.revokedTokens.has(hashToken(token))) {
      return null;
    }

    const payload = this.tokens.get(token);
    if (!payload) {
      return null;
    }

    // Check expiration
    if (Date.now() > payload.exp) {
      this.tokens.delete(token);
      return null;
    }

    // Backward compatibility for tokens created before scopes field existed.
    if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) {
      payload.scopes = [ADMIN_SCOPE];
      this.tokens.set(token, payload);
    }

    return payload;
  }

  /**
   * Backward-compatible alias for validateToken.
   */
  verifyToken(token: string): TokenPayload | null {
    return this.validateToken(token);
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): void {
    this.tokens.delete(token);
    this.revokedTokens.add(hashToken(token));
    logger.debug('Token revoked');
  }

  /**
   * Revoke all tokens for a user
   */
  revokeUserTokens(userId: string): void {
    for (const [token, payload] of this.tokens.entries()) {
      if (payload.userId === userId) {
        this.revokeToken(token);
      }
    }
    logger.debug(`Revoked all tokens for user: ${userId}`);
  }

  /**
   * Clean up expired tokens
   */
  cleanup(): number {
    const now = Date.now();
    let count = 0;
    for (const [token, payload] of this.tokens.entries()) {
      if (payload.exp < now) {
        this.tokens.delete(token);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`Cleaned up ${count} expired tokens`);
    }
    return count;
  }
}

// Singleton
let globalTokenManager: TokenManager | null = null;

export function getTokenManager(): TokenManager {
  if (!globalTokenManager) {
    globalTokenManager = new TokenManager();
  }
  return globalTokenManager;
}
