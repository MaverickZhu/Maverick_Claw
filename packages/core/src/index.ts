// Maverick_Claw Core Gateway
export { createGatewayServer } from './gateway/server.js';
export type { GatewayServer, GatewayOptions } from './gateway/server.js';

// Environment configuration
export { loadEnvConfig, getRedisOptions, getDatabaseUrl, envConfig } from './config/env.js';
export type { EnvConfig } from './config/env.js';

export { ConfigManager } from './config/manager.js';
export type { ConfigManagerOptions, ConfigChangeCallback, ConfigChangeType } from './config/manager.js';

export { DatabaseManager, initDatabase, getDatabaseManager } from './storage/db.js';
export type { DatabaseOptions } from './storage/db.js';

export { SessionManager } from './storage/session.js';
export type { CreateSessionParams } from './storage/session.js';
export { MessageManager } from './storage/message.js';
export type { CreateMessageParams, MessageListOptions } from './storage/message.js';

export { TokenManager, getTokenManager, generateToken, hashToken, verifyToken } from './auth/token.js';
export type { TokenPayload, TokenResult } from './auth/token.js';

export { ModelRegistry, getModelRegistry } from './agent/model.js';
export type {
  ModelProvider,
  ChatMessage,
  ChatCompletionParams,
  ChatCompletionChunk,
  ModelProviderCapabilities,
  ModelProviderCapabilityReport,
  ModelProviderCapabilitySnapshot,
  ProviderNumericParameterCapability,
} from './agent/model.js';
export { getBuiltinProviderCapabilityMatrix } from './models/provider-capabilities.js';

export { ChatService } from './agent/chat.js';
export type { ChatStreamOptions } from './agent/chat.js';

export { ToolAgent } from './agent/tool-agent.js';
export type { ToolAgentOptions, ToolAgentResponse } from './agent/tool-agent.js';

export { ToolRegistry, ToolExecutor, getToolRegistry, registerBuiltinTools } from './tools/index.js';
export type { Tool, ToolDefinition, ToolCall, ToolResult, ToolContext } from './tools/index.js';

export { 
  ChannelRegistry, 
  ChannelRouter, 
  getChannelRegistry, 
  routeConditions,
  getChannelSessionManager,
  ChannelAgentBridge,
  WebhookAdapter,
  LarkAdapter,
  DingTalkAdapter,
  parseChannelConfig,
  safeParseChannelConfig,
  getChannelContract,
  listChannelContracts,
} from './channels/index.js';
export type { 
  ChannelAdapter, 
  ChannelMessage, 
  ChannelConfig, 
  ChannelType,
  SendMessageOptions,
  ChannelResponse,
  RouteHandler,
  RouteContext,
  RouteRule,
  ChannelSessionManager,
  ChannelSessionMapping,
  AdapterWebhookResult,
  WebhookCapableAdapter,
  ChannelContractDescriptor,
  WebhookChannelConfig,
  LarkChannelConfig,
  DingTalkChannelConfig,
} from './channels/index.js';

export { logger } from './utils/logger.js';
export {
  StandardError,
  StandardErrorCode,
  ensureStandardError,
  createValidationError,
  createBadRequestError,
  createUnauthorizedError,
  createForbiddenError,
  createNotFoundError,
  createMethodNotFoundError,
  createQueueNotFoundError,
  createQueueNotInitializedError,
  toHttpErrorBody,
  toGatewayErrorDetail,
} from './errors/index.js';
export type {
  StandardErrorCodeValue,
  StandardizedGatewayError,
  StandardizedHttpErrorBody,
} from './errors/index.js';
export {
  initErrorTracking,
  reportError,
  flushErrorTracking,
  isErrorTrackingEnabled,
} from './monitoring/error-tracking.js';
export type { ErrorCaptureContext } from './monitoring/error-tracking.js';

// Queue exports
// Auth exports
export { UserService } from './auth/user-service.js';
export type { CreateUserParams, UpdateUserParams } from './auth/user-service.js';
export { RoleService } from './auth/role-service.js';
export type { CreateRoleParams } from './auth/role-service.js';
export { AuthService } from './auth/service.js';
export type { LoginResult } from './auth/service.js';
export { hashPassword, verifyPassword } from './auth/password.js';
export { isAdmin, requireOwnership } from './auth/ownership.js';
export { ADMIN_SCOPE, Scope, USER_DEFAULT_SCOPES, hasScope, hasAllScopes, hasAnyScope } from './auth/scopes.js';

// Audit exports
export { AuditService } from './audit/service.js';
export type { AuditEvent, AuditQueryFilters } from './audit/service.js';

// Workflow exports
export { WorkflowService } from './workflows/service.js';
export type { CreateWorkflowParams } from './workflows/service.js';

// SSO exports
export { OAuthService } from './auth/oauth-service.js';
export type { OAuthProviderConfig, OAuthLoginResult } from './auth/oauth-service.js';
export { LDAPService } from './auth/ldap-service.js';
export type { LDAPConfig, LDAPLoginResult } from './auth/ldap-service.js';
export { SSOService } from './auth/sso-service.js';

// Plugin exports
export { PluginManager } from './plugins/manager.js';
export type { Plugin, PluginContext, PluginManifest } from './plugins/types.js';

export { QueueService, getQueueService, getExistingQueueService, closeQueueService } from './queue/index.js';
export { getQueueConnection, closeQueueConnection } from './queue/index.js';
export { createMessageProcessor, createWebhookProcessor } from './queue/index.js';
export type { 
  QueueName, 
  JobData, 
  MessageJobData, 
  AIProcessingJobData,
  NotificationJobData,
  WebhookDeliveryJobData,
  JobResult, 
  QueueMetrics,
  QueueConfig,
  QueueService as IQueueService,
  QueueConnectionOptions 
} from './queue/index.js';
