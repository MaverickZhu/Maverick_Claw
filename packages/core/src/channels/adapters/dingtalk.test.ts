import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingTalkAdapter } from './dingtalk.js';

describe('DingTalkAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return challenge for url verification', async () => {
    const adapter = new DingTalkAdapter('ding-main', 'Ding Main', {
      webhookPath: '/api/webhooks/ding-main',
      verificationToken: 'ding-token',
    });
    await adapter.initialize({});
    await adapter.start();

    const result = await adapter.processWebhook({
      challenge: 'challenge-value',
      token: 'ding-token',
    });

    expect(result.kind).toBe('response');
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ challenge: 'challenge-value' });
  });

  it('should parse incoming text message event', async () => {
    const adapter = new DingTalkAdapter('ding-main', 'Ding Main', {
      webhookPath: '/api/webhooks/ding-main',
    });
    await adapter.initialize({});
    await adapter.start();

    const handler = vi.fn();
    adapter.onMessage(handler);

    const result = await adapter.processWebhook({
      msgId: 'msg-1001',
      senderStaffId: 'staff-1',
      senderNick: 'Bob',
      text: {
        content: '你好，钉钉',
      },
      conversationId: 'cid-001',
      conversationType: '2',
      createAt: Date.now(),
      msgtype: 'text',
    });

    expect(result.kind).toBe('message');
    expect(result.message).toMatchObject({
      id: 'msg-1001',
      userId: 'staff-1',
      userName: 'Bob',
      content: '你好，钉钉',
      isGroup: true,
      groupId: 'cid-001',
      channelType: 'dingtalk',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should send message via outgoing webhook', async () => {
    const adapter = new DingTalkAdapter('ding-main', 'Ding Main', {
      webhookPath: '/api/webhooks/ding-main',
      outgoingWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
    });
    await adapter.initialize({});
    await adapter.start();

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errcode: 0,
          errmsg: 'ok',
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendMessage('cid-001', { content: 'pong' });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should sign webhook url when secret is configured', async () => {
    const adapter = new DingTalkAdapter('ding-main', 'Ding Main', {
      webhookPath: '/api/webhooks/ding-main',
      outgoingWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
      outgoingSecret: 'SECxxxx',
    });
    await adapter.initialize({});
    await adapter.start();

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errcode: 0,
          errmsg: 'ok',
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendDirectMessage('staff-1', { content: 'signed message' });

    expect(result.success).toBe(true);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] || '');
    expect(calledUrl).toContain('timestamp=');
    expect(calledUrl).toContain('sign=');
  });
});
