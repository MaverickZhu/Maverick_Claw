import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeChatAdapter } from './wechat.js';

const mockSay = vi.fn().mockResolvedValue(undefined);

function createMockMessage(overrides?: {
  id?: string;
  text?: string;
  talkerId?: string;
  talkerName?: string;
  room?: { id: string; topic: string } | null;
  mentionSelf?: boolean;
}) {
  const roomValue = overrides?.room
    ? { id: overrides.room.id, topic: vi.fn().mockReturnValue(overrides.room.topic) }
    : null;

  return {
    id: overrides?.id ?? 'msg-001',
    text: vi.fn().mockReturnValue(overrides?.text ?? '你好'),
    talker: vi.fn().mockReturnValue({
      id: overrides?.talkerId ?? 'user-1',
      name: vi.fn().mockReturnValue(overrides?.talkerName ?? 'Alice'),
    }),
    room: vi.fn().mockReturnValue(roomValue),
    say: mockSay,
    mentionSelf: vi.fn().mockReturnValue(overrides?.mentionSelf ?? false),
  };
}

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn().mockReturnThis();

vi.mock('wechaty', () => ({
  Wechaty: vi.fn().mockImplementation(() => ({
    on: mockOn,
    start: mockStart,
    stop: mockStop,
    logonoff: vi.fn().mockReturnValue(true),
  })),
}));

describe('WeChatAdapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be disabled when enabled is false', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: false });
    await adapter.initialize({});
    await adapter.start();

    await expect(adapter.health()).resolves.toBe(false);
  });

  it('should initialize and start wechaty bot', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true, name: 'test-bot' });
    await adapter.start();

    expect(mockOn).toHaveBeenCalledWith('scan', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('login', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('logout', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockStart).toHaveBeenCalled();
  });

  it('should convert incoming text message and call handlers', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();

    const handler = vi.fn();
    adapter.onMessage(handler);

    const messageHandler = mockOn.mock.calls.find((call) => call[0] === 'message')?.[1];
    expect(messageHandler).toBeDefined();

    const mockMsg = createMockMessage({ text: '你好，微信' });
    await messageHandler(mockMsg);

    expect(handler).toHaveBeenCalledTimes(1);
    const receivedMessage = handler.mock.calls[0][0];
    expect(receivedMessage).toMatchObject({
      userId: 'user-1',
      userName: 'Alice',
      content: '你好，微信',
      channelType: 'wechat',
      isGroup: false,
    });
  });

  it('should convert group message with mention', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();

    const handler = vi.fn();
    adapter.onMessage(handler);

    // Simulate login to set botUserId
    const loginHandler = mockOn.mock.calls.find((call) => call[0] === 'login')?.[1];
    loginHandler({ id: 'bot-1', name: vi.fn().mockReturnValue('Bot') });

    const messageHandler = mockOn.mock.calls.find((call) => call[0] === 'message')?.[1];
    const mockMsg = createMockMessage({
      text: '@Bot 你好',
      room: { id: 'room-1', topic: 'Test Group' },
      mentionSelf: true,
    });
    await messageHandler(mockMsg);

    const receivedMessage = handler.mock.calls[0][0];
    expect(receivedMessage.isGroup).toBe(true);
    expect(receivedMessage.groupId).toBe('room-1');
    expect(receivedMessage.mentions).toEqual([{ userId: 'bot-1', userName: 'Maverick_Claw' }]);
  });

  it('should skip bot own messages', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();

    const handler = vi.fn();
    adapter.onMessage(handler);

    // Simulate login
    const loginHandler = mockOn.mock.calls.find((call) => call[0] === 'login')?.[1];
    loginHandler({ id: 'bot-1', name: vi.fn().mockReturnValue('Bot') });

    const messageHandler = mockOn.mock.calls.find((call) => call[0] === 'message')?.[1];
    const mockMsg = createMockMessage({ talkerId: 'bot-1', text: 'self message' });
    await messageHandler(mockMsg);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should reply to message via say', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();

    const messageHandler = mockOn.mock.calls.find((call) => call[0] === 'message')?.[1];
    const mockMsg = createMockMessage({ id: 'msg-001' });
    await messageHandler(mockMsg);

    const result = await adapter.replyToMessage('msg-001', 'user-1', { content: '回复内容' });

    expect(result.success).toBe(true);
    expect(mockSay).toHaveBeenCalledWith('回复内容');
  });

  it('should fail reply when message not in cache', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();

    const result = await adapter.replyToMessage('unknown-msg', 'user-1', { content: '回复内容' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found in cache');
  });

  it('should return error for direct send', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();

    const sendResult = await adapter.sendMessage('room-1', { content: 'hello' });
    expect(sendResult.success).toBe(false);

    const dmResult = await adapter.sendDirectMessage('user-1', { content: 'hello' });
    expect(dmResult.success).toBe(false);
  });

  it('should stop bot and clean up', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });
    await adapter.start();
    await adapter.stop();

    expect(mockStop).toHaveBeenCalled();
  });

  it('should offMessage remove handler', async () => {
    const adapter = new WeChatAdapter('wechat-main', 'WeChat Main', { enabled: true });
    await adapter.initialize({ enabled: true });

    const handler = vi.fn();
    adapter.onMessage(handler);
    adapter.offMessage(handler);

    const messageHandler = mockOn.mock.calls.find((call) => call[0] === 'message')?.[1];
    const mockMsg = createMockMessage();
    await messageHandler(mockMsg);

    expect(handler).not.toHaveBeenCalled();
  });
});
