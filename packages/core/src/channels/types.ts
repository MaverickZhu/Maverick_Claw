// Channel types and interfaces

export type ChannelType = 
  | 'webchat'
  | 'wechat'
  | 'dingtalk'
  | 'lark'
  | 'wecom'
  | 'email'
  | 'webhook'
  | 'telegram'
  | 'slack'
  | 'custom';

export interface ChannelMessage {
  id: string;
  channelType: ChannelType;
  channelId: string;
  userId: string;
  userName?: string;
  content: string;
  contentType: 'text' | 'image' | 'file' | 'voice' | 'video';
  timestamp: Date;
  metadata?: Record<string, unknown>;
  // For group chats
  groupId?: string;
  groupName?: string;
  isGroup: boolean;
  // Mentions
  mentions?: Array<{
    userId: string;
    userName?: string;
  }>;
}

export interface ChannelResponse {
  messageId?: string;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export interface SendMessageOptions {
  content: string;
  contentType?: 'text' | 'markdown' | 'image' | 'file';
  mentions?: string[];
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  id: string;
  type: ChannelType;
  name: string;
  
  // Lifecycle
  initialize(config: Record<string, unknown>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // Health check
  health(): Promise<boolean>;
  
  // Message handling
  onMessage(handler: (message: ChannelMessage) => Promise<void> | void): void;
  offMessage(handler: (message: ChannelMessage) => Promise<void> | void): void;
  
  // Send message
  sendMessage(channelId: string, options: SendMessageOptions): Promise<ChannelResponse>;
  sendDirectMessage(userId: string, options: SendMessageOptions): Promise<ChannelResponse>;
  
  // Reply to specific message
  replyToMessage(messageId: string, channelId: string, options: SendMessageOptions): Promise<ChannelResponse>;
}

export interface ChannelConfig {
  id: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  webhookUrl?: string;
  secret?: string;
  token?: string;
}

export interface AdapterWebhookResult {
  kind: 'message' | 'response' | 'ignored';
  message?: ChannelMessage;
  statusCode?: number;
  body?: unknown;
}

export interface WebhookUrlVerificationResult {
  kind: 'success' | 'ignored' | 'error';
  statusCode?: number;
  body?: unknown;
}

export interface WebhookCapableAdapter extends ChannelAdapter {
  processWebhook(payload: unknown, signature?: string): Promise<AdapterWebhookResult>;
  verifyWebhookUrl?(query: Record<string, string | string[] | undefined>): Promise<WebhookUrlVerificationResult>;
}

export function createChannelError(error: string): ChannelResponse {
  return {
    success: false,
    error,
    timestamp: new Date(),
  };
}

export function createChannelSuccess(options?: { messageId?: string }): ChannelResponse {
  return {
    success: true,
    messageId: options?.messageId,
    timestamp: new Date(),
  };
}
