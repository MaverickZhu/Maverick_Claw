import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { ADMIN_SCOPE, USER_DEFAULT_SCOPES } from './scopes.js';
import type { DatabaseManager } from '../storage/db.js';

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

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  scopes: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

/**
 * Token manager for session management.
 * Supports both in-memory (backward-compatible) and DB-backed modes.
 */
export class TokenManager {
  private tokens = new Map<string, TokenPayload>(); // token -> payload (memory mode)
  private revokedTokens = new Set<string>(); // hashed tokens (memory mode)

  constructor(private dbManager?: DatabaseManager) {}

  private get db() {
    return this.dbManager?.getDb();
  }

  private isDbEnabled(): boolean {
    return !!this.db;
  }

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

    if (this.isDbEnabled()) {
      const tokenHash = hashToken(token);
      this.db!.prepare(
        `INSERT INTO tokens (id, user_id, token_hash, device_id, scopes, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uuidv4(),
        userId,
        tokenHash,
        deviceId || null,
        JSON.stringify(scopes),
        Math.floor(exp / 1000),
        Math.floor(now / 1000)
      );
    } else {
      const payload: TokenPayload = {
        userId,
        deviceId,
        scopes,
        iat: now,
        exp,
      };
      this.tokens.set(token, payload);
    }

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
    if (this.isDbEnabled()) {
      const tokenHash = hashToken(token);
      const row = this.db!.prepare(
        `SELECT * FROM tokens WHERE token_hash = ? AND revoked_at IS NULL`
      ).get(tokenHash) as TokenRow | undefined;

      if (!row) return null;

      // Check expiration
      if (Date.now() > row.expires_at * 1000) {
        return null;
      }

      const scopes = JSON.parse(row.scopes);
      // Backward compatibility
      if (!Array.isArray(scopes) || scopes.length === 0) {
        scopes.push(ADMIN_SCOPE);
      }

      return {
        userId: row.user_id,
        deviceId: row.device_id || '',
        scopes,
        iat: row.created_at * 1000,
        exp: row.expires_at * 1000,
      };
    }

    // Memory mode
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
    if (this.isDbEnabled()) {
      const tokenHash = hashToken(token);
      this.db!.prepare(
        `UPDATE tokens SET revoked_at = ? WHERE token_hash = ?`
      ).run(Math.floor(Date.now() / 1000), tokenHash);
    } else {
      this.tokens.delete(token);
      this.revokedTokens.add(hashToken(token));
    }
    logger.debug('Token revoked');
  }

  /**
   * Revoke all tokens for a user
   */
  revokeUserTokens(userId: string): void {
    if (this.isDbEnabled()) {
      this.db!.prepare(
        `UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
      ).run(Math.floor(Date.now() / 1000), userId);
    } else {
      for (const [token, payload] of this.tokens.entries()) {
        if (payload.userId === userId) {
          this.revokeToken(token);
        }
      }
    }
    logger.debug(`Revoked all tokens for user: ${userId}`);
  }

  /**
   * Clean up expired tokens
   */
  cleanup(): number {
    if (this.isDbEnabled()) {
      const result = this.db!.prepare(
        `DELETE FROM tokens WHERE expires_at < ?`
      ).run(Math.floor(Date.now() / 1000));
      const count = result.changes;
      if (count > 0) {
        logger.debug(`Cleaned up ${count} expired tokens`);
      }
      return count;
    }

    // Memory mode
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

export function getTokenManager(dbManager?: DatabaseManager): TokenManager {
  if (!globalTokenManager) {
    globalTokenManager = new TokenManager(dbManager);
  }
  return globalTokenManager;
}
