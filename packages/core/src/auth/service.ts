import type { User } from '@maverick-claw/shared';
import { logger } from '../utils/logger.js';
import { ADMIN_SCOPE } from './scopes.js';
import { TokenManager, type TokenResult } from './token.js';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: User;
  scopes: string[];
}

export class AuthService {
  constructor(
    private userService: UserService,
    private roleService: RoleService,
    private tokenManager: TokenManager
  ) {}

  async login(email: string, password: string, deviceId?: string): Promise<LoginResult | null> {
    const user = await this.userService.getUserByEmail(email);
    if (!user) {
      logger.warn({ email }, 'Login failed: user not found');
      return null;
    }

    if (user.status === 'inactive') {
      logger.warn({ email, userId: user.id }, 'Login failed: user inactive');
      return null;
    }

    const valid = await this.userService.validatePassword(user.id, password);
    if (!valid) {
      logger.warn({ email, userId: user.id }, 'Login failed: invalid password');
      return null;
    }

    // Resolve scopes from role
    let scopes: string[] = [];
    if (user.roleId) {
      const role = await this.roleService.getRole(user.roleId);
      if (role) {
        scopes = role.scopes;
      }
    }
    if (scopes.length === 0) {
      scopes = [ADMIN_SCOPE]; // fallback
    }

    const result = this.tokenManager.createToken(user.id, deviceId || 'web-client', {
      scopes,
      ttlHours: 24 * 7,
    });

    logger.info({ userId: user.id, email }, 'User logged in');

    return {
      token: result.token,
      expiresAt: result.expiresAt,
      user,
      scopes: result.scopes,
    };
  }

  async logout(token: string): Promise<void> {
    this.tokenManager.revokeToken(token);
    logger.info('User logged out');
  }

  async getCurrentUser(token: string): Promise<User | null> {
    const payload = this.tokenManager.validateToken(token);
    if (!payload) return null;
    return this.userService.getUser(payload.userId);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    const valid = await this.userService.validatePassword(userId, oldPassword);
    if (!valid) {
      logger.warn({ userId }, 'Password change failed: invalid old password');
      return false;
    }

    await this.userService.updatePassword(userId, newPassword);
    // Revoke all existing tokens for this user to force re-login
    this.tokenManager.revokeUserTokens(userId);
    logger.info({ userId }, 'Password changed, all tokens revoked');
    return true;
  }
}
