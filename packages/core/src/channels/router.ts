import type { ChannelAdapter, ChannelMessage, SendMessageOptions, ChannelResponse } from './types.js';
import { ChannelRegistry, getChannelRegistry } from './registry.js';
import { logger } from '../utils/logger.js';

export interface RouteHandler {
  (message: ChannelMessage, context: RouteContext): Promise<string | void> | string | void;
}

export interface RouteContext {
  adapter: ChannelAdapter;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RouteRule {
  id: string;
  priority: number;
  condition: (message: ChannelMessage) => boolean;
  handler: RouteHandler;
}

export class ChannelRouter {
  private registry: ChannelRegistry;
  private routes: RouteRule[] = [];
  private defaultHandler?: RouteHandler;
  private messageHandlers: Array<(message: ChannelMessage, context: RouteContext) => void> = [];

  constructor(registry?: ChannelRegistry) {
    this.registry = registry || getChannelRegistry();
  }

  // Route registration
  addRoute(route: RouteRule): void {
    this.routes.push(route);
    this.routes.sort((a, b) => b.priority - a.priority);
    logger.debug(`Added route: ${route.id} (priority: ${route.priority})`);
  }

  removeRoute(routeId: string): boolean {
    const index = this.routes.findIndex(r => r.id === routeId);
    if (index >= 0) {
      this.routes.splice(index, 1);
      logger.debug(`Removed route: ${routeId}`);
      return true;
    }
    return false;
  }

  setDefaultHandler(handler: RouteHandler): void {
    this.defaultHandler = handler;
  }

  // Global message handlers
  onMessage(handler: (message: ChannelMessage, context: RouteContext) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index >= 0) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  // Route a message to appropriate handler
  async route(message: ChannelMessage): Promise<string | void> {
    const adapter = this.registry.get(message.channelId);
    if (!adapter) {
      logger.warn({ channelId: message.channelId }, 'No adapter found for channel');
      return;
    }

    const context: RouteContext = { adapter };

    // Notify global handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(message, context);
      } catch (error) {
        logger.error({ err: error }, 'Message handler error');
      }
    }

    // Find matching route
    for (const route of this.routes) {
      if (route.condition(message)) {
        try {
          logger.debug({ routeId: route.id, messageId: message.id }, 'Route matched');
          const result = await route.handler(message, context);
          return result;
        } catch (error) {
          logger.error({ err: error, routeId: route.id }, 'Route handler error');
        }
      }
    }

    // Use default handler
    if (this.defaultHandler) {
      try {
        const result = await this.defaultHandler(message, context);
        return result;
      } catch (error) {
        logger.error({ err: error }, 'Default handler error');
      }
    }

    logger.debug({ messageId: message.id }, 'No route matched for message');
  }

  // Send message through specific adapter
  async send(
    adapterId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    const adapter = this.registry.get(adapterId);
    if (!adapter) {
      return {
        success: false,
        error: `Adapter not found: ${adapterId}`,
        timestamp: new Date(),
      };
    }

    return adapter.sendMessage(channelId, options);
  }

  // Broadcast to all enabled adapters
  async broadcast(
    channelId: string,
    options: SendMessageOptions
  ): Promise<Map<string, ChannelResponse>> {
    const results = new Map<string, ChannelResponse>();
    const adapters = this.registry.listEnabled();

    await Promise.all(
      adapters.map(async (adapter) => {
        const result = await adapter.sendMessage(channelId, options);
        results.set(adapter.id, result);
      })
    );

    return results;
  }

  // Reply to a specific message
  async reply(
    adapterId: string,
    messageId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    const adapter = this.registry.get(adapterId);
    if (!adapter) {
      return {
        success: false,
        error: `Adapter not found: ${adapterId}`,
        timestamp: new Date(),
      };
    }

    return adapter.replyToMessage(messageId, channelId, options);
  }

  // Setup message listeners on all adapters
  setupListeners(): void {
    for (const adapter of this.registry.list()) {
      adapter.onMessage(async (message) => {
        await this.route(message);
      });
    }
  }
}

// Common route conditions
export const routeConditions = {
  // Match by channel type
  byType: (type: string) => (message: ChannelMessage) => message.channelType === type,
  
  // Match by group ID
  byGroup: (groupId: string) => (message: ChannelMessage) => message.groupId === groupId,
  
  // Match by user ID
  byUser: (userId: string) => (message: ChannelMessage) => message.userId === userId,
  
  // Match by content pattern
  byPattern: (pattern: RegExp) => (message: ChannelMessage) => pattern.test(message.content),
  
  // Match by mention
  byMention: (botId: string) => (message: ChannelMessage) => 
    message.mentions?.some(m => m.userId === botId) ?? false,
  
  // Match direct messages
  isDirect: () => (message: ChannelMessage) => !message.isGroup,
  
  // Match group messages
  isGroup: () => (message: ChannelMessage) => message.isGroup,
  
  // Combine conditions with AND
  and: (...conditions: Array<(m: ChannelMessage) => boolean>) => 
    (message: ChannelMessage) => conditions.every(c => c(message)),
  
  // Combine conditions with OR
  or: (...conditions: Array<(m: ChannelMessage) => boolean>) => 
    (message: ChannelMessage) => conditions.some(c => c(message)),
};
