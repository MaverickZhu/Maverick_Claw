// WebSocket Protocol for Maverick_Claw Gateway
// Based on OpenClaw protocol design, simplified for MVP

export interface GatewayErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface SessionSummary {
  id: string;
  title: string;
  modelId?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  messageCount?: number;
}

export interface SessionMessageSnapshot {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string | Date;
}

export interface SessionsListResponsePayload {
  sessions: SessionSummary[];
}

export interface SessionMessagesResponsePayload {
  messages: SessionMessageSnapshot[];
}

export interface ChatChunkEventPayload {
  content: string;
  done: boolean;
  sessionId?: string;
}

export interface ChatCompleteEventPayload {
  done: boolean;
  sessionId?: string;
}

export interface ChatErrorEventPayload {
  error: string;
  errorCode?: string;
  sessionId?: string;
}

// Connection & Handshake
export interface ConnectRequest {
  type: 'connect';
  id: string;
  params: {
    clientType: 'web' | 'cli' | 'node' | 'mobile';
    clientVersion: string;
    deviceId: string;
    token?: string;
    capabilities?: string[];
  };
}

export interface ConnectResponse {
  type: 'connect';
  id: string;
  ok: boolean;
  error?: string;
  errorDetail?: GatewayErrorDetail;
  payload?: {
    serverVersion: string;
    sessionToken?: string;
    authenticated?: boolean;
    recovered?: boolean;
    scopes?: string[];
    config: {
      models: string[];
      channels: string[];
    };
  };
}

// Request/Response pattern
export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: unknown;
}

export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  error?: string;
  errorDetail?: GatewayErrorDetail;
  payload?: unknown;
}

// Server-sent events
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
  seq?: number;
  timestamp: number;
}

export interface GatewayError {
  type: 'error';
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

// Specific request methods
export type GatewayMethod =
  | 'health'
  | 'status'
  | 'sessions.list'
  | 'sessions.create'
  | 'sessions.get'
  | 'sessions.delete'
  | 'sessions.watch'
  | 'sessions.unwatch'
  | 'chat.send'
  | 'chat.stream'
  | 'workflow.list'
  | 'workflow.run'
  | 'models.list'
  | 'models.capabilities'
  | 'channels.list'
  | 'config.get'
  | 'config.set';

// Chat specific types
export interface ChatSendRequest {
  sessionId: string;
  message: string;
  modelId?: string;
  attachments?: Attachment[];
}

export interface Attachment {
  type: 'image' | 'file';
  name: string;
  url: string;
  mimeType: string;
}

export interface ChatStreamEvent {
  type: 'chunk' | 'done' | 'error';
  content?: string;
  messageId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  error?: string;
}

// Agent event types
export interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message';
  content: unknown;
  timestamp: number;
}

// Union type for all protocol messages
export type ProtocolMessage = 
  | ConnectRequest 
  | ConnectResponse 
  | GatewayRequest 
  | GatewayResponse 
  | GatewayEvent
  | GatewayError;

// Helper functions
export function createRequest(id: string, method: string, params: unknown): GatewayRequest {
  return { type: 'req', id, method, params };
}

export function createResponse(
  id: string,
  ok: boolean,
  payload?: unknown,
  error?: string,
  errorDetail?: GatewayErrorDetail
): GatewayResponse {
  return { type: 'res', id, ok, payload, error, errorDetail };
}

export function createEvent(event: string, payload: unknown): GatewayEvent {
  return { type: 'event', event, payload, timestamp: Date.now() };
}
