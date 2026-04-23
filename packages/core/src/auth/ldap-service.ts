import ldap from 'ldapjs';
import type { User } from '@maverick-claw/shared';
import { UserService } from './user-service.js';
import { RoleService } from './role-service.js';
import { TokenManager } from './token.js';
import { logger } from '../utils/logger.js';

export interface LDAPConfig {
  enabled: boolean;
  server: string;
  bindDN?: string;
  bindPassword?: string;
  baseDN: string;
  userFilter: string;
  groupFilter?: string;
  tls: boolean;
  tlsOptions?: Record<string, unknown>;
  groupRoleMapping?: Record<string, string>;
  defaultRoleId?: string;
}

export interface LDAPLoginResult {
  token: string;
  user: User;
}

export class LDAPService {
  constructor(
    private userService: UserService,
    private roleService: RoleService,
    private tokenManager: TokenManager
  ) {}

  /**
   * Authenticate via LDAP
   */
  async authenticate(username: string, password: string, config: LDAPConfig): Promise<LDAPLoginResult | null> {
    const client = ldap.createClient({
      url: config.server,
      tlsOptions: config.tls ? (config.tlsOptions as ldap.ClientOptions['tlsOptions']) : undefined,
    });

    try {
      // Step 1: Admin bind (if configured) to search for user
      let userDN: string | undefined;
      if (config.bindDN && config.bindPassword) {
        await this.bindAsync(client, config.bindDN, config.bindPassword);
        userDN = await this.findUserDN(client, username, config);
      } else {
        // Direct bind with constructed DN
        userDN = this.constructUserDN(username, config);
      }

      if (!userDN) {
        logger.warn({ username }, 'LDAP user not found');
        return null;
      }

      // Step 2: Bind as user to verify password
      try {
        await this.bindAsync(client, userDN, password);
      } catch {
        logger.warn({ username }, 'LDAP password verification failed');
        return null;
      }

      // Step 3: Get user attributes and groups
      const userAttrs = await this.getUserAttributes(client, userDN, config);
      const groups = await this.getUserGroups(client, userDN, username, config);

      // Step 4: Find or create local user
      const email = userAttrs.mail || `${username}@local`;
      const name = userAttrs.cn || userAttrs.displayName || username;
      const externalId = userDN;

      let user = await this.findUserByExternalId(externalId);
      if (!user && email) {
        user = await this.userService.getUserByEmail(email);
        if (user) {
          await this.userService.updateUser(user.id, {
            authProvider: 'ldap',
            externalId,
          });
        }
      }

      if (!user) {
        const roleId = await this.resolveRole(groups, config);
        user = await this.userService.createUser({
          name,
          email: email !== `${username}@local` ? email : undefined,
          password: crypto.randomUUID(), // random password for LDAP users
          roleId,
        });
        await this.userService.updateUser(user.id, {
          authProvider: 'ldap',
          externalId,
        });
        user = await this.userService.getUser(user.id);
        logger.info({ userId: user?.id, username }, 'Created user from LDAP login');
      }

      if (!user) {
        return null;
      }

      // Step 5: Generate token
      const role = user.roleId ? await this.roleService.getRole(user.roleId) : null;
      const scopes = role?.scopes || ['*'];
      const tokenResult = this.tokenManager.createToken(user.id, 'ldap-client', { scopes, ttlHours: 24 * 7 });

      logger.info({ userId: user.id, username }, 'LDAP login successful');

      return {
        token: tokenResult.token,
        user,
      };
    } catch (err) {
      logger.warn({ err, username }, 'LDAP authentication error');
      return null;
    } finally {
      client.unbind(() => {});
    }
  }

  private bindAsync(client: ldap.Client, dn: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.bind(dn, password, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private searchAsync(client: ldap.Client, base: string, options: ldap.SearchOptions): Promise<ldap.SearchEntry[]> {
    return new Promise((resolve, reject) => {
      const results: ldap.SearchEntry[] = [];
      client.search(base, options, (err, res) => {
        if (err) {
          reject(err);
          return;
        }
        res.on('searchEntry', (entry) => results.push(entry));
        res.on('error', (err) => reject(err));
        res.on('end', () => resolve(results));
      });
    });
  }

  private async findUserDN(client: ldap.Client, username: string, config: LDAPConfig): Promise<string | undefined> {
    const filter = config.userFilter.replace('{{username}}', username);
    const entries = await this.searchAsync(client, config.baseDN, {
      filter,
      scope: 'sub',
      attributes: ['dn'],
    });
    return entries[0]?.dn.toString();
  }

  private constructUserDN(username: string, config: LDAPConfig): string {
    // Simple uid-based DN construction
    return `uid=${username},${config.baseDN}`;
  }

  private async getUserAttributes(
    client: ldap.Client,
    userDN: string,
    _config: LDAPConfig
  ): Promise<Record<string, string>> {
    const entries = await this.searchAsync(client, userDN, {
      scope: 'base',
      attributes: ['cn', 'mail', 'displayName', 'givenName', 'sn'],
    });
    if (entries.length === 0) return {};
    const attrs: Record<string, string> = {};
    const pojo = entries[0].pojo;
    for (const attr of pojo.attributes) {
      const val = attr.values[0];
      if (typeof val === 'string') {
        attrs[attr.type] = val;
      }
    }
    return attrs;
  }

  private async getUserGroups(
    client: ldap.Client,
    userDN: string,
    username: string,
    config: LDAPConfig
  ): Promise<string[]> {
    if (!config.groupFilter) return [];

    const filter = config.groupFilter
      .replace('{{userDN}}', userDN)
      .replace('{{username}}', username);

    try {
      const entries = await this.searchAsync(client, config.baseDN, {
        filter,
        scope: 'sub',
        attributes: ['dn', 'cn'],
      });
      return entries.map((e) => e.dn.toString());
    } catch {
      return [];
    }
  }

  private async findUserByExternalId(externalId: string): Promise<User | null> {
    const rows = this.userService['dbManager'].getDb().prepare(
      "SELECT id FROM users WHERE auth_provider = 'ldap' AND external_id = ?"
    ).all(externalId) as Array<{ id: string }>;
    if (rows.length === 0) return null;
    return this.userService.getUser(rows[0].id);
  }

  private async resolveRole(groups: string[], config: LDAPConfig): Promise<string | undefined> {
    if (!config.groupRoleMapping) {
      return config.defaultRoleId;
    }
    for (const group of groups) {
      const roleId = config.groupRoleMapping[group];
      if (roleId) return roleId;
    }
    return config.defaultRoleId;
  }
}
