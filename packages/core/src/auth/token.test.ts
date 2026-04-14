import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager, generateToken, hashToken, verifyToken } from './token.js';

describe('TokenManager', () => {
  let manager: TokenManager;

  beforeEach(() => {
    manager = new TokenManager();
  });

  it('should create and verify token', () => {
    const result = manager.createToken('user-123', 'test-device');
    
    expect(result.token).toBeDefined();
    expect(result.token).toMatch(/^mc_[a-zA-Z0-9_-]{32,}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);

    const verified = manager.validateToken(result.token);
    expect(verified).toBeDefined();
    expect(verified?.userId).toBe('user-123');
    expect(verified?.deviceId).toBe('test-device');
  });

  it('should return null for invalid token', () => {
    const result = manager.validateToken('invalid-token');
    expect(result).toBeNull();
  });

  it('should revoke token', () => {
    const { token } = manager.createToken('user-123', 'test-device');
    
    expect(manager.validateToken(token)).toBeDefined();
    
    manager.revokeToken(token);
    
    expect(manager.validateToken(token)).toBeNull();
  });

  it('should cleanup expired tokens', () => {
    // Create token that's already expired
    const { token } = manager.createToken('user-123', 'test-device', -1);

    const cleaned = manager.cleanup();
    expect(cleaned).toBeGreaterThanOrEqual(0);
    expect(manager.validateToken(token)).toBeNull();
  });
});

describe('Token utilities', () => {
  it('should generate unique tokens', () => {
    const token1 = generateToken();
    const token2 = generateToken();
    
    expect(token1).not.toBe(token2);
    expect(token1).toMatch(/^mc_[a-zA-Z0-9_-]{32,}$/);
  });

  it('should hash token consistently', () => {
    const token = 'test-token-123';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(token);
  });

  it('should verify token signature', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
    
    expect(verifyToken('invalid', hash)).toBe(false);
    expect(verifyToken(token, hashToken('mc_short'))).toBe(false);
  });
});
