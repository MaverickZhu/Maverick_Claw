import { z } from 'zod';
import type { ChannelType } from './types.js';

const webhookChannelConfigSchema = z
  .object({
    secret: z.string().min(1).optional(),
    verifySignature: z.boolean().optional(),
  })
  .passthrough();

const larkChannelConfigSchema = z
  .object({
    verificationToken: z.string().min(1).optional(),
    appId: z.string().min(1).optional(),
    appSecret: z.string().min(1).optional(),
    botWebhookUrl: z.string().url().optional(),
    botWebhookSecret: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.appId && !value.appSecret) || (!value.appId && value.appSecret)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'appId 与 appSecret 必须同时配置',
      });
    }

    if (value.botWebhookSecret && !value.botWebhookUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '配置 botWebhookSecret 时必须同时配置 botWebhookUrl',
      });
    }
  });

const dingtalkChannelConfigSchema = z
  .object({
    verificationToken: z.string().min(1).optional(),
    outgoingWebhookUrl: z.string().url().optional(),
    outgoingSecret: z.string().min(1).optional(),
    // 兼容旧字段写法
    webhookUrl: z.string().url().optional(),
    secret: z.string().min(1).optional(),
  })
  .transform((value) => ({
    verificationToken: value.verificationToken,
    outgoingWebhookUrl: value.outgoingWebhookUrl ?? value.webhookUrl,
    outgoingSecret: value.outgoingSecret ?? value.secret,
  }))
  .superRefine((value, ctx) => {
    if (value.outgoingSecret && !value.outgoingWebhookUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '配置 outgoingSecret 时必须同时配置 outgoingWebhookUrl',
      });
    }
  });

const wechatChannelConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    name: z.string().min(1).optional(),
    puppet: z.string().min(1).optional(),
  })
  .passthrough();

const passthroughChannelConfigSchema = z.record(z.unknown()).default({});

const wecomChannelConfigSchema = z.object({
  corpId: z.string().min(1),
  corpSecret: z.string().min(1),
  agentId: z.string().min(1),
  token: z.string().min(1).optional(),
});

