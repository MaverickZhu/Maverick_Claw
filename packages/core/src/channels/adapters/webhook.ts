import type { 
  ChannelAdapter, 
  ChannelMessage, 
  SendMessageOptions, 
  ChannelResponse,
  ChannelType,
  AdapterWebhookResult,
  WebhookCapableAdapter,
} from '../types.js';
import { logger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface WebhookAdapterConfig {
  webhookPath: string;
  secret?: string;
  verifySignature?: boolean;
}

/**
 * Generic Webhook Adapter
 * 
 * This adapter provides a generic webhook endpoint that external services
 * can send messages to. It can be used as a base for implementing
 * specific channel adapters.
 */
export class WebhookAdapter implements ChannelAdapter, WebhookCapableAdapter {
  id: string;
  type: ChannelType = 'custom';
  name: string;
  
  private config: WebhookAdapterConfig;
  private messageHandlers: Array<(message: ChannelMessage) => Promise<void> | void> = [];
  private responseHandlers = new Map<string, (response: ChannelResponse) => void>();
  private initialized = false;
  private started = false;

  constructor(id: string, name: string, config: WebhookAdapterConfig) {
    this.id = id;
    this.name = name;
    this.config = {
      verifySignature: false,
      ...config,
    };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      webhookPath: (config.webhookPath as string) || this.config.webhookPath,
      secret: (config.secret as string) || this.config.secret,
      verifySignature: (config.verifySignature as boolean) ?? this.config.verifySignature,
    };
    this.initialized = true;
    logger.info(`Webhook adapter ${this.id} initialized with path: ${this.config.webhookPath}`);
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }
    this.started = true;
    logger.info(`Webhook adapter ${this.id} started`);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.messageHandlers = [];
    this.responseHandlers.clear();
    logger.info(`Webhook adapter ${this.id} stopped`);
  }

  async health(): Promise<boolean> {
    return this.initialized && this.started;
  }

  onMessage(handler: (message: ChannelMessage) => Promise<void> | void): void {
    this.messageHandlers.push(handler);
  }

  offMessage(handler: (message: ChannelMessage) => Promise<void> | void): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index >= 0) {
      this.messageHandlers.splice(index, 1);
    }
  }

  /**
   * Process incoming webhook payload
   * This method should be called by the HTTP route handler
   */
  async processWebhook(payload: unknown, signature?: string): Promise<AdapterWebhookResult> {
    // Verify signature if configured
    if (this.config.verifySignature && this.config.secret) {
      if (!signature || !this.verifySignature(payload, signature)) {
        throw new Error('Invalid signature');
      }
    }

    // Parse message from payload
    const message = this.parsePayload(payload);
    if (!message) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Invalid webhook payload' },
      };
    }

    // Notify handlers
    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (error) {
        logger.error({ err: error, adapterId: this.id }, 'Message handler error');
      }
    }

    return {
      kind: 'message',
      message,
    };
  }

  async sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    if (!this.started) {
      return {
        success: false,
        error: 'Adapter not started',
        timestamp: new Date(),
      };
    }

    // For webhook adapter, we store the response handler
    // and wait for the external system to poll or callback
    const messageId = uuidv4();
    
    logger.debug({ 
      adapterId: this.id, 
      channelId, 
      messageId,
      content: options.content.substring(0, 100) 
    }, 'Message queued for webhook delivery');

    return {
      messageId,
      success: true,
      timestamp: new Date(),
    };
  }

  async sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    // For webhook adapter, DM is same as channel message
    return this.sendMessage(userId, options);
  }

  async replyToMessage(
    messageId: string, 
    channelId: string, 
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    // Include reply metadata
    const replyOptions = {
      ...options,
      metadata: {
        ...options.metadata,
        replyTo: messageId,
      },
    };
    return this.sendMessage(channelId, replyOptions);
  }

  private parsePayload(payload: unknown): ChannelMessage | null {
    // Generic payload parser
    // Expects format: { userId, content, [groupId], [mentions], [metadata] }
    
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const p = payload as Record<string, unknown>;
    
    if (!p.userId || !p.content) {
      return null;
    }

    return {
      id: (p.id as string) || uuidv4(),
      channelType: this.type,
      channelId: this.id,
      userId: String(p.userId),
      userName: p.userName as string | undefined,
      content: String(p.content),
      contentType: (p.contentType as 'text' | 'image' | 'file' | 'voice' | 'video') || 'text',
      timestamp: new Date(),
      metadata: p.metadata as Record<string, unknown> | undefined,
      groupId: p.groupId as string | undefined,
      groupName: p.groupName as string | undefined,
      isGroup: !!p.groupId,
      mentions: p.mentions as Array<{ userId: string; userName?: string }> | undefined,
    };
  }

  private verifySignature(_payload: unknown, _signature: string): boolean {
    // Simple HMAC verification example
    // In production, use proper crypto
    if (!this.config.secret) {
      return true;
    }
    
    // TODO: Implement proper HMAC-SHA256 verification
    // const expected = crypto.createHmac('sha256', this.config.secret).update(JSON.stringify(payload)).digest('hex');
    // return expected === signature;
    
    return true; // Placeholder
  }

  getWebhookPath(): string {
    return this.config.webhookPath;
  }
}
