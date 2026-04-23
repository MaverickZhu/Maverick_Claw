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

export class LarkAdapter extends AbstractChannelAdapter implements WebhookCapableAdapter {
  type: ChannelType = 'lark';

  private config: LarkAdapterConfig;
  private auth: LarkAuthState = { expiresAt: 0 };

  constructor(id: string, name: string, config: LarkAdapterConfig) {
    super(id, name);
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      webhookPath: getString(config.webhookPath) || this.config.webhookPath,
      appId: getString(config.appId) || this.config.appId,
      appSecret: getString(config.appSecret) || this.config.appSecret,
      verificationToken: getString(config.verificationToken) || this.config.verificationToken,
      botWebhookUrl: getString(config.botWebhookUrl) || this.config.botWebhookUrl,
      botWebhookSecret: getString(config.botWebhookSecret) || this.config.botWebhookSecret,
    };
    this.initialized = true;
    logger.info({ adapterId: this.id }, 'Lark adapter initialized');
  }

  async start(): Promise<void> {
    await super.start();
    logger.info({ adapterId: this.id }, 'Lark adapter started');
  }

  async stop(): Promise<void> {
    await super.stop();
    this.auth = { expiresAt: 0 };
    logger.info({ adapterId: this.id }, 'Lark adapter stopped');
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
      return createChannelError('Adapter not started');
    }

    if (!receiveId) {
      return createChannelError('Receive ID is required');
    }

    try {
      if (this.config.appId && this.config.appSecret) {
        return await this.sendViaImApi(receiveIdType, receiveId, options);
      }
      if (this.config.botWebhookUrl) {
        return await this.sendViaBotWebhook(options);
      }
      return createChannelError('No outbound configuration. Set appId/appSecret or botWebhookUrl.');
    } catch (error) {
      return createChannelError(error instanceof Error ? error.message : 'Lark message send failed');
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
    const type = getString(raw.type);

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

    const event = getRecord(raw.event);
    const header = getRecord(raw.header);
    const eventType = getString(header?.event_type);

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

    const messageNode = getRecord(event.message);
    if (!messageNode) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing message node' },
      };
    }

    const senderNode = getRecord(event.sender);
    const senderIdNode = getRecord(senderNode?.sender_id);
    const userId =
      getString(senderIdNode?.open_id) ||
      getString(senderIdNode?.user_id) ||
      getString(senderIdNode?.union_id);

    if (!userId) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing sender id' },
      };
    }

    const rawContent = getString(messageNode.content) || '';
    const messageType = getString(messageNode.message_type) || 'text';
    const content = this.parseMessageContent(rawContent, messageType);

    const chatType = getString(messageNode.chat_type) || getString(event.chat_type) || 'p2p';
    const chatId = getString(messageNode.chat_id);
    const messageId = getString(messageNode.message_id) || uuidv4();
    const createTimeRaw = getString(messageNode.create_time);
    const createTime = createTimeRaw ? Number.parseInt(createTimeRaw, 10) : Date.now();
    const timestamp = Number.isFinite(createTime) ? new Date(createTime) : new Date();

    const mentionsNode = Array.isArray(messageNode.mentions) ? messageNode.mentions : [];
    const mentions = mentionsNode
      .map((mention) => this.toMention(mention))
      .filter((mention): mention is { userId: string; userName?: string } => Boolean(mention));

    const isGroup = chatType !== 'p2p';
    const userName = getString(senderIdNode?.name) || getString(senderNode?.name);

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
    const challenge = getString(payload.challenge);
    const token = getString(payload.token);

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
      return getString(parsed.text) || rawContent;
    } catch {
      return rawContent;
    }
  }

  private toMention(mention: unknown): { userId: string; userName?: string } | null {
    if (typeof mention !== 'object' || mention === null) {
      return null;
    }
    const mentionNode = mention as Record<string, unknown>;
    const idNode = getRecord(mentionNode.id);
    const userId =
      getString(idNode?.open_id) ||
      getString(idNode?.user_id) ||
      getString(idNode?.union_id);

    if (!userId) {
      return null;
    }

    return {
      userId,
      userName: getString(mentionNode.name),
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

    const result = await readJson(response);
    if (!response.ok) {
      return createChannelError(`Lark API HTTP ${response.status}`);
    }

    const code = getNumber(getRecord(result)?.code);
    if (typeof code === 'number' && code !== 0) {
      return createChannelError(getString(getRecord(result)?.msg) || 'Lark API returned non-zero code');
    }

    const data = getRecord(getRecord(result)?.data);
    return createChannelSuccess({ messageId: getString(data?.message_id) });
  }

  private async sendViaBotWebhook(options: SendMessageOptions): Promise<ChannelResponse> {
    if (!this.config.botWebhookUrl) {
      return createChannelError('botWebhookUrl is not configured');
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

    const result = await readJson(response);
    if (!response.ok) {
      return createChannelError(`Lark bot webhook HTTP ${response.status}`);
    }

    const normalized = getRecord(result);
    const code = getNumber(normalized?.StatusCode) ?? getNumber(normalized?.code) ?? 0;
    if (code !== 0) {
      return createChannelError(
        getString(normalized?.StatusMessage) || getString(normalized?.msg) || 'Lark bot webhook failed'
      );
    }

    return createChannelSuccess();
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

    const result = getRecord(await readJson(response));
    if (!response.ok) {
      throw new Error(`Lark token API HTTP ${response.status}`);
    }

    const code = getNumber(result?.code);
    const token = getString(result?.tenant_access_token);
    const expire = getNumber(result?.expire);
    if (code !== 0 || !token) {
      throw new Error(getString(result?.msg) || 'Lark token API failed');
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
}
