import { createHmac } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  AdapterWebhookResult,
  ChannelMessage,
  ChannelResponse,
  ChannelType,
  SendMessageOptions,
  WebhookCapableAdapter,
} from '../types.js';
import { AbstractChannelAdapter } from './base.js';
import { createChannelError, createChannelSuccess } from '../types.js';
import { getString, getNumber, getRecord, readJson } from './utils.js';
import { logger } from '../../utils/logger.js';

export interface DingTalkAdapterConfig {
  webhookPath: string;
  verificationToken?: string;
  outgoingWebhookUrl?: string;
  outgoingSecret?: string;
}

export class DingTalkAdapter extends AbstractChannelAdapter implements WebhookCapableAdapter {
  type: ChannelType = 'dingtalk';

  private config: DingTalkAdapterConfig;

  constructor(id: string, name: string, config: DingTalkAdapterConfig) {
    super(id, name);
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      webhookPath: getString(config.webhookPath) || this.config.webhookPath,
      verificationToken: getString(config.verificationToken) || this.config.verificationToken,
      outgoingWebhookUrl:
        getString(config.outgoingWebhookUrl) ||
        getString(config.webhookUrl) ||
        this.config.outgoingWebhookUrl,
      outgoingSecret:
        getString(config.outgoingSecret) ||
        getString(config.secret) ||
        this.config.outgoingSecret,
    };

    this.initialized = true;
    logger.info({ adapterId: this.id }, 'DingTalk adapter initialized');
  }

  async start(): Promise<void> {
    await super.start();
    logger.info({ adapterId: this.id }, 'DingTalk adapter started');
  }

  async stop(): Promise<void> {
    await super.stop();
    logger.info({ adapterId: this.id }, 'DingTalk adapter stopped');
  }

  async processWebhook(payload: unknown, _signature?: string): Promise<AdapterWebhookResult> {
    const parsed = this.parseWebhookPayload(payload);
    if (parsed.kind !== 'message' || !parsed.message) {
      return parsed;
    }

    await this.notifyHandlers(parsed.message);

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

    const challenge = getString(raw.challenge);
    if (challenge) {
      const token = getString(raw.token);
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
      getString(raw.senderStaffId) ||
      getString(raw.senderId) ||
      getString(raw.userId) ||
      getString(raw.staffId);
    const userName =
      getString(raw.senderNick) ||
      getString(raw.senderName) ||
      getString(raw.userName);
    const messageId =
      getString(raw.msgId) ||
      getString(raw.messageId) ||
      getString(raw.id) ||
      uuidv4();

    const textNode = getRecord(raw.text);
    const content =
      getString(textNode?.content) ||
      getString(raw.content) ||
      getString(raw.message) ||
      '';
    if (!userId || !content) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing sender or content' },
      };
    }

    const groupId =
      getString(raw.conversationId) ||
      getString(raw.chatId) ||
      getString(raw.groupId);
    const conversationType = getString(raw.conversationType);
    const chatType = getString(raw.chatType);
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
        msgType: getString(raw.msgtype) || getString(raw.msgType) || 'text',
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
          getString(node.dingtalkId) ||
          getString(node.staffId) ||
          getString(node.userId);
        if (!userId) {
          return null;
        }
        return {
          userId,
          userName: getString(node.name),
        };
      })
      .filter((item): item is { userId: string; userName?: string } => Boolean(item));

    return mentions.length > 0 ? mentions : undefined;
  }

  private toDate(...candidates: unknown[]): Date {
    for (const value of candidates) {
      const num = getNumber(value);
      if (typeof num === 'number' && Number.isFinite(num)) {
        return new Date(num);
      }
      const str = getString(value);
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
      return createChannelError('Adapter not started');
    }

    if (!this.config.outgoingWebhookUrl) {
      return createChannelError('outgoingWebhookUrl is not configured');
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

      const result = getRecord(await readJson(response));
      if (!response.ok) {
        return createChannelError(`DingTalk webhook HTTP ${response.status}`);
      }

      const errCode = getNumber(result?.errcode) ?? getNumber(result?.code) ?? 0;
      if (errCode !== 0) {
        return createChannelError(
          getString(result?.errmsg) ||
          getString(result?.msg) ||
          `DingTalk webhook failed: ${String(errCode)}`
        );
      }

      return createChannelSuccess({ messageId: uuidv4() });
    } catch (error) {
      return createChannelError(error instanceof Error ? error.message : 'DingTalk webhook send failed');
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
}
