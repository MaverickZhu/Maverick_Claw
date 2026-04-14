import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ConfigManager } from '../config/manager.js';
import type { DatabaseManager } from '../storage/db.js';
import { SessionManager } from '../storage/session.js';
import { MessageManager } from '../storage/message.js';
import { getTokenManager } from '../auth/token.js';
import { setupWebSocketRoutes } from './websocket.js';
import { setupHttpRoutes } from './http.js';
import { logger } from '../utils/logger.js';
import { getModelRegistry, type ModelRegistry } from '../agent/model.js';
import { getDeepSeekProvider } from '../models/providers/deepseek.js';
import { getKimiProvider } from '../models/providers/kimi.js';
import { getOpenAIProvider } from '../models/providers/openai.js';
import { registerBuiltinTools, getToolRegistry } from '../tools/index.js';
import { 
  getChannelRegistry, 
  ChannelRouter, 
  WebhookAdapter, 
  LarkAdapter,
  DingTalkAdapter,
  getChannelSessionManager,
  ChannelAgentBridge,
  type ChannelAdapter,
  type ChannelMessage,
  parseChannelConfig,
} from '../channels/index.js';
import { getQueueService, createMessageProcessor, closeQueueService } from '../queue/index.js';
import { reportError } from '../monitoring/error-tracking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GatewayOptions {
  port: number;
  host: string;
  configManager: ConfigManager;
  dbManager: DatabaseManager;
  sessionManager: SessionManager;
  messageManager: MessageManager;
  modelRegistry: ModelRegistry;
}

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createGatewayServer(gatewayOptions: Omit<GatewayOptions, 'sessionManager' | 'messageManager' | 'modelRegistry'>): GatewayServer {
  const fastify = Fastify({
    logger: false, // Use our own logger
  });

  // Create shared managers
  const sessionManager = new SessionManager(gatewayOptions.dbManager);
  const messageManager = new MessageManager(gatewayOptions.dbManager);
  const modelRegistry = getModelRegistry();

  // Create full options
  const options: GatewayOptions = {
    ...gatewayOptions,
    sessionManager,
    messageManager,
    modelRegistry,
  };

  // Store managers for access in routes
  fastify.decorate('configManager', options.configManager);
  fastify.decorate('dbManager', options.dbManager);
  fastify.decorate('sessionManager', sessionManager);
  fastify.decorate('messageManager', messageManager);
  fastify.decorate('tokenManager', getTokenManager());
  fastify.decorate('modelRegistry', modelRegistry);

  // Register plugins
  async function registerPlugins() {
    // CORS
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });

    // WebSocket support
    await fastify.register(websocket);

    // Static files (Web UI)
    const webUiPath = path.resolve(__dirname, '../../../web-ui/dist');
    try {
      await fastify.register(staticPlugin, {
        root: webUiPath,
        prefix: '/',
        wildcard: false,
      });
      logger.info('Web UI served from: ' + webUiPath);
    } catch {
      logger.warn('Web UI build not found, serving API only');
    }
  }

  // Setup routes
  async function setupRoutes() {
    // HTTP API routes
    await setupHttpRoutes(fastify);

    // WebSocket routes
    await setupWebSocketRoutes(fastify, options);

    // Catch-all for SPA routing
    fastify.get('*', async (request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        reply.callNotFound();
        return;
      }
      try {
        await reply.sendFile('index.html');
      } catch {
        // Web UI not built, return API info
        reply.status(200).send({
          name: 'Maverick Claw Gateway',
          version: '0.1.0',
          status: 'running',
          api: '/api',
          health: '/api/health',
          websocket: '/ws',
          message: 'Web UI not built. Please build the web-ui package or use API directly.'
        });
      }
    });
  }

  // Register model providers and tools
  async function registerProviders() {
    // Register built-in tools
    registerBuiltinTools();

    // Get config for API keys
    const config = options.configManager.get();

    // Register DeepSeek
    const deepseekConfig = config.models.find(m => m.provider === 'deepseek');
    const deepseek = getDeepSeekProvider();
    if (deepseekConfig?.apiKey) {
      deepseek.configure({ apiKey: deepseekConfig.apiKey });
    }
    if (await deepseek.validateConfig()) {
      modelRegistry.register(deepseek);
      logger.info('Registered DeepSeek provider');
    } else {
      logger.warn('DeepSeek API key not configured, provider disabled');
    }

    // Register OpenAI-compatible provider
    const openaiConfig = config.models.find(m => m.provider === 'openai');
    const openai = getOpenAIProvider();
    if (openaiConfig) {
      openai.configure({
        apiKey: openaiConfig.apiKey,
        baseUrl: openaiConfig.baseUrl,
        model: openaiConfig.id,
      });
    }
    if (await openai.validateConfig()) {
      modelRegistry.register(openai);
      logger.info('Registered OpenAI-compatible provider');
    } else {
      logger.warn('OpenAI API key not configured, provider disabled');
    }

    // Register Kimi (Moonshot AI)
    const kimiConfig = config.models.find(m => m.provider === 'kimi');
    const kimi = getKimiProvider();
    if (kimiConfig?.apiKey) {
      kimi.configure({ apiKey: kimiConfig.apiKey });
    }
    if (await kimi.validateConfig()) {
      modelRegistry.register(kimi);
      logger.info('Registered Kimi (Moonshot AI) provider');
    } else {
      logger.warn('Kimi API key not configured, provider disabled');
    }
  }

  // Initialize channel adapters
  async function initializeChannels() {
    const channelRegistry = getChannelRegistry();
    const config = gatewayOptions.configManager.get();

    // Get default model for channel processing
    const defaultModel = config.models.find(m => m.enabled) || config.models[0];
    if (!defaultModel) {
      logger.warn('No models configured, channel processing disabled');
      return;
    }

    const modelProvider = modelRegistry.get(defaultModel.provider);
    if (!modelProvider) {
      logger.warn({ provider: defaultModel.provider }, 'Default model provider not found');
      return;
    }

    // Initialize channel session manager
    const channelSessionManager = getChannelSessionManager({
      sessionManager,
      defaultModelId: `${defaultModel.provider}:${defaultModel.id}`,
    });

    // Create bridge for processing messages
    const bridge = new ChannelAgentBridge({
      messageManager,
      channelSessionManager,
      modelProvider,
      modelId: `${defaultModel.provider}:${defaultModel.id}`,
    });

    // Initialize queue service
    const queueService = getQueueService();
    
    // Register message processor worker
    queueService.registerProcessor(
      'messages',
      createMessageProcessor({
        channelRegistry,
        bridge,
      }),
      { concurrency: 5 }
    );

    logger.info('Message queue processor registered');

    const bindQueueMessageHandler = (adapter: ChannelAdapter): void => {
      adapter.onMessage(async (message: ChannelMessage) => {
        logger.debug(
          {
            adapterId: adapter.id,
            userId: message.userId,
            content: message.content.substring(0, 50),
          },
          'Channel message received, enqueueing for processing'
        );

        try {
          const routingMetadata = {
            isGroup: message.isGroup,
            groupId: message.groupId,
            userName: message.userName,
            mentions: message.mentions,
            metadata: message.metadata,
          };

          await queueService.addJob('messages', {
            type: 'incoming',
            channelId: message.channelId,
            userId: message.userId,
            content: message.content,
            messageId: message.id,
            metadata: routingMetadata,
            timestamp: message.timestamp.getTime(),
          });
        } catch (error) {
          reportError(error, {
            area: 'queue.enqueue',
            tags: {
              queue: 'messages',
              channel_id: message.channelId,
            },
            extra: {
              messageId: message.id,
            },
          });
          logger.error({ err: error, messageId: message.id }, 'Failed to enqueue message');
        }
      });
    };

    // Initialize inbound channel adapters from config
    for (const channelConfig of config.channels) {
      if (!channelConfig.enabled) continue;

      try {
        const channelType = channelConfig.type as string;

        // Support both 'custom' and 'webhook' types
        if (channelType === 'custom' || channelType === 'webhook') {
          const webhookConfig = parseChannelConfig('webhook', channelConfig.config || {});
          const adapter = new WebhookAdapter(
            channelConfig.id,
            channelConfig.name || channelConfig.id,
            {
              webhookPath: `/api/webhooks/${channelConfig.id}`,
              secret: webhookConfig.secret as string | undefined,
              verifySignature: webhookConfig.verifySignature as boolean | undefined,
            }
          );

          channelRegistry.register(adapter, channelConfig);
          bindQueueMessageHandler(adapter);

          await adapter.initialize(channelConfig.config || {});
          if (channelConfig.enabled) {
            await adapter.start();
          }

          logger.info(`Initialized webhook adapter: ${channelConfig.id} with queue processing`);
          continue;
        }

        if (channelType === 'lark') {
          const larkConfig = parseChannelConfig('lark', channelConfig.config || {});
          const adapter = new LarkAdapter(channelConfig.id, channelConfig.name || channelConfig.id, {
            webhookPath: `/api/webhooks/${channelConfig.id}`,
            appId: larkConfig.appId as string | undefined,
            appSecret: larkConfig.appSecret as string | undefined,
            verificationToken: larkConfig.verificationToken as string | undefined,
            botWebhookUrl: larkConfig.botWebhookUrl as string | undefined,
            botWebhookSecret: larkConfig.botWebhookSecret as string | undefined,
          });

          channelRegistry.register(adapter, channelConfig);
          bindQueueMessageHandler(adapter);

          await adapter.initialize(channelConfig.config || {});
          await adapter.start();

          logger.info(`Initialized lark adapter: ${channelConfig.id} with queue processing`);
          continue;
        }

        if (channelType === 'dingtalk') {
          const dingtalkConfig = parseChannelConfig('dingtalk', channelConfig.config || {});
          const adapter = new DingTalkAdapter(channelConfig.id, channelConfig.name || channelConfig.id, {
            webhookPath: `/api/webhooks/${channelConfig.id}`,
            verificationToken: dingtalkConfig.verificationToken as string | undefined,
            outgoingWebhookUrl: dingtalkConfig.outgoingWebhookUrl as string | undefined,
            outgoingSecret: dingtalkConfig.outgoingSecret as string | undefined,
          });

          channelRegistry.register(adapter, channelConfig);
          bindQueueMessageHandler(adapter);

          await adapter.initialize(channelConfig.config || {});
          await adapter.start();

          logger.info(`Initialized dingtalk adapter: ${channelConfig.id} with queue processing`);
        }
      } catch (error) {
        reportError(error, {
          area: 'channel.initialize',
          tags: {
            channel_id: channelConfig.id,
          },
        });
        logger.error({ err: error, channelId: channelConfig.id }, 'Failed to initialize channel adapter');
      }
    }

    // Setup channel router
    const router = new ChannelRouter(channelRegistry);
    router.setupListeners();

    // Start cleanup job for expired sessions
    setInterval(() => {
      channelSessionManager.cleanup();
    }, 60 * 60 * 1000); // Every hour
  }

  return {
    async start() {
      await registerProviders();
      await initializeChannels();
      await registerPlugins();
      await setupRoutes();
      
      await fastify.listen({
        port: options.port,
        host: options.host,
      });
    },

    async stop() {
      // Close queue service gracefully
      try {
        await closeQueueService();
        logger.info('Queue service closed');
      } catch (error) {
        reportError(error, {
          area: 'queue.shutdown',
        });
        logger.error({ err: error }, 'Error closing queue service');
      }
      
      await fastify.close();
    },
  };
}

// Type declarations for decorated properties
declare module 'fastify' {
  interface FastifyInstance {
    configManager: ConfigManager;
    dbManager: DatabaseManager;
    sessionManager: SessionManager;
    messageManager: MessageManager;
    tokenManager: ReturnType<typeof getTokenManager>;
    modelRegistry: ModelRegistry;
  }
}
