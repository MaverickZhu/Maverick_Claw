import { logger } from '../../utils/logger.js';
import type {
  ModelProvider,
  ChatMessage,
  ChatCompletionChunk,
  ModelProviderCapabilities,
} from '../../agent/model.js';

interface QwenConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface QwenStreamDelta {
  content?: string;
  tool_calls?: Array<{
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export class QwenProvider implements ModelProvider {
  id = 'qwen';
  name = '通义千问 (Qwen)';
  private config: QwenConfig = {};
  private readonly capabilities: ModelProviderCapabilities = {
    defaultModel: 'qwen-turbo',
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    parameterSupport: {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 0.7,
      },
      maxTokens: { supported: true },
      toolChoice: { supported: true },
    },
  };

  constructor(config?: QwenConfig) {
    this.config = {
      apiKey: process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-turbo',
      ...config,
    };
  }

  configure(config: QwenConfig): void {
    this.config = { ...this.config, ...config };
  }

  async validateConfig(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async listModels(): Promise<string[]> {
    return ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-coder'];
  }

  getCapabilities(): ModelProviderCapabilities {
    return this.capabilities;
  }

  supportsTools(): boolean {
    return this.capabilities.supportsTools;
  }

  async *chatCompletion(params: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    tools?: import('../../tools/types.js').ToolDefinition[];
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  }): AsyncIterable<ChatCompletionChunk> {
    const { model, messages, temperature = 0.7, maxTokens, stream = true, tools, toolChoice } = params;

    if (!this.config.apiKey) {
      throw new Error('Qwen API key not configured');
    }

    const body: Record<string, unknown> = {
      model: model || this.config.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.toolCalls && { tool_calls: message.toolCalls }),
        ...(message.toolCallId && { tool_call_id: message.toolCallId }),
        ...(message.name && { name: message.name }),
      })),
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen API error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') {
            continue;
          }

          if (!trimmed.startsWith('data: ')) {
            continue;
          }

          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta: QwenStreamDelta | undefined = data.choices?.[0]?.delta;
            const content = delta?.content || '';
            const toolCalls = delta?.tool_calls;
            const finishReason: string | null | undefined = data.choices?.[0]?.finish_reason;

            if (!content && !toolCalls && !finishReason) {
              continue;
            }

            yield {
              content,
              done: finishReason === 'stop',
              usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens || 0,
                completionTokens: data.usage.completion_tokens || 0,
              } : undefined,
              toolCalls: toolCalls?.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: JSON.parse(toolCall.function.arguments || '{}'),
              })),
            };
          } catch (error) {
            logger.debug({ line: trimmed, error }, 'Failed to parse Qwen SSE data');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

let globalQwenProvider: QwenProvider | null = null;

export function getQwenProvider(config?: QwenConfig): QwenProvider {
  if (!globalQwenProvider) {
    globalQwenProvider = new QwenProvider(config);
  } else if (config) {
    globalQwenProvider.configure(config);
  }

  return globalQwenProvider;
}
