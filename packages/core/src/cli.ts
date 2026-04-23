#!/usr/bin/env node
import { createGatewayServer } from './gateway/server.js';
import { ConfigManager } from './config/manager.js';
import { initDatabase } from './storage/db.js';
import { getTokenManager } from './auth/token.js';
import { getModelRegistry } from './agent/model.js';
import { getDeepSeekProvider } from './models/providers/deepseek.js';
import { getOpenAIProvider } from './models/providers/openai.js';
import { getOllamaProvider } from './models/providers/ollama.js';
import { getQwenProvider } from './models/providers/qwen.js';
import { getErnieProvider } from './models/providers/ernie.js';
import { getDoubaoProvider } from './models/providers/doubao.js';
import { logger } from './utils/logger.js';
import cron from 'node-cron';
import {
  flushErrorTracking,
  initErrorTracking,
  reportError,
} from './monitoring/error-tracking.js';

const DEFAULT_PORT = 18789;
const DEFAULT_HOST = '127.0.0.1';

export async function main() {
  try {
    await initErrorTracking({
      serviceName: 'maverick-claw-gateway',
      release: 'maverick-claw@1.0.0',
    });

    // Load configuration
    const configManager = new ConfigManager();
    await configManager.load();
    
    const config = configManager.get();
    const port = config.port || DEFAULT_PORT;
    const host = config.host || DEFAULT_HOST;

    // Initialize database
    const dbManager = await initDatabase();
    logger.info('Database connected');

    // Initialize model providers
    const modelRegistry = getModelRegistry();
    
    // Register DeepSeek if API key is configured
    const deepseekConfig = config.models.find(m => m.provider === 'deepseek');
    if (deepseekConfig?.apiKey) {
      const deepseek = getDeepSeekProvider({
        apiKey: deepseekConfig.apiKey,
        baseUrl: deepseekConfig.baseUrl,
      });
      modelRegistry.register(deepseek);
    }

    // Register OpenAI-compatible provider if API key is configured
    const openaiConfig = config.models.find(m => m.provider === 'openai');
    if (openaiConfig?.apiKey) {
      const openai = getOpenAIProvider({
        apiKey: openaiConfig.apiKey,
        baseUrl: openaiConfig.baseUrl,
        model: openaiConfig.id,
      });
      modelRegistry.register(openai);
    }

    // Register Ollama if available
    const ollama = getOllamaProvider();
    if (await ollama.validateConfig()) {
      modelRegistry.register(ollama);
      logger.info('Registered Ollama provider');
    }

    // Register Qwen if API key is configured
    const qwenConfig = config.models.find(m => m.provider === 'qwen');
    if (qwenConfig?.apiKey) {
      const qwen = getQwenProvider({
        apiKey: qwenConfig.apiKey,
        baseUrl: qwenConfig.baseUrl,
      });
      modelRegistry.register(qwen);
      logger.info('Registered Qwen provider');
    }

    // Register ERNIE if API key is configured
    const ernieConfig = config.models.find(m => m.provider === 'ernie');
    if (ernieConfig?.apiKey) {
      const ernie = getErnieProvider({
        apiKey: ernieConfig.apiKey,
        baseUrl: ernieConfig.baseUrl,
      });
      modelRegistry.register(ernie);
      logger.info('Registered ERNIE provider');
    }

    // Register Doubao if API key is configured
    const doubaoConfig = config.models.find(m => m.provider === 'doubao');
    if (doubaoConfig?.apiKey) {
      const doubao = getDoubaoProvider({
        apiKey: doubaoConfig.apiKey,
        baseUrl: doubaoConfig.baseUrl,
      });
      modelRegistry.register(doubao);
      logger.info('Registered Doubao provider');
    }

    // Start token cleanup job
    const tokenManager = getTokenManager();
    cron.schedule('0 */6 * * *', () => {
      tokenManager.cleanup();
    });

    // Create and start gateway
    const gateway = createGatewayServer({
      port,
      host,
      configManager,
      dbManager,
    });

    await gateway.start();

    logger.info(`🦅 Maverick_Claw Gateway v1.0.0 started`);
    logger.info(`   Web UI: http://${host}:${port}`);
    logger.info(`   API: http://${host}:${port}/api`);
    logger.info(`   WebSocket: ws://${host}:${port}/ws`);
    logger.info(`   Press Ctrl+C to stop`);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('\nShutting down gracefully...');
      await gateway.stop();
      await dbManager.close();
      await flushErrorTracking();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await gateway.stop();
      await dbManager.close();
      await flushErrorTracking();
      process.exit(0);
    });

  } catch (error) {
    reportError(error, { area: 'gateway.startup' });
    await flushErrorTracking();
    logger.error({ err: error }, 'Failed to start gateway');
    process.exit(1);
  }
}

main();
