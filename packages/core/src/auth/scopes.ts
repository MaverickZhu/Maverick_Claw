export const ADMIN_SCOPE = '*';

export const Scope = {
  SessionsRead: 'sessions:read',
  SessionsWrite: 'sessions:write',
  MessagesRead: 'messages:read',
  MessagesWrite: 'messages:write',
  ChatStream: 'chat:stream',
  WorkflowRead: 'workflow:read',
  WorkflowRun: 'workflow:run',
  ModelsRead: 'models:read',
  ChannelsRead: 'channels:read',
  ConfigRead: 'config:read',
  ConfigWrite: 'config:write',
  QueueRead: 'queue:read',
  QueueWrite: 'queue:write',
  PluginsRead: 'plugins:read',
  PluginsWrite: 'plugins:write',
} as const;

export type ScopeValue = (typeof Scope)[keyof typeof Scope];

export const USER_DEFAULT_SCOPES: ScopeValue[] = [
  Scope.SessionsRead,
  Scope.SessionsWrite,
  Scope.MessagesRead,
  Scope.MessagesWrite,
  Scope.ChatStream,
  Scope.WorkflowRead,
  Scope.WorkflowRun,
  Scope.ModelsRead,
  Scope.ChannelsRead,
];

export function hasScope(scopes: readonly string[] | undefined, requiredScope: string): boolean {
  if (!scopes || scopes.length === 0) {
    return false;
  }

  return scopes.includes(ADMIN_SCOPE) || scopes.includes(requiredScope);
}

export function hasAllScopes(scopes: readonly string[] | undefined, requiredScopes: readonly string[]): boolean {
  return requiredScopes.every((scope) => hasScope(scopes, scope));
}

export function hasAnyScope(scopes: readonly string[] | undefined, requiredScopes: readonly string[]): boolean {
  return requiredScopes.some((scope) => hasScope(scopes, scope));
}
