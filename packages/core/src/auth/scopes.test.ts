import { describe, expect, it } from 'vitest';
import { ADMIN_SCOPE, Scope, USER_DEFAULT_SCOPES, hasAllScopes, hasAnyScope, hasScope } from './scopes.js';

describe('scope helpers', () => {
  it('should grant all scopes for admin token', () => {
    const scopes = [ADMIN_SCOPE];
    expect(hasScope(scopes, Scope.ConfigWrite)).toBe(true);
    expect(hasAllScopes(scopes, [Scope.QueueRead, Scope.QueueWrite])).toBe(true);
  });

  it('should validate user default scopes', () => {
    expect(hasScope(USER_DEFAULT_SCOPES, Scope.ChatStream)).toBe(true);
    expect(hasScope(USER_DEFAULT_SCOPES, Scope.ConfigWrite)).toBe(false);
  });

  it('should validate all/any checks correctly', () => {
    const scopes = [Scope.SessionsRead, Scope.ChatStream];
    expect(hasAllScopes(scopes, [Scope.SessionsRead, Scope.ChatStream])).toBe(true);
    expect(hasAllScopes(scopes, [Scope.SessionsRead, Scope.WorkflowRun])).toBe(false);
    expect(hasAnyScope(scopes, [Scope.WorkflowRun, Scope.ChatStream])).toBe(true);
  });
});
