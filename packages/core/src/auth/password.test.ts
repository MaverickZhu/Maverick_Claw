import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('Password utilities', () => {
  it('should hash password with PBKDF2 format', async () => {
    const hash = await hashPassword('my-secret');
    expect(hash).toMatch(/^pbkdf2\$[a-f0-9]+\$[a-f0-9]+$/);
  });

  it('should verify correct password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const valid = await verifyPassword('correct-horse-battery-staple', hash);
    expect(valid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await hashPassword('correct-password');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });

  it('should reject invalid hash format', async () => {
    const valid = await verifyPassword('password', 'invalid$hash');
    expect(valid).toBe(false);
  });

  it('should generate different hashes for same password', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
    // Both should verify
    expect(await verifyPassword('same-password', hash1)).toBe(true);
    expect(await verifyPassword('same-password', hash2)).toBe(true);
  });
});
