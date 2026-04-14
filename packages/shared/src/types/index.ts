// Core types for Maverick_Claw

export interface User {
  id: string;
  name: string;
  email?: string;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: Date;
  metadata?: {
    model?: string;
    tokens?: number;
    tools?: string[];
    toolCalls?: { id: string; name: string; arguments: string }[];
  };
  toolCallId?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  parameters?: Record<string, unknown>;
}

export interface ChannelConfig {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

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

export interface GatewayConfig {
  port: number;
  host: string;
  auth: {
    type: 'token' | 'oauth' | 'none';
    token?: string;
  };
  models: ModelConfig[];
  defaultModel?: string;
  channels: ChannelConfig[];
  storage: {
    type: 'sqlite' | 'postgres';
    url?: string;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: Date;
  services: {
    gateway: boolean;
    database: boolean;
  };
  channels: Record<string, boolean>;
  models: Record<string, boolean>;
}
