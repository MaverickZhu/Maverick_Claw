import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  AdapterWebhookResult,
  ChannelMessage,
  ChannelResponse,
  ChannelType,
  SendMessageOptions,
  WebhookCapableAdapter,
  WebhookUrlVerificationResult,
} from '../types.js';
import { AbstractChannelAdapter } from './base.js';
import { createChannelError, createChannelSuccess } from '../types.js';
import { getString, getNumber } from './utils.js';
import { logger } from '../../utils/logger.js';

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

export interface WeComAdapterConfig {
  corpId: string;
  corpSecret: string;
  agentId: string;
  token?: string;
}

interface WeComAuthState {
  accessToken?: string;
  expiresAt: number;
}

/**
 * Parse WeCom XML message into a flat record.
 * Handles both `<Tag>value</Tag>` and `<Tag><![CDATA[value]]></Tag>`.
 */
function parseWeComXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    result[match[1]] = match[2] ?? match[3] ?? '';
  }
  return result;
}

export class WeComAdapter extends AbstractChannelAdapter implements WebhookCapableAdapter {
  type: ChannelType = 'wecom';

  private config: WeComAdapterConfig;
  private auth: WeComAuthState = { expiresAt: 0 };

  constructor(id: string, name: string, config: WeComAdapterConfig) {
    super(id, name);
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      corpId: getString(config.corpId) || this.config.corpId,
      corpSecret: getString(config.corpSecret) || this.config.corpSecret,
      agentId: getString(config.agentId) || this.config.agentId,
      token: getString(config.token) || this.config.token,
    };
    this.initialized = true;
    logger.info({ adapterId: this.id }, 'WeCom adapter initialized');
  }

  async start(): Promise<void> {
    await super.start();
    logger.info({ adapterId: this.id }, 'WeCom adapter started');
  }

  async stop(): Promise<void> {
    await super.stop();
    this.auth = { expiresAt: 0 };
    logger.info({ adapterId: this.id }, 'WeCom adapter stopped');
  }

  async verifyWebhookUrl(
    query: Record<string, string | string[] | undefined>
  ): Promise<WebhookUrlVerificationResult> {
    const msgSignature = getString(query.msg_signature) || getString(query.signature);
    const timestamp = getString(query.timestamp);
    const nonce = getString(query.nonce);
    const echostr = getString(query.echostr);

    if (!echostr) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing echostr' },
      };
    }

    if (this.config.token && msgSignature && timestamp && nonce) {
      const expected = this.generateSignature(this.config.token, timestamp, nonce, echostr);
      if (expected !== msgSignature) {
        return {
          kind: 'error',
          statusCode: 403,
          body: { error: 'Invalid signature' },
        };
      }
    }

    return {
      kind: 'success',
      statusCode: 200,
      body: echostr,
    };
  }

  async processWebhook(payload: unknown, _signature?: string): Promise<AdapterWebhookResult> {
    if (typeof payload !== 'string') {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'WeCom webhook payload must be XML string' },
      };
    }

    const parsed = parseWeComXml(payload);
    const msgType = getString(parsed.MsgType);

    // URL verification fallback (some platforms send XML for challenge too)
    if (msgType === 'event') {
      const event = getString(parsed.Event);
      if (event === 'subscribe') {
        // User subscribed, could be treated as a message or ignored
        return {
          kind: 'ignored',
          statusCode: 200,
          body: { success: true },
        };
      }
    }

    const userId = getString(parsed.FromUserName);
    const content = getString(parsed.Content);
    const msgId = getString(parsed.MsgId);

    if (!userId) {
      return {
        kind: 'ignored',
        statusCode: 400,
        body: { error: 'Missing FromUserName' },
      };
    }

    // Filter out empty text messages (e.g., just an image)
    if (msgType === 'text' && !content) {
      return {
        kind: 'ignored',
        statusCode: 200,
        body: { success: true, ignored: true },
      };
    }

    const createTimeRaw = getString(parsed.CreateTime);
    const createTime = createTimeRaw ? Number.parseInt(createTimeRaw, 10) * 1000 : Date.now();
    const timestamp = Number.isFinite(createTime) ? new Date(createTime) : new Date();

    const message: ChannelMessage = {
      id: msgId || uuidv4(),
      channelType: this.type,
      channelId: this.id,
      userId,
      content: content || `[${msgType || 'unknown'}]`,
      contentType: this.mapContentType(msgType),
      timestamp,
      metadata: {
        msgType,
        toUserName: getString(parsed.ToUserName),
        agentId: getString(parsed.AgentID),
      },
      isGroup: false,
    };

    await this.notifyHandlers(message);

    return {
      kind: 'message',
      message,
    };
  }

  async sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendViaApi(channelId, options);
  }

  async sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendViaApi(userId, options);
  }

  async replyToMessage(
    _messageId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    return this.sendMessage(channelId, options);
  }

  getWebhookPath(): string {
    return `/api/webhooks/${this.id}`;
  }

  private mapContentType(msgType?: string): ChannelMessage['contentType'] {
    switch (msgType) {
      case 'image':
        return 'image';
      case 'voice':
        return 'voice';
      case 'video':
        return 'video';
      case 'file':
        return 'file';
      case 'text':
      default:
        return 'text';
    }
  }

  private generateSignature(token: string, timestamp: string, nonce: string, echostr: string): string {
    const sorted = [token, timestamp, nonce, echostr].sort().join('');
    return createHash('sha1').update(sorted).digest('hex');
  }

  private async sendViaApi(targetId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    if (!this.started) {
      return createChannelError('Adapter not started');
    }

    if (!this.config.corpId || !this.config.corpSecret || !this.config.agentId) {
      return createChannelError('corpId, corpSecret and agentId are required');
    }

    try {
      const accessToken = await this.getAccessToken();
      const response = await fetch(`${WECOM_API_BASE}/message/send?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          touser: targetId,
          msgtype: 'text',
          agentid: Number.parseInt(this.config.agentId, 10),
          text: { content: options.content },
        }),
      });

      const result = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        return createChannelError(`WeCom API HTTP ${response.status}`);
      }

      const errCode = getNumber(result.errcode) ?? 0;
      if (errCode !== 0) {
        return createChannelError(
          getString(result.errmsg) || `WeCom API error: ${String(errCode)}`
        );
      }

      return createChannelSuccess({ messageId: getString(result.msgid) || uuidv4() });
    } catch (error) {
      return createChannelError(error instanceof Error ? error.message : 'WeCom send failed');
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.auth.accessToken && Date.now() < this.auth.expiresAt - 60_000) {
      return this.auth.accessToken;
    }

    const response = await fetch(
      `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(this.config.corpId)}&corpsecret=${encodeURIComponent(this.config.corpSecret)}`
    );

    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`WeCom token API HTTP ${response.status}`);
    }

    const errCode = getNumber(result.errcode) ?? 0;
    const token = getString(result.access_token);
    const expiresIn = getNumber(result.expires_in) ?? 7200;

    if (errCode !== 0 || !token) {
      throw new Error(getString(result.errmsg) || 'WeCom token API failed');
    }

    this.auth = {
      accessToken: token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    return token;
  }
}
