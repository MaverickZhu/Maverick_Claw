import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import path from 'path';
import { z } from 'zod';
import { authMiddleware, requireScopes } from '../auth/middleware.js';
import { ADMIN_SCOPE, Scope } from '../auth/scopes.js';
import { isAdmin } from '../auth/ownership.js';
import { logger } from '../utils/logger.js';
import { setLogContext } from '../utils/log-context.js';
import {
  getChannelRegistry,
  listChannelContracts,
  type WebhookCapableAdapter,
} from '../channels/index.js';
import { ChatService } from '../agent/chat.js';
import type { StatsService } from '../stats/service.js';
import type { ExportService } from '../export/service.js';
import type { ImportService } from '../import/service.js';
import type { ModelProviderCapabilityReport, ModelProviderCapabilitySnapshot } from '../agent/model.js';
import { listWorkflowTemplates, getWorkflowTemplate } from '../tools/workflows.js';
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
import type { UploadService } from '../upload/service.js';

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

const emailSchema = z.string().refine((val) => /^[^\s@]+@[^\s@]+$/.test(val), { message: 'Invalid email' });

const LoginRequestSchema = z.object({
  email: emailSchema.optional(),
  password: z.string().optional(),
  scopes: z.array(z.string().min(1)).optional(),
});

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: emailSchema.optional(),
  password: z.string().min(6),
  roleId: z.string().optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: emailSchema.optional(),
  roleId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const UpdatePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const CreateRoleSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string().min(1)),
});

const UpdateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).optional(),
});

const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.record(z.unknown()),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  definition: z.record(z.unknown()).optional(),
});

const AuditQuerySchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  userId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().min(0).optional().default(0),
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

