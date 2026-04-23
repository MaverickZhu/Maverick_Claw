import { v4 as uuidv4 } from 'uuid';
import type {
  ChannelMessage,
  ChannelResponse,
  ChannelType,
  SendMessageOptions,
} from '../types.js';
import { AbstractChannelAdapter } from './base.js';
import { createChannelError, createChannelSuccess } from '../types.js';
import { getString, getBoolean } from './utils.js';
import { logger } from '../../utils/logger.js';

export interface WeChatAdapterConfig {
  enabled: boolean;
  name?: string;
  puppet?: string;
}

export class WeChatAdapter extends AbstractChannelAdapter {
  type: ChannelType = 'wechat';

  private config: WeChatAdapterConfig;
  private bot: import('wechaty').Wechaty | null = null;
  private botUserId: string | null = null;
  private recentMessages = new Map<string, import('wechaty').Message>();
  private readonly maxRecentMessages = 100;

  constructor(id: string, name: string, config: WeChatAdapterConfig) {
    super(id, name);
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      enabled: getBoolean(config.enabled) ?? this.config.enabled ?? false,
      name: getString(config.name) || this.config.name || 'Maverick_Claw',
      puppet: getString(config.puppet) || this.config.puppet,
    };

    if (!this.config.enabled) {
      logger.info({ adapterId: this.id }, 'WeChat adapter disabled');
      return;
    }

    let WechatyClass: typeof import('wechaty').Wechaty;
    try {
      const wechaty = await import('wechaty');
      WechatyClass = wechaty.Wechaty;
    } catch (error) {
      logger.warn(
        { adapterId: this.id, err: error },
        'wechaty is not installed, WeChat adapter disabled. Install with: pnpm add wechaty'
      );
      return;
    }

    this.bot = new WechatyClass({
      name: this.config.name,
      puppet: this.config.puppet,
    });

    this.bot.on('scan', (qrcode: string, status: number) => {
      logger.info({ adapterId: this.id, status }, `WeChat scan QR code: ${qrcode}`);
    });

    this.bot.on('login', (user: import('wechaty').Contact) => {
      this.botUserId = user.id;
      logger.info({ adapterId: this.id, userId: user.id, userName: user.name() }, 'WeChat logged in');
    });

    this.bot.on('logout', (user: import('wechaty').Contact) => {
      this.botUserId = null;
      logger.info({ adapterId: this.id, userId: user.id }, 'WeChat logged out');
    });

    this.bot.on('message', async (msg: import('wechaty').Message) => {
      try {
        const channelMessage = await this.convertMessage(msg);
        if (!channelMessage) {
          return;
        }
        await this.notifyHandlers(channelMessage);
      } catch (error) {
        logger.error({ err: error, adapterId: this.id }, 'WeChat message conversion error');
      }
    });

    this.initialized = true;
    logger.info({ adapterId: this.id }, 'WeChat adapter initialized');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      if (!this.config.enabled) {
        return;
      }
      throw new Error('Adapter not initialized');
    }
    if (!this.bot) {
      logger.warn({ adapterId: this.id }, 'WeChat bot is not available, skipping start');
      return;
    }
    await this.bot.start();
    this.started = true;
    logger.info({ adapterId: this.id }, 'WeChat adapter started');
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
    }
    await super.stop();
    this.recentMessages.clear();
    this.botUserId = null;
    logger.info({ adapterId: this.id }, 'WeChat adapter stopped');
  }

  async health(): Promise<boolean> {
    return this.initialized && this.started && this.bot !== null && this.botUserId !== null;
  }

  async sendMessage(_channelId: string, _options: SendMessageOptions): Promise<ChannelResponse> {
    return createChannelError('WeChat adapter only supports replyToMessage for sending');
  }

  async sendDirectMessage(_userId: string, _options: SendMessageOptions): Promise<ChannelResponse> {
    return createChannelError('WeChat adapter only supports replyToMessage for sending');
  }

  async replyToMessage(
    messageId: string,
    _channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    if (!this.started || !this.bot) {
      return createChannelError('Adapter not started or bot not available');
    }

    const msg = this.recentMessages.get(messageId);
    if (!msg) {
      return createChannelError('Original message not found in cache (may have expired)');
    }

    try {
      await msg.say(options.content);
      return createChannelSuccess();
    } catch (error) {
      return createChannelError(error instanceof Error ? error.message : 'WeChat reply failed');
    }
  }

  private async convertMessage(msg: import('wechaty').Message): Promise<ChannelMessage | null> {
    const text = msg.text();
    if (!text) {
      return null;
    }

    const talker = msg.talker();
    const room = msg.room();

    // Skip bot's own messages
    if (talker.id === this.botUserId) {
      return null;
    }

    const isGroup = room !== null;
    const roomId = room ? room.id : undefined;
    const roomName = room ? room.topic() : undefined;

    const mentions: Array<{ userId: string; userName?: string }> = [];
    if (isGroup && msg.mentionSelf()) {
      mentions.push({
        userId: this.botUserId || 'bot',
        userName: this.config.name,
      });
    }

    const channelMessage: ChannelMessage = {
      id: msg.id || uuidv4(),
      channelType: this.type,
      channelId: this.id,
      userId: talker.id,
      userName: talker.name(),
      content: text,
      contentType: 'text',
      timestamp: new Date(),
      metadata: {
        roomName,
        mentionSelf: msg.mentionSelf(),
      },
      groupId: roomId,
      isGroup,
      mentions: mentions.length > 0 ? mentions : undefined,
    };

    // Cache message for reply
    this.recentMessages.set(channelMessage.id, msg);
    if (this.recentMessages.size > this.maxRecentMessages) {
      const firstKey = this.recentMessages.keys().next().value as string;
      this.recentMessages.delete(firstKey);
    }

    return channelMessage;
  }
}
