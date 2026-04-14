import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { z } from 'zod';
import type { ConnectRequest, GatewayRequest, GatewayResponse } from '@maverick-claw/shared';
import type { GatewayOptions } from './server.js';
import { logger } from '../utils/logger.js';
import { setLogContext, withLogContext } from '../utils/log-context.js';
import { ChatService } from '../agent/chat.js';
import { getTokenManager } from '../auth/token.js';
import { ADMIN_SCOPE, Scope, USER_DEFAULT_SCOPES, hasAllScopes } from '../auth/scopes.js';
import { listWorkflowTemplates } from '../tools/workflows.js';
import { getBuiltinProviderCapabilityMatrix } from '../models/provider-capabilities.js';
import {
  recordWsConnectedClients,
  recordWsError,
  recordWsMessage,
} from '../monitoring/metrics.js';
import { reportError } from '../monitoring/error-tracking.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_WS_MESSAGE_BYTES = 512 * 1024;

const ConnectRequestSchema = z.object({
  type: z.literal('connect'),
  id: z.string().min(1),
  params: z.object({
    clientType: z.enum(['web', 'cli', 'node', 'mobile']),
    clientVersion: z.string().min(1),
    deviceId: z.string().min(1),
    token: z.string().min(1).optional(),
    capabilities: z.array(z.string()).optional(),
  }),
});

const GatewayRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});

const ChatStreamRequestSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1),
  modelId: z.string().optional(),
});

const RunWorkflowRequestSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  sessionId: z.string().optional(),
});

const WatchSessionRequestSchema = z.object({
  sessionId: z.string().min(1),
});

const CreateSessionRequestSchema = z.object({
  title: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});

const SessionIdentitySchema = z.object({
  sessionId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
}).refine((value) => Boolean(value.sessionId || value.id), {
  message: 'sessionId or id is required',
});

const IncomingMessageSchema = z.discriminatedUnion('type', [
  ConnectRequestSchema,
  GatewayRequestSchema,
]);

const WS_METHOD_SCOPES: Record<string, readonly string[]> = {
  'sessions.list': [Scope.SessionsRead],
  'sessions.create': [Scope.SessionsWrite],
  'sessions.get': [Scope.SessionsRead],
  'sessions.delete': [Scope.SessionsWrite],
  'sessions.watch': [Scope.SessionsRead],
  'sessions.unwatch': [Scope.SessionsRead],
  'models.list': [Scope.ModelsRead],
  'models.capabilities': [Scope.ModelsRead],
  'channels.list': [Scope.ChannelsRead],
  'chat.stream': [Scope.ChatStream, Scope.MessagesWrite],
  'workflow.list': [Scope.WorkflowRead],
  'workflow.run': [Scope.WorkflowRun],
};

interface ConnectedClient {
  socket: WebSocket;
  clientId: string;
  deviceId: string;
  clientType: string;
  authenticated: boolean;
  userId?: string;
  scopes: string[];
  watchedSessionId?: string;
  connectedAt: Date;
  lastSeenAt: number;
  isAlive: boolean;
}

interface WsErrorPayload {
  code: string;
  message: string;
  requestId?: string;
}

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

