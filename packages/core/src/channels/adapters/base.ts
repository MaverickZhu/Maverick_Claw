import type {
  ChannelAdapter,
  ChannelMessage,
  ChannelResponse,
  ChannelType,
  SendMessageOptions,
} from '../types.js';
import { logger } from '../../utils/logger.js';

export abstract class AbstractChannelAdapter implements ChannelAdapter {
  id: string;
  abstract type: ChannelType;
  name: string;

  protected initialized = false;
  protected started = false;
  protected messageHandlers: Array<(message: ChannelMessage) => Promise<void> | void> = [];

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  abstract initialize(config: Record<string, unknown>): Promise<void>;

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.messageHandlers = [];
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

  protected async notifyHandlers(message: ChannelMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (error) {
        logger.error({ err: error, adapterId: this.id }, `${this.name} message handler error`);
      }
    }
  }

  abstract sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse>;
  abstract sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse>;
  abstract replyToMessage(
    messageId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse>;
}
