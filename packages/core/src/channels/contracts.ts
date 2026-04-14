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

const passthroughChannelConfigSchema = z.record(z.unknown()).default({});

const channelConfigSchemas = {
  webhook: webhookChannelConfigSchema,
  custom: webhookChannelConfigSchema,
  lark: larkChannelConfigSchema,
  dingtalk: dingtalkChannelConfigSchema,
  webchat: passthroughChannelConfigSchema,
  wechat: passthroughChannelConfigSchema,
  wecom: passthroughChannelConfigSchema,
  email: passthroughChannelConfigSchema,
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
    auth: { inbound: ['third-party-signature'], outbound: ['third-party-token'] },
    configFields: [],
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
    auth: { inbound: ['third-party-signature'], outbound: ['third-party-token'] },
    configFields: [],
    routing: defaultRoutingDescriptor,
  },
  email: {
    type: 'email',
    displayName: '邮件',
    auth: { inbound: ['smtp/imap-auth'], outbound: ['smtp-auth'] },
    configFields: [],
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
