import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeComAdapter } from './wecom.js';

describe('WeComAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize and start', async () => {
    const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
      corpId: 'corp-id',
      corpSecret: 'corp-secret',
      agentId: '1000002',
    });
    await adapter.initialize({ token: 'my-token' });
    await adapter.start();

    expect(await adapter.health()).toBe(true);
  });

  it('should stop and clear health', async () => {
    const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
      corpId: 'corp-id',
      corpSecret: 'corp-secret',
      agentId: '1000002',
    });
    await adapter.initialize({});
    await adapter.start();
    await adapter.stop();

    expect(await adapter.health()).toBe(false);
  });

  describe('verifyWebhookUrl', () => {
    it('should return echostr on successful verification without token', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});

      const result = await adapter.verifyWebhookUrl({
        echostr: 'hello-wecom',
        timestamp: '1234567890',
        nonce: 'nonce123',
      });

      expect(result.kind).toBe('success');
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('hello-wecom');
    });

    it('should verify signature when token is configured', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
        token: 'verify-token',
      });
      await adapter.initialize({});

      // Compute expected signature
      const sorted = ['verify-token', '1234567890', 'nonce123', 'hello-wecom'].sort().join('');
      const expectedSig = await import('node:crypto').then((m) =>
        m.createHash('sha1').update(sorted).digest('hex')
      );

      const result = await adapter.verifyWebhookUrl({
        echostr: 'hello-wecom',
        timestamp: '1234567890',
        nonce: 'nonce123',
        msg_signature: expectedSig,
      });

      expect(result.kind).toBe('success');
      expect(result.body).toBe('hello-wecom');
    });

    it('should reject invalid signature', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
        token: 'verify-token',
      });
      await adapter.initialize({});

      const result = await adapter.verifyWebhookUrl({
        echostr: 'hello-wecom',
        timestamp: '1234567890',
        nonce: 'nonce123',
        msg_signature: 'invalid-signature',
      });

      expect(result.kind).toBe('error');
      expect(result.statusCode).toBe(403);
    });

    it('should ignore when echostr is missing', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});

      const result = await adapter.verifyWebhookUrl({
        timestamp: '1234567890',
        nonce: 'nonce123',
      });

      expect(result.kind).toBe('ignored');
      expect(result.statusCode).toBe(400);
    });
  });

  describe('processWebhook', () => {
    it('should parse text message from XML', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});
      await adapter.start();

      const handler = vi.fn();
      adapter.onMessage(handler);

      const xml = `<xml>
        <ToUserName><![CDATA[toUser]]></ToUserName>
        <FromUserName><![CDATA[fromUser123]]></FromUserName>
        <CreateTime>1348831860</CreateTime>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[Hello WeCom]]></Content>
        <MsgId>1234567890123456</MsgId>
        <AgentID>1</AgentID>
      </xml>`;

      const result = await adapter.processWebhook(xml);

      expect(result.kind).toBe('message');
      expect(result.message).toMatchObject({
        channelType: 'wecom',
        channelId: 'wecom-main',
        userId: 'fromUser123',
        content: 'Hello WeCom',
        contentType: 'text',
        isGroup: false,
      });
      expect(result.message?.id).toBe('1234567890123456');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should ignore non-string payload', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});

      const result = await adapter.processWebhook({ foo: 'bar' });

      expect(result.kind).toBe('ignored');
      expect(result.statusCode).toBe(400);
    });

    it('should ignore missing FromUserName', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});

      const xml = `<xml>
        <ToUserName><![CDATA[toUser]]></ToUserName>
        <CreateTime>1348831860</CreateTime>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[Hello]]></Content>
      </xml>`;

      const result = await adapter.processWebhook(xml);

      expect(result.kind).toBe('ignored');
      expect(result.statusCode).toBe(400);
    });

    it('should map image message content type', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});
      await adapter.start();

      const xml = `<xml>
        <ToUserName><![CDATA[toUser]]></ToUserName>
        <FromUserName><![CDATA[user1]]></FromUserName>
        <CreateTime>1348831860</CreateTime>
        <MsgType><![CDATA[image]]></MsgType>
        <PicUrl><![CDATA[http://pic.url]]></PicUrl>
        <MediaId><![CDATA[media-id-123]]></MediaId>
        <MsgId>1234567890123457</MsgId>
      </xml>`;

      const result = await adapter.processWebhook(xml);

      expect(result.kind).toBe('message');
      expect(result.message?.contentType).toBe('image');
      expect(result.message?.content).toBe('[image]');
    });

    it('should ignore subscribe event', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});

      const xml = `<xml>
        <ToUserName><![CDATA[toUser]]></ToUserName>
        <FromUserName><![CDATA[user1]]></FromUserName>
        <CreateTime>1348831860</CreateTime>
        <MsgType><![CDATA[event]]></MsgType>
        <Event><![CDATA[subscribe]]></Event>
      </xml>`;

      const result = await adapter.processWebhook(xml);

      expect(result.kind).toBe('ignored');
      expect(result.statusCode).toBe(200);
    });
  });

  describe('sendMessage', () => {
    it('should send message via API with access token', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});
      await adapter.start();

      const fetchMock = vi.fn<typeof fetch>();

      // First call: get access_token
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errcode: 0,
            access_token: 'token-abc',
            expires_in: 7200,
          }),
          { status: 200 }
        )
      );

      // Second call: send message
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errcode: 0,
            errmsg: 'ok',
            msgid: 'msg-123',
          }),
          { status: 200 }
        )
      );

      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.sendMessage('user1', { content: 'Hello from WeCom' });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const sendCall = fetchMock.mock.calls[1];
      const sendUrl = String(sendCall?.[0] || '');
      expect(sendUrl).toContain('access_token=token-abc');

      const sendBody = JSON.parse(String(sendCall?.[1]?.body || '{}'));
      expect(sendBody.touser).toBe('user1');
      expect(sendBody.msgtype).toBe('text');
      expect(sendBody.agentid).toBe(1000002);
      expect(sendBody.text.content).toBe('Hello from WeCom');
    });

    it('should return error when corp credentials are missing', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: '',
        corpSecret: '',
        agentId: '',
      });
      await adapter.initialize({});
      await adapter.start();

      const result = await adapter.sendMessage('user1', { content: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('corpId');
    });

    it('should handle API error response', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});
      await adapter.start();

      const fetchMock = vi.fn<typeof fetch>();

      // gettoken
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errcode: 0,
            access_token: 'token-abc',
            expires_in: 7200,
          }),
          { status: 200 }
        )
      );

      // send message - API error
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errcode: 40014,
            errmsg: 'invalid access_token',
          }),
          { status: 200 }
        )
      );

      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.sendDirectMessage('user1', { content: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid access_token');
    });

    it('should cache access token', async () => {
      const adapter = new WeComAdapter('wecom-main', 'WeCom Main', {
        corpId: 'corp-id',
        corpSecret: 'corp-secret',
        agentId: '1000002',
      });
      await adapter.initialize({});
      await adapter.start();

      const fetchMock = vi.fn<typeof fetch>();

      // gettoken - called once
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errcode: 0,
            access_token: 'token-abc',
            expires_in: 7200,
          }),
          { status: 200 }
        )
      );

      // send message x2
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ errcode: 0, errmsg: 'ok' }),
          { status: 200 }
        )
      );

      vi.stubGlobal('fetch', fetchMock);

      await adapter.sendMessage('user1', { content: 'msg1' });
      await adapter.sendMessage('user2', { content: 'msg2' });

      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 token + 2 sends
    });
  });
});
