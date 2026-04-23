import { ImapFlow } from 'imapflow';
import { createTransport, type Transporter } from 'nodemailer';
import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import type { ChannelMessage, ChannelResponse, ChannelType, SendMessageOptions } from '../types.js';
import { AbstractChannelAdapter } from './base.js';
import { createChannelError, createChannelSuccess } from '../types.js';
import { getString, getNumber, getBoolean } from './utils.js';
import { logger } from '../../utils/logger.js';

export interface EmailAdapterConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure?: boolean;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapSecure?: boolean;
  fromAddress: string;
  pollingInterval?: number;
  markAsRead?: boolean;
}

export class EmailAdapter extends AbstractChannelAdapter {
  type: ChannelType = 'email';

  private config: EmailAdapterConfig;
  private transporter: Transporter | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(id: string, name: string, config: EmailAdapterConfig) {
    super(id, name);
    this.config = { ...config };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      ...this.config,
      smtpHost: getString(config.smtpHost) || this.config.smtpHost,
      smtpPort: getNumber(config.smtpPort) ?? this.config.smtpPort,
      smtpUser: getString(config.smtpUser) || this.config.smtpUser,
      smtpPassword: getString(config.smtpPassword) || this.config.smtpPassword,
      smtpSecure: getBoolean(config.smtpSecure) ?? this.config.smtpSecure,
      imapHost: getString(config.imapHost) || this.config.imapHost,
      imapPort: getNumber(config.imapPort) ?? this.config.imapPort,
      imapUser: getString(config.imapUser) || this.config.imapUser,
      imapPassword: getString(config.imapPassword) || this.config.imapPassword,
      imapSecure: getBoolean(config.imapSecure) ?? this.config.imapSecure,
      fromAddress: getString(config.fromAddress) || this.config.fromAddress,
      pollingInterval: getNumber(config.pollingInterval) ?? this.config.pollingInterval ?? 60,
      markAsRead: getBoolean(config.markAsRead) ?? this.config.markAsRead ?? true,
    };
    this.initialized = true;
    logger.info({ adapterId: this.id }, 'Email adapter initialized');
  }

  async start(): Promise<void> {
    await super.start();

    if (!this.config.smtpHost || !this.config.smtpUser || !this.config.smtpPassword) {
      logger.warn({ adapterId: this.id }, 'Email adapter SMTP not fully configured');
    } else {
      this.transporter = createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure ?? (this.config.smtpPort === 465),
        auth: {
          user: this.config.smtpUser,
          pass: this.config.smtpPassword,
        },
      });
    }

    if (this.config.imapHost && this.config.imapUser && this.config.imapPassword) {
      this.startPolling();
    }

    logger.info({ adapterId: this.id }, 'Email adapter started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.transporter = null;
    await super.stop();
    logger.info({ adapterId: this.id }, 'Email adapter stopped');
  }

  async sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    if (!this.started) {
      return createChannelError('Adapter not started');
    }

    if (!this.transporter) {
      return createChannelError('SMTP transporter not configured');
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.config.fromAddress,
        to: channelId,
        subject: options.metadata?.subject as string || 'Re: Message',
        text: options.content,
      });

      return createChannelSuccess({ messageId: info.messageId || uuidv4() });
    } catch (error) {
      return createChannelError(error instanceof Error ? error.message : 'Email send failed');
    }
  }

  async sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse> {
    return this.sendMessage(userId, options);
  }

  async replyToMessage(
    messageId: string,
    channelId: string,
    options: SendMessageOptions
  ): Promise<ChannelResponse> {
    return this.sendMessage(channelId, {
      ...options,
      metadata: {
        ...options.metadata,
        subject: `Re: ${messageId}`,
      },
    });
  }

  private startPolling(): void {
    const interval = (this.config.pollingInterval || 60) * 1000;
    this.pollTimer = setInterval(() => {
      this.pollInbox().catch((error) => {
        logger.error({ err: error, adapterId: this.id }, 'Email IMAP poll failed');
      });
    }, interval);

    // Immediate first poll
    this.pollInbox().catch((error) => {
      logger.error({ err: error, adapterId: this.id }, 'Email IMAP initial poll failed');
    });
  }

  private async pollInbox(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    const client = new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: this.config.imapSecure ?? (this.config.imapPort === 993),
      auth: {
        user: this.config.imapUser,
        pass: this.config.imapPassword,
      },
      logger: false,
    });

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        const unseen = await client.search({ seen: false });
        if (!unseen || unseen.length === 0) return;

        logger.info({ adapterId: this.id, count: unseen.length }, 'Email new messages found');

        for await (const msg of client.fetch(unseen, { envelope: true, source: true })) {
          try {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            const from = msg.envelope?.from?.[0];
            const userId = from?.address || parsed.from?.text || 'unknown';
            const userName = from?.name || parsed.from?.text || 'unknown';

            const subject = parsed.subject || msg.envelope?.subject || '(no subject)';
            const text = parsed.text || '';
            const content = text.trim()
              ? `Subject: ${subject}\n\n${text.trim()}`
              : `Subject: ${subject}`;

            const message: ChannelMessage = {
              id: msg.uid ? String(msg.uid) : uuidv4(),
              channelType: this.type,
              channelId: this.id,
              userId,
              userName,
              content,
              contentType: 'text',
              timestamp: parsed.date || new Date(),
              metadata: {
                subject,
                messageId: parsed.messageId,
                to: msg.envelope?.to?.map((a) => a.address).filter((a): a is string => Boolean(a)),
                cc: msg.envelope?.cc?.map((a) => a.address).filter((a): a is string => Boolean(a)),
              },
              isGroup: false,
            };

            await this.notifyHandlers(message);

            if (this.config.markAsRead !== false && msg.uid) {
              await client.messageFlagsAdd(msg.uid, ['\\Seen']);
            }
          } catch (parseError) {
            logger.error({ err: parseError, adapterId: this.id, uid: msg.uid }, 'Email message parse failed');
          }
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      logger.error({ err: error, adapterId: this.id }, 'Email IMAP connection failed');
    } finally {
      await client.logout().catch(() => {});
      this.polling = false;
    }
  }
}