export async function setupWebSocketRoutes(
  fastify: FastifyInstance,
  options: GatewayOptions
): Promise<void> {
  const clients = new Map<string, ConnectedClient>();
  const clientsByDeviceId = new Map<string, string>();
  const sessionWatchers = new Map<string, Set<string>>();
  const tokenManager = getTokenManager();
  const chatService = new ChatService(fastify.sessionManager, fastify.messageManager);
  recordWsConnectedClients(0);

  const watchSession = (client: ConnectedClient, sessionId: string) => {
    if (client.watchedSessionId === sessionId) {
      return;
    }

    if (client.watchedSessionId) {
      const previousWatchers = sessionWatchers.get(client.watchedSessionId);
      previousWatchers?.delete(client.clientId);
      if (previousWatchers && previousWatchers.size === 0) {
        sessionWatchers.delete(client.watchedSessionId);
      }
    }

    const watchers = sessionWatchers.get(sessionId) ?? new Set<string>();
    watchers.add(client.clientId);
    sessionWatchers.set(sessionId, watchers);
    client.watchedSessionId = sessionId;
  };

  const unwatchClient = (client: ConnectedClient) => {
    if (!client.watchedSessionId) {
      return;
    }

    const watchers = sessionWatchers.get(client.watchedSessionId);
    watchers?.delete(client.clientId);
    if (watchers && watchers.size === 0) {
      sessionWatchers.delete(client.watchedSessionId);
    }
    client.watchedSessionId = undefined;
  };

  const broadcastSessionEvent = (sessionId: string, payload: unknown) => {
    const watcherIds = sessionWatchers.get(sessionId);
    if (!watcherIds || watcherIds.size === 0) {
      return;
    }

    for (const watcherId of watcherIds) {
      const watcher = clients.get(watcherId);
      if (!watcher) {
        watcherIds.delete(watcherId);
        continue;
      }
      sendJson(watcher.socket, payload);
    }

    if (watcherIds.size === 0) {
      sessionWatchers.delete(sessionId);
    }
  };

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();

    for (const [clientId, client] of clients.entries()) {
      const isTimedOut = now - client.lastSeenAt > HEARTBEAT_TIMEOUT_MS;

      if (!client.isAlive || isTimedOut) {
        logger.info({ clientId, deviceId: client.deviceId }, 'Closing stale WebSocket client');
        client.socket.terminate();
        unwatchClient(client);
        clients.delete(clientId);
        recordWsConnectedClients(clients.size);
        if (clientsByDeviceId.get(client.deviceId) === clientId) {
          clientsByDeviceId.delete(client.deviceId);
        }
        continue;
      }

      client.isAlive = false;
      try {
        client.socket.ping();
      } catch (error) {
        logger.warn({ err: error, clientId }, 'WebSocket ping failed');
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  fastify.addHook('onClose', (_instance, done) => {
    clearInterval(heartbeatTimer);
    done();
  });

  fastify.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const requestIp = req.socket.remoteAddress || 'unknown';
    const requestPort = req.socket.remotePort || 0;
    const clientId = `${requestIp}:${requestPort}:${Date.now()}`;
    logger.info({ clientId }, 'WebSocket connected');

    let client: ConnectedClient | undefined;

    socket.on('pong', () => {
      if (!client) return;
      client.isAlive = true;
      client.lastSeenAt = Date.now();
    });

    socket.on('message', async (rawData) => {
      await withLogContext(
        {
          clientId,
          traceId: clientId,
        },
        async () => {
          try {
            const rawDataSize =
              typeof rawData === 'string'
                ? Buffer.byteLength(rawData)
                : Array.isArray(rawData)
                  ? rawData.reduce((size, chunk) => size + chunk.length, 0)
                  : rawData.byteLength;
            if (rawDataSize > MAX_WS_MESSAGE_BYTES) {
              recordWsMessage({ direction: 'in', messageType: 'message', outcome: 'error' });
              sendWsError(socket, {
                code: 'message_too_large',
                message: `Message exceeds ${MAX_WS_MESSAGE_BYTES} bytes`,
              });
              return;
            }

            const rawDataString =
              typeof rawData === 'string'
                ? rawData
                : Array.isArray(rawData)
                  ? Buffer.concat(rawData).toString()
                  : Buffer.isBuffer(rawData)
                    ? rawData.toString()
                    : Buffer.from(new Uint8Array(rawData)).toString();
            const raw = JSON.parse(rawDataString);
            const parsed = IncomingMessageSchema.safeParse(raw);

            if (!parsed.success) {
              recordWsMessage({ direction: 'in', messageType: 'message', outcome: 'error' });
              sendWsError(socket, {
                code: 'invalid_message',
                message: parsed.error.issues.map((issue) => issue.message).join('; '),
              });
              return;
            }

            setLogContext({
              requestId: parsed.data.id,
              traceId: parsed.data.id,
            });
            recordWsMessage({
              direction: 'in',
              messageType: parsed.data.type,
              outcome: 'ok',
            });

            if (client) {
              client.isAlive = true;
              client.lastSeenAt = Date.now();
            }

            if (parsed.data.type === 'connect') {
              const connectResult = handleConnect(
                parsed.data,
                socket,
                clientId,
                clients,
                clientsByDeviceId,
                options,
                tokenManager
              );

              if (!connectResult.ok) {
                sendJson(socket, connectResult.response);
                socket.close(1008, connectResult.response.error || 'Authentication failed');
                return;
              }

              client = connectResult.client;
              setLogContext({
                userId: client.userId,
              });
              recordWsConnectedClients(clients.size);
              sendJson(socket, connectResult.response);

              logger.info(
                {
                  clientId,
                  deviceId: client.deviceId,
                  authenticated: client.authenticated,
                  userId: client.userId,
                  recovered: connectResult.response.payload.recovered,
                },
                'WebSocket handshake success'
              );
              return;
            }

            if (!client) {
              sendWsError(socket, {
                code: 'not_connected',
                message: 'Handshake required before sending requests',
                requestId: parsed.data.id,
              });
              return;
            }

            const response = await handleRequest(
              parsed.data as GatewayRequest,
              options,
              chatService,
              client,
              watchSession,
              unwatchClient,
              broadcastSessionEvent
            );
            if (response) {
              sendJson(socket, response);
            }
          } catch (error) {
            recordWsMessage({ direction: 'in', messageType: 'message', outcome: 'error' });
            reportError(error, {
              area: 'ws.message',
              tags: {
                client_id: clientId,
              },
            });
            logger.error({ err: error }, 'WebSocket message handling error');
            sendWsError(socket, {
              code: 'internal_error',
              message: error instanceof Error ? error.message : 'Unknown WebSocket error',
            });
          }
        }
      );
    });

    socket.on('close', () => {
      if (client) {
        unwatchClient(client);
        clients.delete(client.clientId);
        recordWsConnectedClients(clients.size);
        if (clientsByDeviceId.get(client.deviceId) === client.clientId) {
          clientsByDeviceId.delete(client.deviceId);
        }
      }
      logger.info({ clientId }, 'WebSocket disconnected');
    });

    socket.on('error', (error: Error) => {
      reportError(error, {
        area: 'ws.socket',
        tags: {
          client_id: clientId,
        },
      });
      logger.error({ err: error, clientId }, 'WebSocket socket error');
    });
  });

  logger.debug('WebSocket routes registered');
}

