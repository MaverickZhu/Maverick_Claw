import { afterEach, describe, expect, it, vi } from 'vitest';
import { LarkAdapter } from './lark.js';

describe('LarkAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return challenge for url verification', async () => {
    const adapter = new LarkAdapter('lark-main', 'Lark Main', {
      webhookPath: '/api/webhooks/lark-main',
      verificationToken: 'verify-token',
    });
    await adapter.initialize({});
    await adapter.start();

    const result = await adapter.processWebhook({
      type: 'url_verification',
      token: 'verify-token',
      challenge: 'challenge-value',
    });

    expect(result.kind).toBe('response');
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ challenge: 'challenge-value' });
  });

  it('should parse incoming text message event', async () => {
    const adapter = new LarkAdapter('lark-main', 'Lark Main', {
      webhookPath: '/api/webhooks/lark-main',
    });
    await adapter.initialize({});
    await adapter.start();

    const handler = vi.fn();
    adapter.onMessage(handler);

    const now = Date.now();
    const result = await adapter.processWebhook({
      schema: '2.0',
      header: {
        event_type: 'im.message.receive_v1',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_test_user',
            name: 'Alice',
          },
        },
        message: {
          message_id: 'om_test_message',
          chat_id: 'oc_test_group',
          chat_type: 'group',
          message_type: 'text',
          content: '{"text":"你好，飞书"}',
          create_time: String(now),
        },
      },
    });

    expect(result.kind).toBe('message');
    expect(result.message).toMatchObject({
      id: 'om_test_message',
      userId: 'ou_test_user',
      content: '你好，飞书',
      isGroup: true,
      groupId: 'oc_test_group',
      channelType: 'lark',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should send direct message via lark open api', async () => {
    const adapter = new LarkAdapter('lark-main', 'Lark Main', {
      webhookPath: '/api/webhooks/lark-main',
      appId: 'cli_app_id',
      appSecret: 'cli_app_secret',
    });
    await adapter.initialize({});
    await adapter.start();

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: 'tenant-token',
            expire: 7200,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              message_id: 'om_outbound_message',
            },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendDirectMessage('ou_test_user', { content: 'pong' });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('om_outbound_message');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('receive_id_type=open_id');
  });

  it('should fallback to bot webhook sending', async () => {
    const adapter = new LarkAdapter('lark-main', 'Lark Main', {
      webhookPath: '/api/webhooks/lark-main',
      botWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
    });
    await adapter.initialize({});
    await adapter.start();

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          StatusCode: 0,
          StatusMessage: 'success',
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendMessage('oc_test_group', { content: 'hello via webhook' });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
