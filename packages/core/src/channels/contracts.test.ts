import { describe, it, expect } from 'vitest';
import { parseChannelConfig, safeParseChannelConfig, listChannelContracts } from './contracts.js';

describe('Channel contracts', () => {
  it('should normalize dingtalk legacy config keys', () => {
    const config = parseChannelConfig('dingtalk', {
      verificationToken: 'token',
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
      secret: 'SEC-legacy',
    });

    expect(config).toEqual({
      verificationToken: 'token',
      outgoingWebhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
      outgoingSecret: 'SEC-legacy',
    });
  });

  it('should reject lark app credential partial config', () => {
    const result = safeParseChannelConfig('lark', {
      appId: 'cli_test_app',
    });

    expect(result.success).toBe(false);
  });

  it('should expose route and auth contract descriptors', () => {
    const contracts = listChannelContracts();
    const dingtalk = contracts.find((item) => item.type === 'dingtalk');

    expect(dingtalk).toBeDefined();
    expect(dingtalk?.auth.inbound).toContain('verification-token (optional)');
    expect(dingtalk?.routing.queueContract).toContain('Queue(messages)');
  });
});
