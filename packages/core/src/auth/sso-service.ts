import type { GatewayConfig } from '@maverick-claw/shared';
import type { OAuthService } from './oauth-service.js';
import type { LDAPService } from './ldap-service.js';

export class SSOService {
  constructor(
    private oauthService: OAuthService,
    private ldapService: LDAPService
  ) {}

  /**
   * Get available authentication methods based on config
   */
  getAuthMethods(config: GatewayConfig): {
    local: boolean;
    oauth: Array<{ id: string; name: string; type: string }>;
    ldap: boolean;
  } {
    const local = config.auth.type === 'token' || config.auth.type === 'none';
    const oauth = config.auth.oauth
      ? this.oauthService.getProviders(config.auth.oauth.providers)
      : [];
    const ldap = config.auth.ldap?.enabled ?? false;

    return { local, oauth, ldap };
  }
}