function sendJson(socket: WebSocket, payload: unknown): void {
  const messageType = getWsPayloadType(payload);
  if (socket.readyState !== WebSocket.OPEN) {
    recordWsMessage({ direction: 'out', messageType, outcome: 'dropped' });
    return;
  }
  socket.send(JSON.stringify(payload));
  recordWsMessage({ direction: 'out', messageType, outcome: 'ok' });
}

function sendWsError(socket: WebSocket, payload: WsErrorPayload): void {
  recordWsError(payload.code);
  sendJson(socket, {
    type: 'error',
    error: payload,
  });
}

function getWsPayloadType(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('type' in payload)) {
    return 'unknown';
  }
  const type = (payload as { type?: unknown }).type;
  return typeof type === 'string' ? type : 'unknown';
}

function handleConnect(
  connectMsg: ConnectRequest,
  socket: WebSocket,
  clientId: string,
  clients: Map<string, ConnectedClient>,
  clientsByDeviceId: Map<string, string>,
  options: GatewayOptions,
  tokenManager: ReturnType<typeof getTokenManager>
):
  | {
      ok: true;
      client: ConnectedClient;
      response: {
        type: 'connect';
        id: string;
        ok: true;
        payload: {
          serverVersion: string;
          sessionToken?: string;
          authenticated: boolean;
          recovered: boolean;
          scopes: string[];
          config: {
            models: string[];
            channels: string[];
          };
        };
      };
    }
  | {
      ok: false;
      response: {
        type: 'connect';
        id: string;
        ok: false;
        error: string;
      };
    } {
  const authConfig = options.configManager.get().auth;
  let authenticated = false;
  let userId: string | undefined;
  let sessionToken: string | undefined;
  let scopes: string[] = [];

  if (authConfig.type === 'none') {
    authenticated = true;
    userId = 'anonymous';
    scopes = [ADMIN_SCOPE];
  } else if (connectMsg.params.token) {
    const payload = tokenManager.validateToken(connectMsg.params.token);
    if (!payload) {
      return {
        ok: false,
        response: {
          type: 'connect',
          id: connectMsg.id,
          ok: false,
          error: 'Invalid or expired token',
        },
      };
    }
    authenticated = true;
    userId = payload.userId;
    sessionToken = connectMsg.params.token;
    scopes = payload.scopes;
  } else if (authConfig.token) {
    return {
      ok: false,
      response: {
        type: 'connect',
        id: connectMsg.id,
        ok: false,
        error: 'Authentication token required',
      },
    };
  } else {
    scopes = [...USER_DEFAULT_SCOPES];
  }

  const previousClientId = clientsByDeviceId.get(connectMsg.params.deviceId);
  const recovered = Boolean(previousClientId && previousClientId !== clientId);
  // Keep existing sockets alive for the same device.
  // This avoids reconnection storms when users open multiple tabs.

  const nextClient: ConnectedClient = {
    socket,
    clientId,
    deviceId: connectMsg.params.deviceId,
    clientType: connectMsg.params.clientType,
    authenticated,
    userId,
    scopes,
    connectedAt: new Date(),
    lastSeenAt: Date.now(),
    isAlive: true,
  };

  clients.set(clientId, nextClient);
  clientsByDeviceId.set(connectMsg.params.deviceId, clientId);

  return {
    ok: true,
    client: nextClient,
    response: {
      type: 'connect',
      id: connectMsg.id,
      ok: true,
      payload: {
        serverVersion: '0.1.0',
        sessionToken,
        authenticated,
        recovered,
        scopes,
        config: {
          models: options.configManager.get().models.map((model) => model.id),
          channels: options.configManager.get().channels.map((channel) => channel.id),
        },
      },
    },
  };
}

