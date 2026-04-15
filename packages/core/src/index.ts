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
