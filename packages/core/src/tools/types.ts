// Tool system types and interfaces

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
  required?: string[];
  items?: ToolParameter;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  output: unknown;
  error?: string;
  duration?: number;
}

export interface Tool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolContext {
  sessionId: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}
