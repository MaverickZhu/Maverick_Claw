import type {
  ChannelMessage,
  ChannelResponse,
  ChannelType,
  AdapterWebhookResult,
  WebhookCapableAdapter,
  SendMessageOptions,
} from '../types.js';
import { AbstractChannelAdapter } from './base.js';
import { createChannelError, createChannelSuccess } from '../types.js';
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
export class WebhookAdapter extends AbstractChannelAdapter implements WebhookCapableAdapter {
  type: ChannelType = 'custom';

  private config: WebhookAdapterConfig;
  private responseHandlers = new Map<string, (response: ChannelResponse) => void>();

  constructor(id: string, name: string, config: WebhookAdapterConfig) {
    super(id, name);
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
    await super.start();
    logger.info(`Webhook adapter ${this.id} started`);
  }

  async stop(): Promise<void> {
    await super.stop();
    this.responseHandlers.clear();
    logger.info(`Webhook adapter ${this.id} stopped`);
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

    await this.notifyHandlers(message);

    return {
      kind: 'message',
      message,
    };
  }

  async sendMessage(_channelId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    if (!this.started) {
      return createChannelError('Adapter not started');
    }

    const messageId = uuidv4();

    logger.debug(
      {
        adapterId: this.id,
        messageId,
        content: options.content.substring(0, 100),
      },
      'Message queued for webhook delivery'
    );

    return createChannelSuccess({ messageId });
  }

  async sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendMessage(userId, options);
  }

  async replyToMessage(
    messageId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
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
    if (!this.config.secret) {
      return true;
    }
    // TODO: Implement proper HMAC-SHA256 verification
    return true;
  }

  getWebhookPath(): string {
    return this.config.webhookPath;
  }
}