async function handleRequest(
  request: GatewayRequest,
  options: GatewayOptions,
  chatService: ChatService,
  client: ConnectedClient,
  watchSession: (client: ConnectedClient, sessionId: string) => void,
  unwatchSession: (client: ConnectedClient) => void,
  broadcastSessionEvent: (sessionId: string, payload: unknown) => void
): Promise<GatewayResponse | null> {
  const { id, method, params } = request;
  const requiredScopes = WS_METHOD_SCOPES[method];

  if (requiredScopes && !hasAllScopes(client.scopes, requiredScopes)) {
    return {
      type: 'res',
      id,
      ok: false,
      error: `Insufficient scope for method ${method}. Required: ${requiredScopes.join(', ')}`,
    };
  }

  try {
    switch (method) {
      case 'health':
        return { type: 'res', id, ok: true, payload: { status: 'healthy' } };

      case 'status':
        return {
          type: 'res',
          id,
          ok: true,
          payload: {
            version: '0.1.0',
            uptime: process.uptime(),
          },
        };

      case 'sessions.create': {
        const payload = CreateSessionRequestSchema.safeParse(params ?? {});
        if (!payload.success) {
          return {
            type: 'res',
            id,
            ok: false,
            error: payload.error.issues.map((issue) => issue.message).join('; '),
          };
        }

        const config = options.configManager.get();
        if (payload.data.modelId && !hasEnabledModel(config, payload.data.modelId)) {
          return {
            type: 'res',
            id,
            ok: false,
            error: 'Invalid modelId',
          };
        }

        const session = await options.sessionManager.createSession({
          title: payload.data.title,
          modelId: payload.data.modelId ?? resolveDefaultModel(config),
          userId: client.userId,
        });

        return {
          type: 'res',
          id,
          ok: true,
          payload: { session },
        };
      }

      case 'sessions.get': {
        const payload = SessionIdentitySchema.safeParse(params ?? {});
        if (!payload.success) {
          return {
            type: 'res',
            id,
            ok: false,
            error: payload.error.issues.map((issue) => issue.message).join('; '),
          };
        }

        const sessionId = payload.data.sessionId ?? payload.data.id!;
        const session = await options.sessionManager.getSession(sessionId);
        if (!session) {
          return {
            type: 'res',
            id,
            ok: false,
            error: 'Session not found',
          };
        }

        return {
          type: 'res',
          id,
          ok: true,
          payload: {
            session: {
              ...session,
              messageCount: await options.messageManager.getMessageCount(session.id),
            },
          },
        };
      }

      case 'sessions.delete': {
        const payload = SessionIdentitySchema.safeParse(params ?? {});
        if (!payload.success) {
          return {
            type: 'res',
            id,
            ok: false,
            error: payload.error.issues.map((issue) => issue.message).join('; '),
          };
        }

        const sessionId = payload.data.sessionId ?? payload.data.id!;
        await options.sessionManager.deleteSession(sessionId);
        if (client.watchedSessionId === sessionId) {
          unwatchSession(client);
        }

        return {
          type: 'res',
          id,
          ok: true,
          payload: { sessionId, deleted: true },
        };
      }

      case 'sessions.list': {
        const sessions = await options.sessionManager.listSessions({
          userId: client.userId && client.userId !== 'anonymous' ? client.userId : undefined,
          limit: 100,
        });

        const sessionsWithCount = await Promise.all(
          sessions.map(async (session) => ({
            ...session,
            messageCount: await options.messageManager.getMessageCount(session.id),
          }))
        );

        return {
          type: 'res',
          id,
          ok: true,
          payload: { sessions: sessionsWithCount },
        };
      }

      case 'sessions.watch': {
        const payload = WatchSessionRequestSchema.safeParse(params);
        if (!payload.success) {
          return {
            type: 'res',
            id,
            ok: false,
            error: payload.error.issues.map((issue) => issue.message).join('; '),
          };
        }

        const session = await options.sessionManager.getSession(payload.data.sessionId);
        if (!session) {
          return {
            type: 'res',
            id,
            ok: false,
            error: 'Session not found',
          };
        }

        watchSession(client, payload.data.sessionId);
        return {
          type: 'res',
          id,
          ok: true,
          payload: { sessionId: payload.data.sessionId },
        };
      }

      case 'sessions.unwatch':
        unwatchSession(client);
        return {
          type: 'res',
          id,
          ok: true,
          payload: { sessionId: null },
        };

      case 'models.list': {
        const config = options.configManager.get();
        return {
          type: 'res',
          id,
          ok: true,
          payload: {
            models: config.models,
            defaultModel: resolveDefaultModel(config),
          },
        };
      }

      case 'models.capabilities': {
        const [builtinProviders, registeredProviders] = await Promise.all([
          getBuiltinProviderCapabilityMatrix(),
          options.modelRegistry.getCapabilityMatrix(),
        ]);
        const config = options.configManager.get();
        const merged = new Map<string, (typeof builtinProviders)[number]>();
        for (const provider of builtinProviders) {
          merged.set(provider.providerId, provider);
        }
        for (const provider of registeredProviders) {
          merged.set(provider.providerId, provider);
        }

        const providers = Array.from(merged.values())
          .map((provider) => ({
            ...provider,
            registered: options.modelRegistry.has(provider.providerId),
            configuredModels: config.models
              .filter((model) => model.provider === provider.providerId)
              .map((model) => model.id),
          }))
          .sort((a, b) => a.providerId.localeCompare(b.providerId));

        return {
          type: 'res',
          id,
          ok: true,
          payload: { providers },
        };
      }

      case 'channels.list':
        return {
          type: 'res',
          id,
          ok: true,
          payload: { channels: options.configManager.get().channels },
        };

      case 'chat.stream': {
        const payload = ChatStreamRequestSchema.safeParse(params);
        if (!payload.success) {
          return {
            type: 'res',
            id,
            ok: false,
            error: payload.error.issues.map((issue) => issue.message).join('; '),
          };
        }

        const requiresAuth = options.configManager.get().auth.type === 'token' && Boolean(options.configManager.get().auth.token);
        if (requiresAuth && !client.authenticated) {
          return {
            type: 'res',
            id,
            ok: false,
            error: 'Authentication required',
          };
        }

        const config = options.configManager.get();
        if (payload.data.modelId && !hasEnabledModel(config, payload.data.modelId)) {
          return {
            type: 'res',
            id,
            ok: false,
            error: 'Invalid modelId',
          };
        }

        watchSession(client, payload.data.sessionId);
        void streamChatResponse(payload.data, chatService, (eventPayload) => {
          broadcastSessionEvent(payload.data.sessionId, eventPayload);
        });
        return {
          type: 'res',
          id,
          ok: true,
          payload: { streaming: true },
        };
      }

      case 'workflow.list':
        return {
          type: 'res',
          id,
          ok: true,
          payload: { workflows: listWorkflowTemplates() },
        };

      case 'workflow.run': {
        const payload = RunWorkflowRequestSchema.safeParse(params);
        if (!payload.success) {
          return {
            type: 'res',
            id,
            ok: false,
            error: payload.error.issues.map((issue) => issue.message).join('; '),
          };
        }

        const config = options.configManager.get();
        let sessionId = payload.data.sessionId;
        if (!sessionId) {
          const session = await options.sessionManager.createSession({
            title: `工作流: ${payload.data.name}`,
            modelId: resolveDefaultModel(config),
            userId: client.userId,
          });
          sessionId = session.id;
        }

        const result = await chatService.executeWorkflow(payload.data.name, payload.data.params, sessionId);
        return {
          type: 'res',
          id,
          ok: true,
          payload: {
            sessionId,
            ...result,
          },
        };
      }

      default:
        return { type: 'res', id, ok: false, error: `Unknown method: ${method}` };
    }
  } catch (error) {
    reportError(error, {
      area: 'ws.request',
      tags: {
        method,
      },
      extra: {
        requestId: id,
      },
    });
    return {
      type: 'res',
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function streamChatResponse(
  params: z.infer<typeof ChatStreamRequestSchema>,
  chatService: ChatService,
  emit: (payload: unknown) => void
): Promise<void> {
  try {
    for await (const chunk of chatService.streamChat({
      sessionId: params.sessionId,
      content: params.content,
      modelId: params.modelId,
      onChunk: () => {},
      onError: () => {},
    })) {
      emit({
        type: 'event',
        event: 'chat.chunk',
        payload: {
          ...chunk,
          sessionId: params.sessionId,
        },
        timestamp: Date.now(),
      });
    }

    emit({
      type: 'event',
      event: 'chat.complete',
      payload: { done: true, sessionId: params.sessionId },
      timestamp: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reportError(error, {
      area: 'ws.chat_stream',
      tags: {
        session_id: params.sessionId,
      },
    });
    logger.error({ err: error, sessionId: params.sessionId }, 'Chat stream failed');

    emit({
      type: 'event',
      event: 'chat.error',
      payload: { error: message, sessionId: params.sessionId },
      timestamp: Date.now(),
    });
  }
}
