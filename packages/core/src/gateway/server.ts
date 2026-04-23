import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ConfigManager } from '../config/manager.js';
import type { DatabaseManager } from '../storage/db.js';
import { SessionManager } from '../storage/session.js';
import { MessageManager } from '../storage/message.js';
import { getTokenManager } from '../auth/token.js';
import { UserService } from '../auth/user-service.js';
import { RoleService } from '../auth/role-service.js';
import { AuthService } from '../auth/service.js';
import { OAuthService } from '../auth/oauth-service.js';
import { LDAPService } from '../auth/ldap-service.js';
import { SSOService } from '../auth/sso-service.js';
import { hashPassword } from '../auth/password.js';
import { setupWebSocketRoutes } from './websocket.js';
import { setupHttpRoutes } from './http.js';
import { logger } from '../utils/logger.js';
import { getModelRegistry, type ModelRegistry } from '../agent/model.js';
import { getDeepSeekProvider } from '../models/providers/deepseek.js';
import { getKimiProvider } from '../models/providers/kimi.js';
import { getOpenAIProvider } from '../models/providers/openai.js';
import { getOllamaProvider } from '../models/providers/ollama.js';
import { getQwenProvider } from '../models/providers/qwen.js';
import { getErnieProvider } from '../models/providers/ernie.js';
import { getDoubaoProvider } from '../models/providers/doubao.js';
import { registerBuiltinTools, getToolRegistry } from '../tools/index.js';
import type { ToolRegistry } from '../tools/registry.js';
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
import { getUploadService } from '../upload/index.js';
import { getStatsService, type StatsService } from '../stats/service.js';
import { getExportService } from '../export/service.js';
import { getImportService } from '../import/service.js';
import { AuditService } from '../audit/service.js';
import { WorkflowService } from '../workflows/service.js';
import { PluginManager } from '../plugins/manager.js';
import { PluginMarketService } from '../plugins/market-service.js';
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
  // Initialize auth services
  const tokenManager = getTokenManager(options.dbManager);
  const userService = new UserService(options.dbManager);
  const roleService = new RoleService(options.dbManager);
  const authService = new AuthService(userService, roleService, tokenManager);

  fastify.decorate('tokenManager', tokenManager);
  fastify.decorate('userService', userService);
  fastify.decorate('roleService', roleService);
  fastify.decorate('authService', authService);

  const oauthService = new OAuthService(options.dbManager, userService, roleService, tokenManager);
  const ldapService = new LDAPService(userService, roleService, tokenManager);
  const ssoService = new SSOService(oauthService, ldapService);
  fastify.decorate('oauthService', oauthService);
  fastify.decorate('ldapService', ldapService);
  fastify.decorate('ssoService', ssoService);
  fastify.decorate('modelRegistry', modelRegistry);
  fastify.decorate('uploadService', getUploadService());
  fastify.decorate('statsService', getStatsService(options.dbManager, options.configManager));
  fastify.decorate('exportService', getExportService(options.dbManager, options.configManager, fastify.uploadService));
  fastify.decorate('importService', getImportService(options.dbManager));

  // Plugin manager
  const pluginManager = new PluginManager(
    {
      modelRegistry,
      toolRegistry: getToolRegistry(),
      channelRegistry: getChannelRegistry(),
      configManager: options.configManager,
      dbManager: options.dbManager,
      sessionManager,
      messageManager,
      logger,
    },
    options.dbManager
  );

  // Plugin market service
  const pluginMarketService = new PluginMarketService(options.dbManager, {
    registryUrl: options.configManager.get().plugins?.registryUrl,
  });

  const auditService = new AuditService(options.dbManager);
  const workflowService = new WorkflowService(options.dbManager);
  fastify.decorate('auditService', auditService);
  fastify.decorate('workflowService', workflowService);
  fastify.decorate('pluginManager', pluginManager);
  fastify.decorate('pluginMarketService', pluginMarketService);

  // Register plugins
  async function registerPlugins() {
    // CORS
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });

    // WebSocket support
    await fastify.register(websocket);

    // Multipart file upload support
    await fastify.register(multipart, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    });

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

    // Static files (Uploads)
    const uploadService = getUploadService();
    try {
      await fastify.register(staticPlugin, {
        root: uploadService.getUploadsDir(),
        prefix: '/uploads',
        decorateReply: false,
      });
    } catch {
      logger.warn('Uploads directory not available');
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

    // Register Ollama (local models)
    const ollamaConfig = config.models.find(m => m.provider === 'ollama');
    const ollama = getOllamaProvider();
    if (ollamaConfig?.baseUrl) {
      ollama.configure({ baseUrl: ollamaConfig.baseUrl });
    }
    if (await ollama.validateConfig()) {
      modelRegistry.register(ollama);
      logger.info('Registered Ollama provider');
    } else {
      logger.warn('Ollama not available, provider disabled');
    }

    // Register Qwen (通义千问)
    const qwenConfig = config.models.find(m => m.provider === 'qwen');
    const qwen = getQwenProvider();
    if (qwenConfig?.apiKey) {
      qwen.configure({ apiKey: qwenConfig.apiKey });
    }
    if (await qwen.validateConfig()) {
      modelRegistry.register(qwen);
      logger.info('Registered Qwen provider');
    } else {
      logger.warn('Qwen API key not configured, provider disabled');
    }

    // Register ERNIE (文心一言)
    const ernieConfig = config.models.find(m => m.provider === 'ernie');
    const ernie = getErnieProvider();
    if (ernieConfig?.apiKey) {
      ernie.configure({ apiKey: ernieConfig.apiKey });
    }
    if (await ernie.validateConfig()) {
      modelRegistry.register(ernie);
      logger.info('Registered ERNIE provider');
    } else {
      logger.warn('ERNIE API key not configured, provider disabled');
    }

    // Register Doubao (豆包)
    const doubaoConfig = config.models.find(m => m.provider === 'doubao');
    const doubao = getDoubaoProvider();
    if (doubaoConfig?.apiKey) {
      doubao.configure({ apiKey: doubaoConfig.apiKey });
    }
    if (await doubao.validateConfig()) {
      modelRegistry.register(doubao);
      logger.info('Registered Doubao provider');
    } else {
      logger.warn('Doubao API key not configured, provider disabled');
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
      dbManager: gatewayOptions.dbManager,
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
      // Clean up expired oauth states periodically
      setInterval(() => {
        oauthService.cleanupStates();
      }, 15 * 60 * 1000); // Every 15 minutes
      oauthService.cleanupStates();

      // Initialize builtin roles
      await roleService.initBuiltinRoles();

      // Create default admin user if no users exist and master password is configured
      const existingUsers = await userService.listUsers();
      if (existingUsers.length === 0) {
        const config = options.configManager.get();
        const masterPassword = config.auth?.token;
        if (masterPassword && config.auth?.type === 'token') {
          const adminRole = await roleService.getRoleByName('admin');
          await userService.createUser({
            name: 'Admin',
            email: 'admin@local',
            password: masterPassword,
            roleId: adminRole?.id,
          });
          logger.info('Created default admin user from config master password');
        }
      }

      await registerProviders();
      await initializeChannels();
      await registerPlugins();
      await setupRoutes();
      await pluginManager.loadAll();
      
      await fastify.listen({
        port: options.port,
        host: options.host,
      });
    },

    async stop() {
      await pluginManager.stopAll();

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
    uploadService: ReturnType<typeof getUploadService>;
    statsService: StatsService;
    exportService: ReturnType<typeof getExportService>;
    importService: ReturnType<typeof getImportService>;
    userService: UserService;
    roleService: RoleService;
    authService: AuthService;
    auditService: AuditService;
    workflowService: WorkflowService;
    oauthService: OAuthService;
    ldapService: LDAPService;
    ssoService: SSOService;
    pluginManager: import('../plugins/manager.js').PluginManager;
    pluginMarketService: import('../plugins/market-service.js').PluginMarketService;
  }
}
