import { createHmac } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  AdapterWebhookResult,
  ChannelAdapter,
  ChannelMessage,
  ChannelResponse,
  ChannelType,
  SendMessageOptions,
  WebhookCapableAdapter,
} from '../types.js';
import { logger } from '../../utils/logger.js';

export interface DingTalkAdapterConfig {
  webhookPath: string;
  verificationToken?: string;
  outgoingWebhookUrl?: string;
  outgoingSecret?: string;
}

export class DingTalkAdapter implements ChannelAdapter, WebhookCapableAdapter {
  id: string;
  type: ChannelType = 'dingtalk';
  name: string;

  private config: DingTalkAdapterConfig;
  private messageHandlers: Array<(message: ChannelMessage) => Promise<void> | void> = [];
  private initialized = false;
  private started = false;

  constructor(id: string, name: string, config: DingTalkAdapterConfig) {
    this.id = id;
    this.name = name;
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      webhookPath: this.getString(config.webhookPath) || this.config.webhookPath,
      verificationToken: this.getString(config.verificationToken) || this.config.verificationToken,
      outgoingWebhookUrl:
        this.getString(config.outgoingWebhookUrl) ||
        this.getString(config.webhookUrl) ||
        this.config.outgoingWebhookUrl,
      outgoingSecret:
        this.getString(config.outgoingSecret) ||
        this.getString(config.secret) ||
        this.config.outgoingSecret,
    };

