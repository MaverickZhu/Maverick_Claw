// Core types for Maverick_Claw

export interface User {
  id: string;
  name: string;
  email?: string;
  roleId?: string;
  roleName?: string;
  status?: 'active' | 'inactive';
  authProvider?: 'local' | 'oauth' | 'ldap';
  externalId?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Role {
  id: string;
  name: string;
  scopes: string[];
  isBuiltin: boolean;
  createdAt: Date;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  ownerId?: string;
  isBuiltin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
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

export interface FileAttachment {
  fileId: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
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
    attachments?: FileAttachment[];
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
    type: 'token' | 'oauth' | 'ldap' | 'none';
    token?: string;
    oauth?: {
      providers: Array<{
        id: string;
        name: string;
        type: 'oidc' | 'oauth2';
        clientId: string;
        clientSecret: string;
        issuerUrl?: string;
        authorizationUrl?: string;
        tokenUrl?: string;
        userinfoUrl?: string;
        redirectUri: string;
        scopes: string[];
        enabled: boolean;
        roleMapping?: Record<string, string>;
      }>;
    };
    ldap?: {
      enabled: boolean;
      server: string;
      bindDN?: string;
      bindPassword?: string;
      baseDN: string;
      userFilter: string;
      groupFilter?: string;
      tls: boolean;
      tlsOptions?: Record<string, unknown>;
      groupRoleMapping?: Record<string, string>;
      defaultRoleId?: string;
    };
  };
  models: ModelConfig[];
  defaultModel?: string;
  channels: ChannelConfig[];
  plugins?: {
    registryUrl?: string;
  };
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
