import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireScopes } from '../auth/middleware.js';
import { ADMIN_SCOPE, Scope } from '../auth/scopes.js';
import { logger } from '../utils/logger.js';
import { setLogContext } from '../utils/log-context.js';
import {
  getChannelRegistry,
  listChannelContracts,
  type WebhookCapableAdapter,
} from '../channels/index.js';
import { ChatService } from '../agent/chat.js';
import type { ModelProviderCapabilityReport, ModelProviderCapabilitySnapshot } from '../agent/model.js';
import { listWorkflowTemplates } from '../tools/workflows.js';
import { getBuiltinProviderCapabilityMatrix } from '../models/provider-capabilities.js';
import {
  getMetricsSnapshot,
  markHttpRequestStarted,
  metricsContentType,
  observeHttpRequestFinished,
  updateAppUptime,
  updateQueueMetrics,
  updateStorageMetrics,
} from '../monitoring/metrics.js';
import { reportError } from '../monitoring/error-tracking.js';
import {
  StandardErrorCode,
  createBadRequestError,
  createNotFoundError,
  createUnauthorizedError,
  createValidationError,
  ensureStandardError,
  toHttpErrorBody,
} from '../errors/index.js';
import type { QueueName } from '../queue/types.js';

// Validation schemas
const CreateSessionSchema = z.object({
  title: z.string().optional(),
  modelId: z.string().optional(),
});

const SendMessageSchema = z.object({
  content: z.string().min(1),
  modelId: z.string().optional(),
});

const RunWorkflowSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  sessionId: z.string().optional(),
  createSessionIfMissing: z.boolean().default(true),
});

const LoginRequestSchema = z.object({
  password: z.string().optional(),
  scopes: z.array(z.string().min(1)).optional(),
});

const SetDefaultModelSchema = z.object({
  modelId: z.string().min(1),
});

const ChannelTypeSchema = z.enum([
  'webchat',
  'wechat',
  'dingtalk',
  'lark',
  'wecom',
  'email',
  'webhook',
  'telegram',
  'slack',
]);

const CreateChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: ChannelTypeSchema,
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

const UpdateChannelSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: ChannelTypeSchema.optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要提供一个更新字段',
  });

const IdParamSchema = z.object({
  id: z.string().min(1),
});

const QueueNameSchema = z.enum([
  'messages',
  'ai-processing',
  'notifications',
  'webhook-delivery',
]);

const QueueNameParamSchema = z.object({
  queueName: QueueNameSchema,
});

const AdapterIdParamSchema = z.object({
  adapterId: z.string().min(1),
});

const UpdateSystemSchema = z
  .object({
    port: z.number().int().min(1).max(65535).optional(),
    host: z.string().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要提供一个更新字段',
  });

const UpdateAuthSchema = z
  .object({
    type: z.enum(['token', 'oauth', 'none']).optional(),
    token: z.string().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要提供一个更新字段',
  });

const AddModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean().optional(),
  parameters: z.record(z.unknown()).optional(),
});

