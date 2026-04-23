import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailAdapter } from './email.js';

// Mock dependencies
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue([]),
    fetch: vi.fn().mockImplementation(async function* () { /* no messages */ }),
    messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('mailparser', () => ({
  simpleParser: vi.fn(),
}));

import { createTransport } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

describe('EmailAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const defaultConfig = {
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'user@example.com',
    smtpPassword: 'smtp-pass',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'user@example.com',
    imapPassword: 'imap-pass',
    fromAddress: 'bot@example.com',
  };

  it('should initialize and start with SMTP + IMAP', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', defaultConfig);
    await adapter.initialize({});

    const mockTransporter = { sendMail: vi.fn() };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    await adapter.start();

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user@example.com', pass: 'smtp-pass' },
      })
    );
    expect(await adapter.health()).toBe(true);

    await adapter.stop();
  });

  it('should stop and clear health', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', defaultConfig);
    await adapter.initialize({});

    const mockTransporter = { sendMail: vi.fn() };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    await adapter.start();
    await adapter.stop();

    expect(await adapter.health()).toBe(false);
  });

  it('should send email via SMTP', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', defaultConfig);
    await adapter.initialize({});

    const mockSendMail = vi.fn().mockResolvedValue({ messageId: '<msg-123>' });
    const mockTransporter = { sendMail: mockSendMail };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    await adapter.start();

    const result = await adapter.sendMessage('recipient@example.com', {
      content: 'Hello via email',
      metadata: { subject: 'Test Subject' },
    });

    expect(result.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'bot@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Hello via email',
      })
    );

    await adapter.stop();
  });

  it('should return error when adapter not started', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', defaultConfig);
    await adapter.initialize({});

    const result = await adapter.sendMessage('recipient@example.com', { content: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not started');
  });

  it('should return error when SMTP not configured', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', {
      ...defaultConfig,
      smtpHost: '',
    });
    await adapter.initialize({});
    await adapter.start();

    const result = await adapter.sendMessage('recipient@example.com', { content: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SMTP transporter not configured');

    await adapter.stop();
  });

  it('should poll IMAP inbox and notify handlers', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', {
      ...defaultConfig,
      pollingInterval: 3600, // large interval so only initial poll runs
    });
    await adapter.initialize({});

    const mockTransporter = { sendMail: vi.fn() };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    const handler = vi.fn();
    adapter.onMessage(handler);

    // Mock ImapFlow
    const mockFetch = vi.fn().mockImplementation(async function* () {
      yield {
        uid: 101,
        envelope: {
          from: [{ address: 'sender@example.com', name: 'Sender' }],
          to: [{ address: 'user@example.com' }],
          subject: 'Test Email',
        },
        source: Buffer.from('raw email'),
      };
    });

    const mockMessageFlagsAdd = vi.fn().mockResolvedValue(undefined);
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockRelease = vi.fn();

    vi.mocked(ImapFlow).mockImplementation(
      () =>
        ({
          connect: vi.fn().mockResolvedValue(undefined),
          getMailboxLock: vi.fn().mockResolvedValue({ release: mockRelease }),
          search: vi.fn().mockResolvedValue([101]),
          fetch: mockFetch,
          messageFlagsAdd: mockMessageFlagsAdd,
          logout: mockLogout,
        }) as unknown as ImapFlow
    );

    vi.mocked(simpleParser).mockResolvedValue({
      subject: 'Test Email',
      text: 'Hello world',
      from: { text: 'sender@example.com' },
      date: new Date('2024-01-01T00:00:00Z'),
      messageId: '<msg-101>',
    } as Awaited<ReturnType<typeof simpleParser>>);

    await adapter.start();

    // Wait for initial poll + interval
    await vi.advanceTimersByTimeAsync(2000);

    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'user@example.com', pass: 'imap-pass' },
      })
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'email',
        channelId: 'email-main',
        userId: 'sender@example.com',
        userName: 'Sender',
        content: 'Subject: Test Email\n\nHello world',
        isGroup: false,
      })
    );
    expect(mockMessageFlagsAdd).toHaveBeenCalledWith(101, ['\\Seen']);

    await adapter.stop();
  });

  it('should skip polling when IMAP is not configured', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', {
      ...defaultConfig,
      imapHost: '',
    });
    await adapter.initialize({});

    const mockTransporter = { sendMail: vi.fn() };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    await adapter.start();

    // No ImapFlow should be created
    expect(ImapFlow).not.toHaveBeenCalled();

    await adapter.stop();
  });

  it('should handle IMAP connection errors gracefully', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', {
      ...defaultConfig,
      pollingInterval: 1,
    });
    await adapter.initialize({});

    const mockTransporter = { sendMail: vi.fn() };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    vi.mocked(ImapFlow).mockImplementation(
      () =>
        ({
          connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
          logout: vi.fn().mockResolvedValue(undefined),
        }) as unknown as ImapFlow
    );

    await adapter.start();

    // Wait for initial poll
    await vi.advanceTimersByTimeAsync(1500);

    // Should not throw; error is logged
    expect(ImapFlow).toHaveBeenCalled();

    await adapter.stop();
  });

  it('should send direct message and reply', async () => {
    const adapter = new EmailAdapter('email-main', 'Email Main', defaultConfig);
    await adapter.initialize({});

    const mockSendMail = vi.fn().mockResolvedValue({ messageId: '<msg-456>' });
    const mockTransporter = { sendMail: mockSendMail };
    vi.mocked(createTransport).mockReturnValue(mockTransporter as unknown as ReturnType<typeof createTransport>);

    await adapter.start();

    const directResult = await adapter.sendDirectMessage('user@example.com', {
      content: 'Direct message',
    });
    expect(directResult.success).toBe(true);

    const replyResult = await adapter.replyToMessage('msg-123', 'user@example.com', {
      content: 'Reply message',
    });
    expect(replyResult.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(2);

    await adapter.stop();
  });
});