    this.initialized = true;
    logger.info({ adapterId: this.id }, 'DingTalk adapter initialized');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }
    this.started = true;
    logger.info({ adapterId: this.id }, 'DingTalk adapter started');
  }

  async stop(): Promise<void> {
    this.started = false;
    this.messageHandlers = [];
    logger.info({ adapterId: this.id }, 'DingTalk adapter stopped');
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

  async processWebhook(payload: unknown, _signature?: string): Promise<AdapterWebhookResult> {
    const parsed = this.parseWebhookPayload(payload);
    if (parsed.kind !== 'message' || !parsed.message) {
      return parsed;
    }

    for (const handler of this.messageHandlers) {
      try {
        await handler(parsed.message);
      } catch (error) {
        logger.error({ err: error, adapterId: this.id }, 'DingTalk message handler error');
      }
    }

    return parsed;
  }

  async sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendViaRobotWebhook(channelId, options);
  }

  async sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendViaRobotWebhook(userId, options);
  }

  async replyToMessage(
    _messageId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    return this.sendMessage(channelId, options);
  }

  getWebhookPath(): string {
    return this.config.webhookPath;
  }

  private parseWebhookPayload(payload: unknown): AdapterWebhookResult {
    if (typeof payload !== 'object' || payload === null) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Invalid payload' },
      };
    }

    const raw = payload as Record<string, unknown>;

    const challenge = this.getString(raw.challenge);
    if (challenge) {
      const token = this.getString(raw.token);
      if (this.config.verificationToken && token && token !== this.config.verificationToken) {
        throw new Error('Invalid DingTalk verification token');
      }
      return {
        kind: 'response',
        statusCode: 200,
        body: { challenge },
      };
    }

    const userId =
      this.getString(raw.senderStaffId) ||
      this.getString(raw.senderId) ||
      this.getString(raw.userId) ||
      this.getString(raw.staffId);
    const userName =
      this.getString(raw.senderNick) ||
      this.getString(raw.senderName) ||
      this.getString(raw.userName);
    const messageId =
      this.getString(raw.msgId) ||
      this.getString(raw.messageId) ||
      this.getString(raw.id) ||
      uuidv4();

    const textNode = this.getRecord(raw.text);
    const content =
      this.getString(textNode?.content) ||
      this.getString(raw.content) ||
      this.getString(raw.message) ||
      '';
    if (!userId || !content) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing sender or content' },
      };
    }

    const groupId =
      this.getString(raw.conversationId) ||
      this.getString(raw.chatId) ||
      this.getString(raw.groupId);
    const conversationType = this.getString(raw.conversationType);
    const chatType = this.getString(raw.chatType);
    const isGroup = Boolean(groupId) || conversationType === '2' || chatType === 'group';
    const timestamp = this.toDate(raw.createAt, raw.timestamp, raw.timeStamp);

    const message: ChannelMessage = {
      id: messageId,
      channelType: this.type,
      channelId: this.id,
      userId,
      userName,
      content,
      contentType: 'text',
      timestamp,
      metadata: {
        msgType: this.getString(raw.msgtype) || this.getString(raw.msgType) || 'text',
        conversationType,
        chatType,
      },
      groupId: isGroup ? groupId : undefined,
      isGroup,
      mentions: this.parseMentions(raw.atUsers),
    };

    return {
      kind: 'message',
      message,
    };
  }

  private parseMentions(rawMentions: unknown): Array<{ userId: string; userName?: string }> | undefined {
    if (!Array.isArray(rawMentions) || rawMentions.length === 0) {
      return undefined;
    }

    const mentions = rawMentions
      .map((item) => {
        if (typeof item === 'string') {
          return { userId: item };
        }
        if (typeof item !== 'object' || item === null) {
          return null;
        }
        const node = item as Record<string, unknown>;
        const userId =
          this.getString(node.dingtalkId) ||
          this.getString(node.staffId) ||
          this.getString(node.userId);
        if (!userId) {
          return null;
        }
        return {
          userId,
          userName: this.getString(node.name),
        };
      })
      .filter((item): item is { userId: string; userName?: string } => Boolean(item));

    return mentions.length > 0 ? mentions : undefined;
  }

  private toDate(...candidates: unknown[]): Date {
    for (const value of candidates) {
      const num = this.getNumber(value);
      if (typeof num === 'number' && Number.isFinite(num)) {
        return new Date(num);
      }
      const str = this.getString(value);
      if (str) {
        const parsed = Date.parse(str);
        if (Number.isFinite(parsed)) {
          return new Date(parsed);
        }
      }
    }
    return new Date();
  }

  private async sendViaRobotWebhook(
    _target: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    if (!this.started) {
      return {
        success: false,
        error: 'Adapter not started',
        timestamp: new Date(),
      };
    }

    if (!this.config.outgoingWebhookUrl) {
      return {
        success: false,
        error: 'outgoingWebhookUrl is not configured',
        timestamp: new Date(),
      };
    }

    const endpoint = this.buildSignedWebhookUrl(this.config.outgoingWebhookUrl, this.config.outgoingSecret);
    const payload: Record<string, unknown> = {
      msgtype: 'text',
      text: {
        content: options.content,
      },
    };

    if (options.mentions && options.mentions.length > 0) {
      payload.at = {
        atUserIds: options.mentions,
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

      const result = this.getRecord(await this.readJson(response));
      if (!response.ok) {
        return {
          success: false,
          error: `DingTalk webhook HTTP ${response.status}`,
          timestamp: new Date(),
        };
      }

      const errCode = this.getNumber(result?.errcode) ?? this.getNumber(result?.code) ?? 0;
      if (errCode !== 0) {
        return {
          success: false,
          error:
            this.getString(result?.errmsg) ||
            this.getString(result?.msg) ||
            `DingTalk webhook failed: ${String(errCode)}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        messageId: uuidv4(),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'DingTalk webhook send failed',
        timestamp: new Date(),
      };
    }
  }

  private buildSignedWebhookUrl(webhookUrl: string, secret?: string): string {
    if (!secret) {
      return webhookUrl;
    }

    const timestamp = Date.now().toString();
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = createHmac('sha256', secret).update(stringToSign).digest('base64');

    const url = new URL(webhookUrl);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('sign', encodeURIComponent(sign));
    return url.toString();
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  private getRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private getNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
}