const UpdateModelSchema = z
  .object({
    name: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    enabled: z.boolean().optional(),
    parameters: z.record(z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要提供一个更新字段',
  });

interface ModelSelectionConfig {
  models: Array<{
    id: string;
    provider: string;
    enabled: boolean;
  }>;
  defaultModel?: string;
}

function toModelRef(model: { provider: string; id: string }): string {
  return `${model.provider}:${model.id}`;
}

function hasEnabledModel(config: ModelSelectionConfig, modelRef: string): boolean {
  return config.models.some((model) => model.enabled && toModelRef(model) === modelRef);
}

function resolveDefaultModel(config: ModelSelectionConfig): string | undefined {
  if (config.defaultModel && hasEnabledModel(config, config.defaultModel)) {
    return config.defaultModel;
  }

  const firstEnabledModel = config.models.find((model) => model.enabled);
  return firstEnabledModel ? toModelRef(firstEnabledModel) : undefined;
}

function isWebhookCapableAdapter(adapter: unknown): adapter is WebhookCapableAdapter {
  if (typeof adapter !== 'object' || adapter === null) {
    return false;
  }
  const candidate = adapter as { processWebhook?: unknown };
  return typeof candidate.processWebhook === 'function';
}

interface HttpErrorFallback {
  code: (typeof StandardErrorCode)[keyof typeof StandardErrorCode];
  message: string;
  statusCode: number;
  details?: unknown;
  preserveMessage?: boolean;
}

function sendHttpError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  fallback: HttpErrorFallback
): void {
  const standardError = ensureStandardError(error, fallback);

  if (standardError.statusCode >= 500) {
    reportError(error, {
      area: 'http.request',
      requestId: request.id,
      tags: {
        method: request.method,
        route: request.routeOptions?.url || request.url,
        status_code: String(standardError.statusCode),
        error_code: standardError.code,
      },
      extra: {
        url: request.url,
      },
    });
  }

  const logPayload = {
    requestId: request.id,
    method: request.method,
    url: request.url,
    statusCode: standardError.statusCode,
    errorCode: standardError.code,
    err: standardError,
  };
  if (standardError.statusCode >= 500) {
    logger.error(logPayload, 'HTTP request failed');
  } else {
    logger.warn(logPayload, 'HTTP request failed');
  }

  if (reply.sent) {
    return;
  }

  reply.status(standardError.statusCode).send(toHttpErrorBody(standardError, request.id));
}

function sendInvalidRequestError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  message: string
): void {
  sendHttpError(request, reply, error, {
    code: StandardErrorCode.InvalidRequest,
    message,
    statusCode: 400,
    preserveMessage: true,
  });
}

function sendBadRequestError(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  details?: unknown
): void {
  sendHttpError(request, reply, createBadRequestError(message, details), {
    code: StandardErrorCode.InvalidRequest,
    message,
    statusCode: 400,
  });
}

function sendNotFoundError(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  details?: unknown
): void {
  sendHttpError(request, reply, createNotFoundError(message, details), {
    code: StandardErrorCode.NotFound,
    message,
    statusCode: 404,
  });
}

function parseRequestInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  message: string = 'Invalid request'
): T | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    sendHttpError(request, reply, createValidationError(message, parsed.error.issues), {
      code: StandardErrorCode.ValidationFailed,
      message,
      statusCode: 400,
    });
    return null;
  }
  return parsed.data;
}