const emailChannelConfigSchema = z.object({
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().min(1),
  smtpPassword: z.string().min(1),
  smtpSecure: z.boolean().optional(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapUser: z.string().min(1),
  imapPassword: z.string().min(1),
  imapSecure: z.boolean().optional(),
  fromAddress: z.string().email(),
  pollingInterval: z.number().int().min(5).optional(),
  markAsRead: z.boolean().optional(),
});

const channelConfigSchemas = {
  webhook: webhookChannelConfigSchema,
  custom: webhookChannelConfigSchema,
  lark: larkChannelConfigSchema,
  dingtalk: dingtalkChannelConfigSchema,
  webchat: passthroughChannelConfigSchema,
  wechat: wechatChannelConfigSchema,
  wecom: wecomChannelConfigSchema,
  email: emailChannelConfigSchema,
  telegram: passthroughChannelConfigSchema,
  slack: passthroughChannelConfigSchema,
} as const;

export type WebhookChannelConfig = z.infer<typeof webhookChannelConfigSchema>;
export type LarkChannelConfig = z.infer<typeof larkChannelConfigSchema>;
export type DingTalkChannelConfig = z.infer<typeof dingtalkChannelConfigSchema>;

export interface ChannelContractDescriptor {
  type: ChannelType;
  displayName: string;
  auth: {
    inbound: string[];
    outbound: string[];
  };
  configFields: Array<{
    name: string;
    required: boolean;
    description: string;
  }>;
  routing: {
    normalizedMessageFields: string[];
    metadataFields: string[];
    queueContract: string;
  };
}

const defaultRoutingDescriptor: ChannelContractDescriptor['routing'] = {
  normalizedMessageFields: [
    'id',
    'channelType',
    'channelId',
    'userId',
    'content',
    'contentType',
    'timestamp',
    'isGroup',
  ],
  metadataFields: ['groupId', 'userName', 'mentions', 'metadata'],
  queueContract: "Queue(messages): type='incoming', payload={channelId,userId,content,messageId,metadata,timestamp}",
};

const channelContractDescriptors: Record<ChannelType, ChannelContractDescriptor> = {
  webchat: {
    type: 'webchat',
    displayName: 'WebChat',
    auth: { inbound: ['gateway-auth'], outbound: ['gateway-auth'] },
    configFields: [],
    routing: defaultRoutingDescriptor,
  },
  wechat: {
    type: 'wechat',
    displayName: '微信',
    auth: { inbound: ['wechaty-qr-scan'], outbound: ['wechaty-message-say'] },
    configFields: [
      { name: 'enabled', required: true, description: '是否启用微信适配器（需安装 wechaty）' },
      { name: 'name', required: false, description: 'Bot 名称（用于 wechaty 缓存）' },
      { name: 'puppet', required: false, description: 'Puppet 提供者（如 wechaty-puppet-wechat）' },
    ],
    routing: defaultRoutingDescriptor,
  },
  dingtalk: {
    type: 'dingtalk',
    displayName: '钉钉',
    auth: { inbound: ['verification-token (optional)'], outbound: ['webhook-signature (optional)'] },
    configFields: [
      { name: 'verificationToken', required: false, description: '回调校验 Token' },
      { name: 'outgoingWebhookUrl', required: false, description: '机器人发送消息 Webhook 地址' },
      { name: 'outgoingSecret', required: false, description: '机器人签名密钥（SEC...）' },
    ],
    routing: defaultRoutingDescriptor,
  },
  lark: {
    type: 'lark',
    displayName: '飞书',
    auth: { inbound: ['verification-token (optional)'], outbound: ['app-credential or bot-webhook'] },
    configFields: [
      { name: 'verificationToken', required: false, description: '事件订阅 URL 验证 Token' },
      { name: 'appId', required: false, description: '开放平台 App ID（与 appSecret 配套）' },
      { name: 'appSecret', required: false, description: '开放平台 App Secret（与 appId 配套）' },
      { name: 'botWebhookUrl', required: false, description: '机器人 Webhook 地址（回退发送链路）' },
      { name: 'botWebhookSecret', required: false, description: '机器人签名密钥' },
    ],
    routing: defaultRoutingDescriptor,
  },
  wecom: {
    type: 'wecom',
    displayName: '企业微信',
    auth: { inbound: ['url-verification (optional)'], outbound: ['corp-credential'] },
    configFields: [
      { name: 'corpId', required: true, description: '企业微信 CorpID' },
      { name: 'corpSecret', required: true, description: '应用 Secret' },
      { name: 'agentId', required: true, description: '应用 AgentID' },
      { name: 'token', required: false, description: '回调校验 Token（明文模式 URL 验证）' },
    ],
    routing: defaultRoutingDescriptor,
  },
  email: {
    type: 'email',
    displayName: '邮件',
    auth: { inbound: ['imap-auth'], outbound: ['smtp-auth'] },
    configFields: [
      { name: 'smtpHost', required: true, description: 'SMTP 服务器地址' },
      { name: 'smtpPort', required: true, description: 'SMTP 端口（如 587/465/25）' },
      { name: 'smtpUser', required: true, description: 'SMTP 用户名' },
      { name: 'smtpPassword', required: true, description: 'SMTP 密码' },
      { name: 'smtpSecure', required: false, description: 'SMTP 是否使用 TLS（默认端口 465 时自动启用）' },
      { name: 'imapHost', required: true, description: 'IMAP 服务器地址' },
      { name: 'imapPort', required: true, description: 'IMAP 端口（如 993/143）' },
      { name: 'imapUser', required: true, description: 'IMAP 用户名' },
      { name: 'imapPassword', required: true, description: 'IMAP 密码' },
      { name: 'imapSecure', required: false, description: 'IMAP 是否使用 TLS（默认端口 993 时自动启用）' },
      { name: 'fromAddress', required: true, description: '发件人邮箱地址' },
      { name: 'pollingInterval', required: false, description: 'IMAP 轮询间隔（秒，最小 5，默认 60）' },
      { name: 'markAsRead', required: false, description: '接收后是否标记为已读（默认 true）' },
    ],
    routing: defaultRoutingDescriptor,
  },
  webhook: {
    type: 'webhook',
    displayName: 'Webhook',
    auth: { inbound: ['shared-secret (optional)'], outbound: ['none'] },
    configFields: [
      { name: 'secret', required: false, description: '请求签名密钥' },
      { name: 'verifySignature', required: false, description: '是否开启签名校验' },
    ],
    routing: defaultRoutingDescriptor,
  },
  telegram: {
    type: 'telegram',
    displayName: 'Telegram',
    auth: { inbound: ['bot-token'], outbound: ['bot-token'] },
    configFields: [],
    routing: defaultRoutingDescriptor,
  },
  slack: {
    type: 'slack',
    displayName: 'Slack',
    auth: { inbound: ['signing-secret'], outbound: ['bot-token'] },
    configFields: [],
    routing: defaultRoutingDescriptor,
  },
  custom: {
    type: 'custom',
    displayName: 'Custom',
    auth: { inbound: ['custom'], outbound: ['custom'] },
    configFields: [],
    routing: defaultRoutingDescriptor,
  },
};

function getSchema(type: ChannelType) {
  return channelConfigSchemas[type] ?? passthroughChannelConfigSchema;
}

function compactUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined));
}

export function parseChannelConfig(type: ChannelType, config: Record<string, unknown> | undefined): Record<string, unknown> {
  const parsed = getSchema(type).parse(config ?? {});
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return compactUndefined(parsed as Record<string, unknown>);
  }
  return {};
}

export function safeParseChannelConfig(
  type: ChannelType,
  config: Record<string, unknown> | undefined
): z.SafeParseReturnType<Record<string, unknown>, Record<string, unknown>> {
  const parsed = getSchema(type).safeParse(config ?? {});
  if (!parsed.success) {
    return parsed as z.SafeParseReturnType<Record<string, unknown>, Record<string, unknown>>;
  }

  if (typeof parsed.data === 'object' && parsed.data !== null && !Array.isArray(parsed.data)) {
    return {
      success: true,
      data: compactUndefined(parsed.data as Record<string, unknown>),
    };
  }

  return {
    success: true,
    data: {},
  };
}

export function getChannelContract(type: ChannelType): ChannelContractDescriptor {
  return channelContractDescriptors[type] ?? channelContractDescriptors.custom;
}

export function listChannelContracts(): ChannelContractDescriptor[] {
  return Object.values(channelContractDescriptors);
}