function sendUnauthorizedError(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string
): void {
  sendHttpError(request, reply, createUnauthorizedError(message), {
    code: StandardErrorCode.Unauthorized,
    message,
    statusCode: 401,
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
  const uploadService: UploadService = fastify.uploadService;
  const statsService: StatsService = fastify.statsService;
  const exportService: ExportService = fastify.exportService;
  const importService: ImportService = fastify.importService;
  const chatService = new ChatService(sessionManager, messageManager, statsService);
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

  // Stats API
  fastify.get('/api/stats/overview', async () => {
    return statsService.getOverview();
  });

  fastify.get('/api/stats/daily', async (request) => {
    const days = Number((request.query as Record<string, string>).days) || 30;
    return statsService.getDailyStats(days);
  });

  fastify.get('/api/stats/models', async () => {
    return statsService.getModelStats();
  });

  // Export
  fastify.post('/api/export', async (_request, reply) => {
    const buffer = await exportService.exportAll();
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="maverick-claw-export-${Date.now()}.zip"`);
    reply.send(buffer);
  });

  // Import
  fastify.post('/api/import', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      reply.status(400).send({ error: 'No file uploaded' });
      return;
    }

    const buffer = await data.toBuffer();
    const result = await importService.importFromBuffer(buffer);
    reply.status(result.success ? 200 : 400).send(result);
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

    const { email, password, scopes } = body;
    const authService = fastify.authService;

    // Backward compatibility: if no email provided, fall back to config master password
    if (!email) {
      const config = configManager.get();
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
      const result = tokenManager.createToken('default', 'web-client', {
        scopes: scopes?.length ? scopes : [ADMIN_SCOPE],
      });
      return {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        scopes: result.scopes,
      };
    }

    // New user-based login
    if (!password) {
      sendBadRequestError(request, reply, 'Password required');
      return;
    }

    const result = await authService.login(email, password, 'web-client');
    if (!result) {
      sendHttpError(request, reply, createUnauthorizedError('Invalid credentials'), {
        code: StandardErrorCode.Unauthorized,
        message: 'Invalid credentials',
        statusCode: 401,
      });
      return;
    }

    return {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: { ...result.user, scopes: result.scopes },
      scopes: result.scopes,
    };
  });

  fastify.post('/api/auth/logout', { preHandler: [authMiddleware] }, async (request, reply) => {
    const token = request.headers.authorization?.split(' ')[1];
    if (token) {
      await fastify.authService.logout(token);
    }
    reply.status(204).send();
  });

  fastify.get('/api/auth/me', { preHandler: [authMiddleware] }, async (request) => {
    const token = request.headers.authorization?.split(' ')[1];
    if (!token) {
      return { user: null };
    }
    const user = await fastify.authService.getCurrentUser(token);
    if (!user) {
      return { user: null };
    }
    // Attach scopes from role
    let scopes: string[] = [];
    if (user.roleId) {
      const role = await fastify.roleService.getRole(user.roleId);
      if (role) {
        scopes = role.scopes;
      }
    }
    return { user: { ...user, scopes } };
  });

  fastify.get('/api/auth/providers', async () => {
    const config = configManager.get();
    const methods = fastify.ssoService.getAuthMethods(config);
    return methods;
  });

  fastify.get('/api/auth/oauth/:provider', async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid provider id');
    if (!params) return;

    const config = configManager.get();
    const providerConfig = config.auth.oauth?.providers.find((p) => p.id === params.id && p.enabled);
    if (!providerConfig) {
      sendNotFoundError(request, reply, 'OAuth provider not found');
      return;
    }

    const authUrl = await fastify.oauthService.getAuthUrl(providerConfig);
    return { authUrl };
  });

  fastify.get('/api/auth/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; provider?: string };
    if (!query.code || !query.state || !query.provider) {
      sendBadRequestError(request, reply, 'Missing code, state or provider');
      return;
    }

    const config = configManager.get();
    const providerConfig = config.auth.oauth?.providers.find((p) => p.id === query.provider && p.enabled);
    if (!providerConfig) {
      sendNotFoundError(request, reply, 'OAuth provider not found');
      return;
    }

    const result = await fastify.oauthService.handleCallback(providerConfig, query.code, query.state);
    if (!result) {
      sendUnauthorizedError(request, reply, 'OAuth authentication failed');
      return;
    }

    return {
      token: result.token,
      user: result.user,
      isNewUser: result.isNewUser,
    };
  });

  fastify.post('/api/auth/ldap', async (request, reply) => {
    const body = parseRequestInput(
      z.object({ username: z.string().min(1), password: z.string().min(1) }),
      request.body,
      request,
      reply,
      'Invalid request'
    );
    if (!body) return;

    const config = configManager.get();
    if (!config.auth.ldap?.enabled) {
      sendBadRequestError(request, reply, 'LDAP authentication not enabled');
      return;
    }

    const result = await fastify.ldapService.authenticate(body.username, body.password, config.auth.ldap);
    if (!result) {
      sendUnauthorizedError(request, reply, 'LDAP authentication failed');
      return;
    }

    return {
      token: result.token,
      user: result.user,
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

    // Ownership check: non-admin users can only access their own sessions
    if (!isAdmin(request) && session.userId && session.userId !== request.user?.userId) {
      reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      return;
    }

    return session;
  });

  fastify.delete('/api/sessions/:id', { preHandler: [authMiddleware, requireScopes([Scope.SessionsWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid session id');
    if (!params) {
      return;
    }

    // Ownership check
    if (!isAdmin(request)) {
      const session = await sessionManager.getSession(params.id);
      if (session?.userId && session.userId !== request.user?.userId) {
        reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
        return;
      }
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
  fastify.get('/api/webhooks/:adapterId', async (request, reply) => {
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

    if (!adapter.verifyWebhookUrl) {
      sendBadRequestError(request, reply, 'Adapter does not support URL verification', { adapterId });
      return;
    }

    try {
      const result = await adapter.verifyWebhookUrl(request.query as Record<string, string | string[] | undefined>);

      if (result.kind === 'success') {
        reply.status(result.statusCode ?? 200).send(result.body ?? { success: true });
        return;
      }

      reply.status(result.statusCode ?? 400).send(result.body ?? { error: 'Verification failed' });
    } catch (error) {
      sendHttpError(request, reply, error, {
        code: StandardErrorCode.UpstreamError,
        message: 'Webhook URL verification failed',
        statusCode: 400,
        preserveMessage: true,
        details: { adapterId },
      });
    }
  });

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

  // File Upload
  fastify.post('/api/upload', { preHandler: [authMiddleware, requireScopes([Scope.MessagesWrite])] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        sendBadRequestError(request, reply, 'No file provided');
        return;
      }

      const buffer = await data.toBuffer();
      const validation = uploadService.validateFile(data.mimetype, buffer.length);
      if (!validation.valid) {
        sendBadRequestError(request, reply, validation.error || 'Invalid file');
        return;
      }

      const result = await uploadService.saveFile(buffer, data.filename, data.mimetype);
      reply.status(201).send(result);
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Failed to upload file');
    }
  });

  fastify.get('/api/uploads/:fileId', async (request, reply) => {
    const params = parseRequestInput(
      z.object({ fileId: z.string().min(1) }),
      request.params,
      request,
      reply,
      'Invalid file id'
    );
    if (!params) {
      return;
    }

    const file = await uploadService.getFile(params.fileId);
    if (!file) {
      sendNotFoundError(request, reply, 'File not found', { fileId: params.fileId });
      return;
    }

    reply.header('Content-Type', file.mimeType);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    return reply.sendFile(path.basename(file.path));
  });

  // === User Management API ===

  fastify.get('/api/users', { preHandler: [authMiddleware, requireScopes([Scope.ConfigRead])] }, async (request) => {
    // Only admin can list all users
    if (!isAdmin(request)) {
      // Non-admin can only see themselves
      const user = await fastify.userService.getUser(request.user!.userId);
      return { users: user ? [user] : [] };
    }
    const users = await fastify.userService.listUsers();
    return { users };
  });

  fastify.post('/api/users', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const body = parseRequestInput(CreateUserSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    const user = await fastify.userService.createUser(body);
    reply.status(201).send(user);
  });

  fastify.get('/api/users/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid user id');
    if (!params) return;

    // Non-admin can only view themselves
    if (!isAdmin(request) && params.id !== request.user?.userId) {
      reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      return;
    }

    const user = await fastify.userService.getUser(params.id);
    if (!user) {
      sendNotFoundError(request, reply, 'User not found');
      return;
    }
    return user;
  });

  fastify.put('/api/users/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid user id');
    if (!params) return;

    // Non-admin can only update themselves, and cannot change role
    if (!isAdmin(request)) {
      if (params.id !== request.user?.userId) {
        reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
        return;
      }
      const body = parseRequestInput(UpdateUserSchema, request.body, request, reply, 'Invalid request');
      if (!body) return;
      // Strip roleId for non-admin self-update
      const { roleId, ...safeUpdate } = body;
      await fastify.userService.updateUser(params.id, safeUpdate);
    } else {
      const body = parseRequestInput(UpdateUserSchema, request.body, request, reply, 'Invalid request');
      if (!body) return;
      await fastify.userService.updateUser(params.id, body);
    }

    const user = await fastify.userService.getUser(params.id);
    return user;
  });

  fastify.delete('/api/users/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid user id');
    if (!params) return;

    await fastify.userService.deleteUser(params.id);
    reply.status(204).send();
  });

  fastify.put('/api/users/me/password', { preHandler: [authMiddleware] }, async (request, reply) => {
    const body = parseRequestInput(UpdatePasswordSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    const success = await fastify.authService.changePassword(
      request.user!.userId,
      body.oldPassword,
      body.newPassword
    );

    if (!success) {
      sendUnauthorizedError(request, reply, 'Invalid old password');
      return;
    }

    return { success: true };
  });

  // === Role Management API ===

  fastify.get('/api/roles', { preHandler: [authMiddleware] }, async () => {
    const roles = await fastify.roleService.listRoles();
    return { roles };
  });

  fastify.post('/api/roles', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const body = parseRequestInput(CreateRoleSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    const role = await fastify.roleService.createRole(body);
    reply.status(201).send(role);
  });

  fastify.get('/api/roles/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid role id');
    if (!params) return;

    const role = await fastify.roleService.getRole(params.id);
    if (!role) {
      sendNotFoundError(request, reply, 'Role not found');
      return;
    }
    return role;
  });

  fastify.put('/api/roles/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid role id');
    if (!params) return;

    const body = parseRequestInput(UpdateRoleSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    await fastify.roleService.updateRole(params.id, body);
    const role = await fastify.roleService.getRole(params.id);
    return role;
  });

  fastify.delete('/api/roles/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid role id');
    if (!params) return;

    try {
      await fastify.roleService.deleteRole(params.id);
      reply.status(204).send();
    } catch (error) {
      sendBadRequestError(request, reply, error instanceof Error ? error.message : 'Cannot delete role');
    }
  });

  // === Audit Logs API ===

  fastify.get('/api/audit/logs', { preHandler: [authMiddleware, requireScopes([Scope.ConfigRead])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const query = parseRequestInput(AuditQuerySchema, request.query, request, reply, 'Invalid query');
    if (!query) return;

    const result = await fastify.auditService.query({
      action: query.action,
      resourceType: query.resourceType,
      userId: query.userId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });

    return result;
  });

  fastify.get('/api/audit/stats', { preHandler: [authMiddleware, requireScopes([Scope.ConfigRead])] }, async (request, reply) => {
    if (!isAdmin(request)) {
      reply.status(403).send({ error: 'Forbidden', message: 'Admin required' });
      return;
    }
    const days = Number((request.query as { days?: string }).days) || 7;
    const stats = await fastify.auditService.getStats(days);
    return stats;
  });

  // === Workflow Management API ===

  fastify.get('/api/workflows', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRead])] }, async () => {
    const workflows = await fastify.workflowService.listWorkflows();
    return { workflows };
  });

  fastify.post('/api/workflows', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRun])] }, async (request, reply) => {
    const body = parseRequestInput(CreateWorkflowSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    const workflow = await fastify.workflowService.createWorkflow({
      name: body.name,
      description: body.description,
      definition: body.definition as unknown as import('../tools/orchestrator.js').ExecutionPlan,
      ownerId: request.user?.userId,
    });
    reply.status(201).send(workflow);
  });

  fastify.get('/api/workflows/:id', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRead])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid workflow id');
    if (!params) return;

    const workflow = await fastify.workflowService.getWorkflow(params.id);
    if (!workflow) {
      // Check builtin templates
      if (params.id.startsWith('builtin:')) {
        const templateName = params.id.slice('builtin:'.length);
        const template = getWorkflowTemplate(templateName);
        if (template) {
          return {
            id: params.id,
            name: template.name,
            description: template.description,
            definition: {},
            isBuiltin: true,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          };
        }
      }
      sendNotFoundError(request, reply, 'Workflow not found');
      return;
    }
    return workflow;
  });

  fastify.put('/api/workflows/:id', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRun])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid workflow id');
    if (!params) return;

    const body = parseRequestInput(UpdateWorkflowSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    await fastify.workflowService.updateWorkflow(params.id, {
      name: body.name,
      description: body.description,
      definition: body.definition as unknown as import('../tools/orchestrator.js').ExecutionPlan,
    });

    const workflow = await fastify.workflowService.getWorkflow(params.id);
    return workflow;
  });

  fastify.delete('/api/workflows/:id', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRun])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid workflow id');
    if (!params) return;

    await fastify.workflowService.deleteWorkflow(params.id);
    reply.status(204).send();
  });

  fastify.post('/api/workflows/:id/run', { preHandler: [authMiddleware, requireScopes([Scope.WorkflowRun])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid workflow id');
    if (!params) return;

    const body = parseRequestInput(RunWorkflowSchema, request.body, request, reply, 'Invalid request');
    if (!body) return;

    try {
      const config = configManager.get();
      let sessionId = body.sessionId;
      if (!sessionId) {
        const session = await sessionManager.createSession({
          title: `工作流: ${params.id}`,
          modelId: resolveDefaultModel(config),
          userId: request.user?.userId,
        });
        sessionId = session.id;
      }

      const result = await fastify.workflowService.executeWorkflow(
        params.id,
        body.params ?? {},
        { sessionId, requestId: request.id }
      );

      return {
        sessionId,
        success: result.success,
        executionTime: result.executionTime,
        completedNodes: result.completedNodes,
        failedNodes: result.failedNodes,
      };
    } catch (error) {
      sendInvalidRequestError(request, reply, error, 'Workflow execution failed');
    }
  });

  // === Plugin Market API ===

  fastify.get('/api/market/plugins', { preHandler: [authMiddleware, requireScopes([Scope.PluginsRead])] }, async (request) => {
    const registryUrl = (request.query as { url?: string }).url;
    const plugins = await fastify.pluginMarketService.listMarketPlugins(registryUrl);
    return { plugins };
  });

  fastify.get('/api/market/plugins/:id', { preHandler: [authMiddleware, requireScopes([Scope.PluginsRead])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid plugin id');
    if (!params) return;
    const registryUrl = (request.query as { url?: string }).url;
    const plugin = await fastify.pluginMarketService.getMarketPlugin(params.id, registryUrl);
    if (!plugin) {
      sendNotFoundError(request, reply, 'Plugin not found in registry');
      return;
    }
    return plugin;
  });

  fastify.get('/api/plugins', { preHandler: [authMiddleware, requireScopes([Scope.PluginsRead])] }, async () => {
    const plugins = fastify.pluginMarketService.listInstalled();
    return { plugins };
  });

  fastify.post('/api/plugins/install', { preHandler: [authMiddleware, requireScopes([Scope.PluginsWrite])] }, async (request, reply) => {
    const body = request.body as { id?: string; url?: string };
    if (!body.id || typeof body.id !== 'string') {
      reply.status(400).send({ error: 'Bad Request', message: 'Plugin id is required' });
      return;
    }
    const result = await fastify.pluginMarketService.install(body.id, body.url);
    if (!result) {
      reply.status(400).send({ error: 'Bad Request', message: 'Failed to install plugin' });
      return;
    }
    return result;
  });

  fastify.post('/api/plugins/uninstall', { preHandler: [authMiddleware, requireScopes([Scope.PluginsWrite])] }, async (request, reply) => {
    const body = request.body as { id?: string };
    if (!body.id || typeof body.id !== 'string') {
      reply.status(400).send({ error: 'Bad Request', message: 'Plugin id is required' });
      return;
    }
    const success = await fastify.pluginMarketService.uninstall(body.id);
    if (!success) {
      reply.status(400).send({ error: 'Bad Request', message: 'Failed to uninstall plugin' });
      return;
    }
    // Also unload from plugin manager if loaded
    await fastify.pluginManager.unloadPlugin(body.id);
    return { success: true };
  });

  fastify.post('/api/plugins/update', { preHandler: [authMiddleware, requireScopes([Scope.PluginsWrite])] }, async (request, reply) => {
    const body = request.body as { id?: string; url?: string };
    if (!body.id || typeof body.id !== 'string') {
      reply.status(400).send({ error: 'Bad Request', message: 'Plugin id is required' });
      return;
    }
    const result = await fastify.pluginMarketService.update(body.id, body.url);
    if (!result) {
      reply.status(400).send({ error: 'Bad Request', message: 'Failed to update plugin' });
      return;
    }
    return result;
  });

  fastify.get('/api/plugins/updates', { preHandler: [authMiddleware, requireScopes([Scope.PluginsRead])] }, async (request) => {
    const registryUrl = (request.query as { url?: string }).url;
    const updates = await fastify.pluginMarketService.checkUpdates(registryUrl);
    return { updates };
  });

  fastify.post('/api/plugins/:id/enable', { preHandler: [authMiddleware, requireScopes([Scope.PluginsWrite])] }, async (request, reply) => {
    const params = parseRequestInput(IdParamSchema, request.params, request, reply, 'Invalid plugin id');
    if (!params) return;
    const body = request.body as { enabled?: boolean };
    const enabled = body.enabled !== false;
    const success = fastify.pluginMarketService.setEnabled(params.id, enabled);
    if (!success) {
      sendNotFoundError(request, reply, 'Plugin not found');
      return;
    }
    return { success: true, enabled };
  });

  logger.debug('HTTP routes registered');
}
