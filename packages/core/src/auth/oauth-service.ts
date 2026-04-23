import crypto from 'crypto';
import { Issuer, type BaseClient, type TokenSet, generators } from 'openid-client';
import type { User } from '@maverick-claw/shared';
import type { DatabaseManager } from '../storage/db.js';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';
import { TokenManager } from './token.js';
import { logger } from '../utils/logger.js';

export interface OAuthProviderConfig {
  id: string;
  name: string;
  type: 'oidc' | 'oauth2';
  clientId: string;
  clientSecret: string;
  issuerUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  redirectUri: string;
  scopes: string[];
  enabled: boolean;
  roleMapping?: Record<string, string>;
}

export interface OAuthLoginResult {
  token: string;
  user: User;
  isNewUser: boolean;
}

interface UserinfoResponse {
  sub?: string;
  id?: string | number;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: unknown;
}

export class OAuthService {
  private clientCache = new Map<string, BaseClient>();

  constructor(
    private dbManager: DatabaseManager,
    private userService: UserService,
    private roleService: RoleService,
    private tokenManager: TokenManager
  ) {}

  private get db() {
    return this.dbManager.getDb();
  }

  /**
   * Get list of enabled providers (safe for public, no secrets)
   */
  getProviders(configs: OAuthProviderConfig[]): Array<{ id: string; name: string; type: string }> {
    return configs
      .filter((p) => p.enabled)
      .map((p) => ({ id: p.id, name: p.name, type: p.type }));
  }

  /**
   * Generate authorization URL and store state
   */
  async getAuthUrl(providerConfig: OAuthProviderConfig): Promise<string> {
    const client = await this.getClient(providerConfig);
    const state = generators.state();
    const nonce = generators.nonce();

    // Store state in DB
    this.db.prepare(
      'INSERT INTO oauth_states (state, provider_id, redirect_uri, created_at) VALUES (?, ?, ?, ?)'
    ).run(state, providerConfig.id, providerConfig.redirectUri, Math.floor(Date.now() / 1000));

    const authorizationUrl = client.authorizationUrl({
      state,
      nonce,
      scope: providerConfig.scopes.join(' '),
    });

    logger.debug({ provider: providerConfig.id }, 'Generated OAuth authorization URL');
    return authorizationUrl;
  }

  /**
   * Handle callback: exchange code for token, get userinfo, create/find user
   */
  async handleCallback(
    providerConfig: OAuthProviderConfig,
    code: string,
    state: string
  ): Promise<OAuthLoginResult | null> {
    // Verify state
    const stateRow = this.db.prepare(
      'SELECT * FROM oauth_states WHERE state = ? AND provider_id = ?'
    ).get(state, providerConfig.id) as { state: string; created_at: number } | undefined;

    if (!stateRow) {
      logger.warn({ provider: providerConfig.id }, 'Invalid or expired OAuth state');
      return null;
    }

    // Check expiration (10 minutes)
    if (Date.now() / 1000 - stateRow.created_at > 600) {
      logger.warn({ provider: providerConfig.id }, 'OAuth state expired');
      return null;
    }

    // Delete state (one-time use)
    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

    const client = await this.getClient(providerConfig);

    let tokenSet: TokenSet;
    try {
      tokenSet = await client.callback(providerConfig.redirectUri, { code, state });
    } catch (err) {
      logger.warn({ err, provider: providerConfig.id }, 'OAuth token exchange failed');
      return null;
    }

    // Get userinfo
    let userinfo: UserinfoResponse;
    try {
      userinfo = (await client.userinfo(tokenSet)) as UserinfoResponse;
    } catch (err) {
      logger.warn({ err, provider: providerConfig.id }, 'OAuth userinfo request failed');
      return null;
    }

    const externalId = String(userinfo.sub || userinfo.id || '');
    const email = userinfo.email || '';
    const name = userinfo.name || email.split('@')[0] || 'OAuth User';

    if (!externalId && !email) {
      logger.warn({ provider: providerConfig.id }, 'OAuth userinfo missing id and email');
      return null;
    }

    // Find or create user
    let user = externalId
      ? await this.findUserByExternalId(providerConfig.id, externalId)
      : null;
    if (!user && email) {
      user = await this.userService.getUserByEmail(email);
      if (user) {
        // Link existing user to this OAuth provider
        await this.userService.updateUser(user.id, {
          authProvider: 'oauth',
          externalId: `${providerConfig.id}:${externalId}`,
        });
      }
    }

    let isNewUser = false;
    if (!user) {
      // Create new user
      const roleId = await this.resolveRole(userinfo, providerConfig);
      user = await this.userService.createUser({
        name,
        email: email || undefined,
        password: crypto.randomBytes(32).toString('hex'), // random password for SSO users
        roleId,
      });
      await this.userService.updateUser(user.id, {
        authProvider: 'oauth',
        externalId: `${providerConfig.id}:${externalId}`,
      });
      user = await this.userService.getUser(user.id);
      isNewUser = true;
      logger.info({ userId: user?.id, provider: providerConfig.id }, 'Created user from OAuth login');
    }

    if (!user) {
      return null;
    }

    // Generate token
    const role = user.roleId ? await this.roleService.getRole(user.roleId) : null;
    const scopes = role?.scopes || ['*'];
    const tokenResult = this.tokenManager.createToken(user.id, 'oauth-client', { scopes, ttlHours: 24 * 7 });

    logger.info({ userId: user.id, provider: providerConfig.id }, 'OAuth login successful');

    return {
      token: tokenResult.token,
      user,
      isNewUser,
    };
  }

  /**
   * Clean up expired states
   */
  cleanupStates(): number {
    const result = this.db.prepare(
      'DELETE FROM oauth_states WHERE created_at < ?'
    ).run(Math.floor(Date.now() / 1000) - 600);
    return result.changes;
  }

  private async getClient(config: OAuthProviderConfig): Promise<BaseClient> {
    const cacheKey = `${config.id}:${config.clientId}`;
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    let client: BaseClient;

    if (config.type === 'oidc' && config.issuerUrl) {
      const issuer = await Issuer.discover(config.issuerUrl);
      client = new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        response_types: ['code'],
      });
    } else {
      // OAuth2 manual
      const manualIssuer = new Issuer({
        issuer: config.id,
        authorization_endpoint: config.authorizationUrl,
        token_endpoint: config.tokenUrl,
        userinfo_endpoint: config.userinfoUrl,
      });
      client = new manualIssuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        response_types: ['code'],
      });
    }

    this.clientCache.set(cacheKey, client);
    return client;
  }

  private async findUserByExternalId(providerId: string, externalId: string): Promise<User | null> {
    const rows = this.db.prepare(
      "SELECT id FROM users WHERE auth_provider = 'oauth' AND external_id = ?"
    ).all(`${providerId}:${externalId}`) as Array<{ id: string }>;
    if (rows.length === 0) return null;
    return this.userService.getUser(rows[0].id);
  }

  private async resolveRole(userinfo: UserinfoResponse, config: OAuthProviderConfig): Promise<string | undefined> {
    if (!config.roleMapping) return undefined;

    // Try to match from claims
    for (const [claimValue, roleId] of Object.entries(config.roleMapping)) {
      for (const [key, value] of Object.entries(userinfo)) {
        if (Array.isArray(value) && value.includes(claimValue)) {
          return roleId;
        }
        if (String(value) === claimValue) {
          return roleId;
        }
      }
    }
    return undefined;
  }
}
