import type { FastifyInstance, FastifyRequest } from 'fastify';
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
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400
        ? error.statusCode
        : 500;

    if (statusCode >= 500) {
      reportError(error, {
        area: 'http.request',
        requestId: request.id,
        tags: {
          method: request.method,
          route: request.routeOptions?.url || request.url,
          status_code: String(statusCode),
        },
        extra: {
          url: request.url,
        },
      });
    }

    logger.error(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: error.statusCode,
        err: error,
      },
      'HTTP request failed'
    );

    if (reply.sent) {
      return;
    }

    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
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
    const body = LoginRequestSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    const { password, scopes } = body.data;
    const config = configManager.get();

    // Simple password check (for MVP)
    // In production, use proper user management
    if (config.auth.type === 'token' && config.auth.token) {
      if (password !== config.auth.token) {
        reply.status(401).send({ error: 'Invalid credentials' });
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
    const sessions = await sessionManager.listSessions({ 
      userId,
      limit: 100,
    });
    return { sessions };
  });

  fastify.post('/api/sessions', { preHandler: [authMiddleware, requireScopes([Scope.SessionsWrite])] }, async (request, reply) => {
    const body = CreateSessionSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    const config = configManager.get();
    if (body.data.modelId && !hasEnabledModel(config, body.data.modelId)) {
      reply.status(400).send({ error: 'Invalid modelId' });
      return;
    }

    const session = await sessionManager.createSession({
      title: body.data.title,
      modelId: body.data.modelId ?? resolveDefaultModel(config),
      userId: request.user?.userId,
    });

    reply.status(201).send(session);
  });

  fastify.get('/api/sessions/:id', { preHandler: [authMiddleware, requireScopes([Scope.SessionsRead])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await sessionManager.getSession(id);
    
    if (!session) {
      reply.status(404).send({ error: 'Session not found' });
      return;
    }

    // Get message count
    session.messageCount = await messageManager.getMessageCount(id);
    
    return session;
  });

  fastify.delete('/api/sessions/:id', { preHandler: [authMiddleware, requireScopes([Scope.SessionsWrite])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await sessionManager.deleteSession(id);
    reply.status(204).send();
  });

  // Messages
  fastify.get('/api/sessions/:id/messages', { preHandler: [authMiddleware, requireScopes([Scope.MessagesRead])] }, async (request) => {
    const { id } = request.params as { id: string };
    const messages = await messageManager.listMessages(id);
    return { messages };
  });

  fastify.post('/api/sessions/:id/messages', { preHandler: [authMiddleware, requireScopes([Scope.MessagesWrite])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = SendMessageSchema.safeParse(request.body);
    
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    // Verify session exists
    const session = await sessionManager.getSession(id);
    if (!session) {
      reply.status(404).send({ error: 'Session not found' });
      return;
    }

    // Create user message
    const message = await messageManager.createMessage({
      sessionId: id,
      role: 'user',
      content: body.data.content,
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
    const body = RunWorkflowSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    try {
      const config = configManager.get();
      let sessionId = body.data.sessionId;
      if (!sessionId) {
        const session = await sessionManager.createSession({
          title: `工作流: ${body.data.name}`,
          modelId: resolveDefaultModel(config),
          userId: request.user?.userId,
        });
        sessionId = session.id;
      } else {
        const existing = await sessionManager.getSession(sessionId);
        if (!existing) {
          if (body.data.createSessionIfMissing) {
            const session = await sessionManager.createSession({
              title: `工作流: ${body.data.name}`,
              modelId: resolveDefaultModel(config),
              userId: request.user?.userId,
            });
            sessionId = session.id;
          } else {
            reply.status(404).send({ error: 'Session not found' });
            return;
          }
        }
      }

      const result = await chatService.executeWorkflow(body.data.name, body.data.params, sessionId);
      return {
        sessionId,
        ...result,
      };
    } catch (error) {
      reply.status(400).send({
        error: error instanceof Error ? error.message : 'Workflow execution failed',
      });
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
    const { port, host } = request.body as { port?: number; host?: string };
    
    try {
      await configManager.updateSystem({ port, host });
      return { success: true, message: 'System configuration updated. Restart required for changes to take effect.' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  // Update auth configuration
  fastify.put('/api/config/auth', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const auth = request.body as { type?: 'token' | 'oauth' | 'none'; token?: string };
    
    try {
      await configManager.updateAuth(auth);
      return { success: true, message: 'Auth configuration updated' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  // === Model Configuration API ===

  // Add model
  fastify.post('/api/config/models', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const model = request.body as { id: string; name: string; provider: string; apiKey?: string; baseUrl?: string; enabled?: boolean };
    
    try {
      await configManager.addModel({
        ...model,
        enabled: model.enabled ?? true,
      });
      return { success: true, message: 'Model added' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to add model' });
    }
  });

  // Update model
  fastify.put('/api/config/models/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<{ name: string; apiKey: string; baseUrl: string; enabled: boolean }>;
    
    try {
      await configManager.updateModel(id, updates);
      return { success: true, message: 'Model updated' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update model' });
    }
  });

  // Set default model
  fastify.put('/api/config/models/default', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const body = SetDefaultModelSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    try {
      await configManager.setDefaultModel(body.data.modelId);
      return { success: true, message: 'Default model updated' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to set default model' });
    }
  });

  // Remove model
  fastify.delete('/api/config/models/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await configManager.removeModel(id);
      return { success: true, message: 'Model removed' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to remove model' });
    }
  });

  // === Channel Configuration API ===

  // Add channel
  fastify.post('/api/config/channels', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const body = CreateChannelSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    const channel = body.data;

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
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to add channel' });
    }
  });

  // Update channel
  fastify.put('/api/config/channels/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateChannelSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400).send({ error: 'Invalid request', details: body.error });
      return;
    }

    const updates = body.data;

    try {
      await configManager.updateChannel(id, updates);
      return { success: true, message: 'Channel updated' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to update channel' });
    }
  });

  // Remove channel
  fastify.delete('/api/config/channels/:id', { preHandler: [authMiddleware, requireScopes([Scope.ConfigWrite])] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await configManager.removeChannel(id);
      return { success: true, message: 'Channel removed' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to remove channel' });
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
    const { queueName } = request.params as { queueName: string };
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    
    try {
      const metrics = await queueService.getMetrics(queueName as import('../queue/types.js').QueueName);
      return { metrics };
    } catch {
      reply.status(404).send({ error: 'Queue not found' });
    }
  });

  fastify.post('/api/queue/:queueName/pause', { preHandler: [authMiddleware, requireScopes([Scope.QueueWrite])] }, async (request, reply) => {
    const { queueName } = request.params as { queueName: string };
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    
    try {
      await queueService.pauseQueue(queueName as import('../queue/types.js').QueueName);
      return { success: true, message: 'Queue paused' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to pause queue' });
    }
  });

  fastify.post('/api/queue/:queueName/resume', { preHandler: [authMiddleware, requireScopes([Scope.QueueWrite])] }, async (request, reply) => {
    const { queueName } = request.params as { queueName: string };
    const { getQueueService } = await import('../queue/index.js');
    const queueService = getQueueService();
    
    try {
      await queueService.resumeQueue(queueName as import('../queue/types.js').QueueName);
      return { success: true, message: 'Queue resumed' };
    } catch (error) {
      reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to resume queue' });
    }
  });

  // Channel Webhooks - Dynamic webhook endpoints
  fastify.post('/api/webhooks/:adapterId', async (request, reply) => {
    const { adapterId } = request.params as { adapterId: string };
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    
    const registry = getChannelRegistry();
    const adapter = registry.get(adapterId);
    
    if (!adapter) {
      reply.status(404).send({ error: 'Webhook adapter not found' });
      return;
    }

    if (!isWebhookCapableAdapter(adapter)) {
      reply.status(400).send({ error: 'Invalid adapter type' });
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
      logger.error({ err: error, adapterId }, 'Webhook processing error');
      reply.status(400).send({ 
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  logger.debug('HTTP routes registered');
}