export async function setupHttpRoutes(fastify: FastifyInstance): Promise<void> {
  const configManager = fastify.configManager;
  const sessionManager = fastify.sessionManager;
  const messageManager = fastify.messageManager;
  const tokenManager = fastify.tokenManager;
  const chatService = new ChatService(sessionManager, messageManager);
  const requestStartedAt = new WeakMap<FastifyRequest, bigint>();
  const applyHttpLogContext = (request: FastifyRequest): void => {
    setLogContext({
      requestId: request.id,
      traceId: request.id,
      method: request.method.toUpperCase(),
      route: request.routeOptions?.url || request.url,
      userId: request.user?.userId,
    });
  };

  fastify.addHook('onRequest', async (request, reply) => {
    requestStartedAt.set(request, markHttpRequestStarted());
    applyHttpLogContext(request);
    reply.header('x-request-id', request.id);
    logger.debug(
      { requestId: request.id, method: request.method, url: request.url },
      'HTTP request started'
    );
  });

  fastify.addHook('onResponse', async (request, reply) => {
    applyHttpLogContext(request);
    const startedAt = requestStartedAt.get(request);
    const durationMs = startedAt
      ? observeHttpRequestFinished({
          startedAt,
          method: request.method,
          route: request.routeOptions?.url ?? request.url,
          statusCode: reply.statusCode,
        })
      : 0;
    logger.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs,
      },
      'HTTP request completed'
    );
  });

  fastify.setErrorHandler((error, request, reply) => {
    applyHttpLogContext(request);
    const fallbackStatusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400
        ? error.statusCode
        : 500;
    sendHttpError(request, reply, error, {
      code:
        fallbackStatusCode >= 500
          ? StandardErrorCode.InternalError
          : StandardErrorCode.InvalidRequest,
      message:
        fallbackStatusCode >= 500 ? 'Internal Server Error' : 'Request failed',
      statusCode: fallbackStatusCode,
      preserveMessage: fallbackStatusCode < 500,
    });
  });

  // Health check (public)
  fastify.get('/api/health', async () => {
    const dbHealthy = fastify.dbManager.isHealthy();
    
    return {
      status: dbHealthy ? 'healthy' : 'degraded',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      services: {
        gateway: true,
        database: dbHealthy,
      },
    };
  });

  // Prometheus metrics (public for local scraping)
  fastify.get('/metrics', async (_request, reply) => {
    updateAppUptime();

    try {
      const db = fastify.dbManager.getDb();
      const sessionCountRow = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
      const messageCountRow = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
      updateStorageMetrics({
        sessionCount: sessionCountRow.count,
        messageCount: messageCountRow.count,
      });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to collect storage metrics');
    }

    try {
      const { getExistingQueueService } = await import('../queue/index.js');
      const queueService = getExistingQueueService();
      if (queueService) {
        const queueMetrics = await queueService.getAllMetrics();
        updateQueueMetrics(queueMetrics);
      }
    } catch (error) {
      logger.debug({ err: error }, 'Queue metrics unavailable');
    }

    const payload = await getMetricsSnapshot();
    reply.header('Content-Type', metricsContentType);
    reply.send(payload);
  });

  // Status (public)
  fastify.get('/api/status', async () => {
    const config = configManager.get();
    return {
      status: 'healthy',
      version: '0.1.0',
      uptime: process.uptime(),
      config: {
        models: config.models.map(m => ({ id: m.id, name: m.name, enabled: m.enabled })),
        channels: config.channels.map(c => ({ id: c.id, type: c.type, enabled: c.enabled })),
      },
    };
  });

  // Config (public, partial)
  fastify.get('/api/config', async () => {
    const config = configManager.get();
    return {
      port: config.port,
      host: config.host,
      auth: { type: config.auth.type },
      defaultModel: resolveDefaultModel(config),
      models: config.models.map(m => ({ 
        id: m.id, 
        name: m.name, 
        provider: m.provider,
        enabled: m.enabled 
      })),
      channels: config.channels.map(c => ({ 
        id: c.id, 
        type: c.type, 
        name: c.name,
        enabled: c.enabled 
      })),
    };
  });

  // Auth routes
  fastify.post('/api/auth/login', async (request, reply) => {
    const body = parseRequestInput(LoginRequestSchema, request.body, request, reply, 'Invalid request');
    if (!body) {
      return;
    }

    const { password, scopes } = body;
    const config = configManager.get();

    // Simple password check (for MVP)
    // In production, use proper user management
    if (config.auth.type === 'token' && config.auth.token) {
      if (password !== config.auth.token) {
        sendHttpError(request, reply, createUnauthorizedError('Invalid credentials'), {
          code: StandardErrorCode.Unauthorized,
          message: 'Invalid credentials',
          statusCode: 401,
        });
        return;
      }
    }

    // Generate token
    const result = tokenManager.createToken('default', 'web-client', {
      scopes: scopes?.length ? scopes : [ADMIN_SCOPE],
    });
    
    return {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      scopes: result.scopes,
    };
  });

  // Protected routes

  // Sessions
  fastify.get('/api/sessions', { preHandler: [authMiddleware, requireScopes([Scope.SessionsRead])] }, async (request) => {
    const userId = request.user?.userId;
    const sessions = await sessionManager.listSessionsWithMessageCount({
      userId,
      limit: 100,
    });
    return { sessions };
  });

  fastify.post('/api/sessions', { preHandler: [authMiddleware, requireScopes([Scope.SessionsWrite])] }, async (request, reply) => {
    const body = parseRequestInput(CreateSessionSchema, request.body, request, reply, 'Invalid request');
    if (!body) {
      return;
    }

    const config = configManager.get();
    if (body.modelId && !hasEnabledModel(config, body.modelId)) {
      sendBadRequestError(request, reply, 'Invalid modelId');
      return;
    }

    const session = await sessionManager.createSession({
      title: body.title,
      modelId: body.modelId ?? resolveDefaultModel(config),
      userId: request.user?.userId,
    });

    reply.status(201).send(session);
  });

  fastify.get('/api/sessions/:id', { preHandler: [authMiddleware, requireScopes([Scope.SessionsRead])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid session id');
    if (!params) {
      return;
    }
    const session = await sessionManager.getSessionWithMessageCount(params.id);
    
    if (!session) {
      sendNotFoundError(request, reply, 'Session not found', { sessionId: params.id });
      return;
    }

    return session;
  });

  fastify.delete('/api/sessions/:id', { preHandler: [authMiddleware, requireScopes([Scope.SessionsWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid session id');
    if (!params) {
      return;
    }
    await sessionManager.deleteSession(params.id);
    reply.status(204).send();
  });

  // Messages
  fastify.get('/api/sessions/:id/messages', { preHandler: [authMiddleware, requireScopes([Scope.MessagesRead])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid session id');
    if (!params) {
      return;
    }
    const messages = await messageManager.listMessages(params.id);
    return { messages };
  });

  fastify.post('/api/sessions/:id/messages', { preHandler: [authMiddleware, requireScopes([Scope.MessagesWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid session id');
    if (!params) {
      return;
    }
    const body = parseRequestInput(SendMessageSchema, request.body, request, reply, 'Invalid request');
    if (!body) {
      return;
    }

    // Verify session exists
    const session = await sessionManager.getSession(params.id);
    if (!session) {
      sendNotFoundError(request, reply, 'Session not found', { sessionId: params.id });
      return;
    }

    // Create user message
    const message = await messageManager.createMessage({
      sessionId: params.id,
      role: 'user',
      content: body.content,
    });

    reply.status(201).send(message);
  });

  // Models
  fastify.get('/api/models', async () => {
    const config = configManager.get();
    return {
      models: config.models,
      defaultModel: resolveDefaultModel(config),
    };
  });

  fastify.get('/api/models/capabilities', async () => {
    const [builtinProviders, registeredProviders] = await Promise.all([
      getBuiltinProviderCapabilityMatrix(),
      fastify.modelRegistry.getCapabilityMatrix(),
    ]);

    const config = configManager.get();
    const merged = new Map<string, ModelProviderCapabilitySnapshot>();
    for (const provider of builtinProviders) {
      merged.set(provider.providerId, provider);
    }
    for (const provider of registeredProviders) {
      merged.set(provider.providerId, provider);
    }

    const providers: ModelProviderCapabilityReport[] = Array.from(merged.values())
      .map((provider) => ({
        ...provider,
        registered: fastify.modelRegistry.has(provider.providerId),
        configuredModels: config.models
          .filter((model) => model.provider === provider.providerId)
          .map((model) => model.id),
      }))
      .sort((a, b) => a.providerId.localeCompare(b.providerId));

    return { providers };
  });

  // Workflows
  fastify.get('/api/workflows', async () => {
    return { workflows: listWorkflowTemplates() };
  });

  fastify.post('/api/workflows/run', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRun])] }, async (request, reply) => {
    const body = parseRequestInput(RunWorkflowSchema, request.body, request, reply, 'Invalid request');
    if (!body) {
      return;
    }

    try {
      const config = configManager.get();
      let sessionId = body.sessionId;
      if (!sessionId) {
        const session = await sessionManager.createSession({
          title: `工作流: ${body.name}`,
          modelId: resolveDefaultModel(config),
          userId: request.user?.userId,
        });
        sessionId = session.id;
      } else {
        const existing = await sessionManager.getSession(sessionId);
        if (!existing) {
          if (body.createSessionIfMissing ?? true) {
            const session = await sessionManager.createSession({
              title: `工作流: ${body.name}`,
              modelId: resolveDefaultModel(config),
              userId: request.user?.userId,
            });
            sessionId = session.id;
          } else {
            sendNotFoundError(request, reply, 'Session not found', { sessionId });
            return;
          }
        }
      }

      const result = await chatService.executeWorkflow(body.name, body.params ?? {}, sessionId);
      return {
        sessionId,
        ...result,
      };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Workflow execution failed');
    }
  });

  // Channels
  fastify.get('/api/channels', { preHandler: [authMiddleware, requireScopes([Scope.ChannelsRead])] }, async () => {
    const config = configManager.get();
    return { channels: config.channels };
  });

  fastify.get(
    '/api/channels/contracts',
    { preHandler: [authMiddleware, requireScopes([Scope.ChannelsRead])] },
    async () => {
      return {
        contracts: listChannelContracts(),
      };
    }
  );

  // === Configuration Management API ===
  
  // Get full configuration (protected, admin only)
  fastify.get('/api/config/full', { preHandler: [authMiddleware, requireScopes([Scope.ConfigRead])] }, async () => {
    const config = configManager.get();
    return { config };
  });

  // Update system configuration
  fastify.put('/api/config/system', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const payload = parseRequestInput(UpdateSystemSchema, request.body, request, reply, 'Invalid request');
    if (!payload) {
      return;
    }
    
    try {
      await configManager.updateSystem(payload);
      return { success: true, message: 'System configuration updated. Restart required for changes to take effect.' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Update failed');
    }
  });

  // Update auth configuration
  fastify.put('/api/config/auth', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const auth = parseRequestInput(UpdateAuthSchema, request.body, request, reply, 'Invalid request');
    if (!auth) {
      return;
    }
    
    try {
      await configManager.updateAuth(auth);
      return { success: true, message: 'Auth configuration updated' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Update failed');
    }
  });

  // === Model Configuration API ===

  // Add model
  fastify.post('/api/config/models', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const model = parseRequestInput(AddModelSchema, request.body, request, reply, 'Invalid request');
    if (!model) {
      return;
    }
    
    try {
      await configManager.addModel({
        ...model,
        enabled: model.enabled ?? true,
      });
      return { success: true, message: 'Model added' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to add model');
    }
  });

  // Update model
  fastify.put('/api/config/models/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid model id');
    if (!params) {
      return;
    }
    const updates = parseRequestInput(UpdateModelSchema, request.body, request, reply, 'Invalid request');
    if (!updates) {
      return;
    }
    
    try {
      await configManager.updateModel(params.id, updates);
      return { success: true, message: 'Model updated' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to update model');
    }
  });

  // Set default model
  fastify.put('/api/config/models/default', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const body = parseRequestInput(SetDefaultModelSchema, request.body, request, reply, 'Invalid request');
    if (!body) {
      return;
    }

    try {
      await configManager.setDefaultModel(body.modelId);
      return { success: true, message: 'Default model updated' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to set default model');
    }
  });

  // Remove model
  fastify.delete('/api/config/models/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid model id');
    if (!params) {
      return;
    }
    
    try {
      await configManager.removeModel(params.id);
      return { success: true, message: 'Model removed' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to remove model');
    }
  });

  // === Channel Configuration API ===

  // Add channel
  fastify.post('/api/config/channels', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const channel = parseRequestInput(CreateChannelSchema, request.body, request, reply, 'Invalid request');
    if (!channel) {
      return;
    }

    try {
      await configManager.addChannel({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled ?? true,
        config: channel.config || {},
      });
      return { success: true, message: 'Channel added' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to add channel');
    }
  });

  // Update channel
  fastify.put('/api/config/channels/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid channel id');
    if (!params) {
      return;
    }
    const updates = parseRequestInput(UpdateChannelSchema, request.body, request, reply, 'Invalid request');
    if (!updates) {
      return;
    }

    try {
      await configManager.updateChannel(params.id, updates);
      return { success: true, message: 'Channel updated' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to update channel');
    }
  });

  // Remove channel
  fastify.delete('/api/config/channels/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid channel id');
    if (!params) {
      return;
    }
    
    try {
      await configManager.removeChannel(params.id);
      return { success: true, message: 'Channel removed' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to remove channel');
    }
  });

  // Queue Metrics API
  fastify.get('/api/queue/metrics', { preHandler: [authMiddleware, requireScopes([Scope.QueueRead])] }, async () => {
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    const metrics = await queueService.getAllMetrics();
    return { metrics };
  });

  fastify.get('/api/queue/metrics/:queueName', { preHandler: [authMiddleware, requireScopes([Scope.QueueRead])] }, async (request, reply) => {
    const params = parseRequestInput(
      QueueNameParamSchema,
      request.params,
      request,
      reply,
      'Invalid queue name'
    );
    if (!params) {
      return;
    }
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    const queueName: QueueName = params.queueName;
    
    try {
      const metrics = await queueService.getMetrics(queueName);
      return { metrics };
    } catch (error) {
      sendHttpError(request, reply, error, {
        code: StandardErrorCode.QueueNotFound,
        message: 'Queue not found',
        statusCode: 404,
      });
    }
  });

  fastify.post('/api/queue/:queueName/pause', { preHandler: [authMiddleware, requireScopes([Scope.QueueWrite])] }, async (request, reply) => {
    const params = parseRequestInput(
      QueueNameParamSchema,
      request.params,
      request,
      reply,
      'Invalid queue name'
    );
    if (!params) {
      return;
    }
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    const queueName: QueueName = params.queueName;
    
    try {
      await queueService.pauseQueue(queueName);
      return { success: true, message: 'Queue paused' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to pause queue');
    }
  });

  fastify.post('/api/queue/:queueName/resume', { preHandler: [authMiddleware, requireScopes([Scope.QueueWrite])] }, async (request, reply) => {
    const params = parseRequestInput(
      QueueNameParamSchema,
      request.params,
      request,
      reply,
      'Invalid queue name'
    );
    if (!params) {
      return;
    }
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    const queueName: QueueName = params.queueName;
    
    try {
      await queueService.resumeQueue(queueName);
      return { success: true, message: 'Queue resumed' };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to resume queue');
    }
  });

  // Channel Webhooks - Dynamic webhook endpoints
  fastify.post('/api/webhooks/:adapterId', async (request, reply) => {
    const params = parseRequestInput(
      AdapterIdParamSchema,
      request.params,
      request,
      reply,
      'Invalid adapter id'
    );
    if (!params) {
      return;
    }
    const { adapterId } = params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    
    const registry = getChannelRegistry();
    const adapter = registry.get(adapterId);
    
    if (!adapter) {
      sendNotFoundError(request, reply, 'Webhook adapter not found', { adapterId });
      return;
    }

    if (!isWebhookCapableAdapter(adapter)) {
      sendBadRequestError(request, reply, 'Invalid adapter type', { adapterId });
      return;
    }

    try {
      const result = await adapter.processWebhook(request.body, signature);

      if (result.kind === 'response') {
        reply.status(result.statusCode ?? 200).send(result.body ?? { success: true });
        return;
      }

      if (result.kind === 'ignored') {
        reply.status(result.statusCode ?? 200).send(result.body ?? { success: true, ignored: true });
        return;
      }

      reply.status(200).send({
        success: true,
        messageId: result.message?.id,
        received: true,
      });
    } catch (error) {
      sendHttpError(request, reply, error, {
        code: StandardErrorCode.UpstreamError,
        message: 'Webhook processing failed',
        statusCode: 400,
        preserveMessage: true,
        details: { adapterId },
      });
    }
  });

  logger.debug('HTTP routes registered');
}
