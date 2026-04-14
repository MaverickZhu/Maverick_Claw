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

const LARK_API_BASE_URL = 'https://open.feishu.cn/open-apis';

export interface LarkAdapterConfig {
  webhookPath: string;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  botWebhookUrl?: string;
  botWebhookSecret?: string;
}

interface LarkAuthState {
  tenantAccessToken?: string;
  expiresAt: number;
}

type ReceiveIdType = 'chat_id' | 'open_id';

export class LarkAdapter implements ChannelAdapter, WebhookCapableAdapter {
  id: string;
  type: ChannelType = 'lark';
  name: string;

  private config: LarkAdapterConfig;
  private messageHandlers: Array<(message: ChannelMessage) => Promise<void> | void> = [];
  private initialized = false;
  private started = false;
  private auth: LarkAuthState = { expiresAt: 0 };

  constructor(id: string, name: string, config: LarkAdapterConfig) {
    this.id = id;
    this.name = name;
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      webhookPath: this.getString(config.webhookPath) || this.config.webhookPath,
      appId: this.getString(config.appId) || this.config.appId,
      appSecret: this.getString(config.appSecret) || this.config.appSecret,
      verificationToken: this.getString(config.verificationToken) || this.config.verificationToken,
      botWebhookUrl: this.getString(config.botWebhookUrl) || this.config.botWebhookUrl,
      botWebhookSecret: this.getString(config.botWebhookSecret) || this.config.botWebhookSecret,
    };
    this.initialized = true;
    logger.info({ adapterId: this.id }, 'Lark adapter initialized');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }
    this.started = true;
    logger.info({ adapterId: this.id }, 'Lark adapter started');
  }

  async stop(): Promise<void> {
    this.started = false;
    this.messageHandlers = [];
    this.auth = { expiresAt: 0 };
    logger.info({ adapterId: this.id }, 'Lark adapter stopped');
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
        logger.error({ err: error, adapterId: this.id }, 'Lark message handler error');
      }
    }

    return parsed;
  }

  async sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendByReceiveId('chat_id', channelId, options);
  }

  async sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendByReceiveId('open_id', userId, options);
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

  private async sendByReceiveId(
    receiveIdType: ReceiveIdType,
    receiveId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    if (!this.started) {
      return {
        success: false,
        error: 'Adapter not started',
        timestamp: new Date(),
      };
    }

    if (!receiveId) {
      return {
        success: false,
        error: 'Receive ID is required',
        timestamp: new Date(),
      };
    }

    try {
      if (this.config.appId && this.config.appSecret) {
        return await this.sendViaImApi(receiveIdType, receiveId, options);
      }
      if (this.config.botWebhookUrl) {
        return await this.sendViaBotWebhook(options);
      }
      return {
        success: false,
        error: 'No outbound configuration. Set appId/appSecret or botWebhookUrl.',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Lark message send failed',
        timestamp: new Date(),
      };
    }
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
    const type = this.getString(raw.type);

    if (type === 'url_verification') {
      return this.parseUrlVerification(raw);
    }

    if (typeof raw.encrypt === 'string') {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Encrypted payload is not supported yet' },
      };
    }

    const event = this.getRecord(raw.event);
    const header = this.getRecord(raw.header);
    const eventType = this.getString(header?.event_type);

    if (eventType !== 'im.message.receive_v1') {
      return {
        kind: 'ignored',
        statusCode: 200,
        body: { success: true, ignored: true, reason: 'event_not_supported' },
      };
    }

    if (!event) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing event payload' },
      };
    }

    const messageNode = this.getRecord(event.message);
    if (!messageNode) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing message node' },
      };
    }

    const senderNode = this.getRecord(event.sender);
    const senderIdNode = this.getRecord(senderNode?.sender_id);
    const userId =
      this.getString(senderIdNode?.open_id) ||
      this.getString(senderIdNode?.user_id) ||
      this.getString(senderIdNode?.union_id);

    if (!userId) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing sender id' },
      };
    }

    const rawContent = this.getString(messageNode.content) || '';
    const messageType = this.getString(messageNode.message_type) || 'text';
    const content = this.parseMessageContent(rawContent, messageType);

    const chatType = this.getString(messageNode.chat_type) || this.getString(event.chat_type) || 'p2p';
    const chatId = this.getString(messageNode.chat_id);
    const messageId = this.getString(messageNode.message_id) || uuidv4();
    const createTimeRaw = this.getString(messageNode.create_time);
    const createTime = createTimeRaw ? Number.parseInt(createTimeRaw, 10) : Date.now();
    const timestamp = Number.isFinite(createTime) ? new Date(createTime) : new Date();

    const mentionsNode = Array.isArray(messageNode.mentions) ? messageNode.mentions : [];
    const mentions = mentionsNode
      .map((mention) => this.toMention(mention))
      .filter((mention): mention is { userId: string; userName?: string } => Boolean(mention));

    const isGroup = chatType !== 'p2p';
    const userName = this.getString(senderIdNode?.name) || this.getString(senderNode?.name);

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
        eventType,
        messageType,
        chatType,
        chatId,
      },
      groupId: isGroup ? chatId : undefined,
      isGroup,
      mentions: mentions.length > 0 ? mentions : undefined,
    };

    return {
      kind: 'message',
      message,
    };
  }

  private parseUrlVerification(payload: Record<string, unknown>): AdapterWebhookResult {
    const challenge = this.getString(payload.challenge);
    const token = this.getString(payload.token);

    if (!challenge) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing challenge' },
      };
    }

    if (this.config.verificationToken && token !== this.config.verificationToken) {
      throw new Error('Invalid Lark verification token');
    }

    return {
      kind: 'response',
      statusCode: 200,
      body: { challenge },
    };
  }

  private parseMessageContent(rawContent: string, messageType: string): string {
    if (messageType !== 'text') {
      return `[${messageType}]`;
    }

    if (!rawContent) {
      return '';
    }

    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      return this.getString(parsed.text) || rawContent;
    } catch {
      return rawContent;
    }
  }

  private toMention(mention: unknown): { userId: string; userName?: string } | null {
    if (typeof mention !== 'object' || mention === null) {
      return null;
    }
    const mentionNode = mention as Record<string, unknown>;
    const idNode = this.getRecord(mentionNode.id);
    const userId =
      this.getString(idNode?.open_id) ||
      this.getString(idNode?.user_id) ||
      this.getString(idNode?.union_id);

    if (!userId) {
      return null;
    }

    return {
      userId,
      userName: this.getString(mentionNode.name),
    };
  }

  private async sendViaImApi(
    receiveIdType: ReceiveIdType,
    receiveId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    const tenantAccessToken = await this.getTenantAccessToken();
    const response = await fetch(
      `${LARK_API_BASE_URL}/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({
            text: options.content,
          }),
        }),
      }
    );

    const result = await this.readJson(response);
    if (!response.ok) {
      return {
        success: false,
        error: `Lark API HTTP ${response.status}`,
        timestamp: new Date(),
      };
    }

    const code = this.getNumber(this.getRecord(result)?.code);
    if (typeof code === 'number' && code !== 0) {
      return {
        success: false,
        error: this.getString(this.getRecord(result)?.msg) || 'Lark API returned non-zero code',
        timestamp: new Date(),
      };
    }

    const data = this.getRecord(this.getRecord(result)?.data);
    return {
      success: true,
      messageId: this.getString(data?.message_id),
      timestamp: new Date(),
    };
  }

  private async sendViaBotWebhook(options: SendMessageOptions): Promise<ChannelResponse> {
    if (!this.config.botWebhookUrl) {
      return {
        success: false,
        error: 'botWebhookUrl is not configured',
        timestamp: new Date(),
      };
    }

    const body: Record<string, unknown> = {
      msg_type: 'text',
      content: {
        text: options.content,
      },
    };

    if (this.config.botWebhookSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      body.timestamp = timestamp;
      body.sign = this.generateBotWebhookSign(timestamp, this.config.botWebhookSecret);
    }

    const response = await fetch(this.config.botWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    const result = await this.readJson(response);
    if (!response.ok) {
      return {
        success: false,
        error: `Lark bot webhook HTTP ${response.status}`,
        timestamp: new Date(),
      };
    }

    const normalized = this.getRecord(result);
    const code = this.getNumber(normalized?.StatusCode) ?? this.getNumber(normalized?.code) ?? 0;
    if (code !== 0) {
      return {
        success: false,
        error: this.getString(normalized?.StatusMessage) || this.getString(normalized?.msg) || 'Lark bot webhook failed',
        timestamp: new Date(),
      };
    }

    return {
      success: true,
      timestamp: new Date(),
    };
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.auth.tenantAccessToken && Date.now() < this.auth.expiresAt - 60_000) {
      return this.auth.tenantAccessToken;
    }

    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('Lark appId/appSecret is required for IM API sending');
    }

    const response = await fetch(`${LARK_API_BASE_URL}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const result = this.getRecord(await this.readJson(response));
    if (!response.ok) {
      throw new Error(`Lark token API HTTP ${response.status}`);
    }

    const code = this.getNumber(result?.code);
    const token = this.getString(result?.tenant_access_token);
    const expire = this.getNumber(result?.expire);
    if (code !== 0 || !token) {
      throw new Error(this.getString(result?.msg) || 'Lark token API failed');
    }

    this.auth = {
      tenantAccessToken: token,
      expiresAt: Date.now() + (expire || 7200) * 1000,
    };
    return token;
  }

  private generateBotWebhookSign(timestamp: string, secret: string): string {
    const stringToSign = `${timestamp}\n${secret}`;
    return createHmac('sha256', stringToSign).digest('base64');
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
