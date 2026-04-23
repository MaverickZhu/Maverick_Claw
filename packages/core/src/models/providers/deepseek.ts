import { logger } from '../../utils/logger.js';
import type {
  ModelProvider,
  ChatMessage,
  ChatCompletionChunk,
  ModelProviderCapabilities,
} from '../../agent/model.js';

interface DeepSeekConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class DeepSeekProvider implements ModelProvider {
  id = 'deepseek';
  name = 'DeepSeek';
  private config: DeepSeekConfig = {};
  private readonly capabilities: ModelProviderCapabilities = {
    defaultModel: 'deepseek-chat',
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

  constructor(config?: DeepSeekConfig) {
    this.config = {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      ...config,
    };
  }

  configure(config: DeepSeekConfig): void {
    this.config = { ...this.config, ...config };
  }

  async validateConfig(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async listModels(): Promise<string[]> {
    return ['deepseek-chat', 'deepseek-coder'];
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
      throw new Error('DeepSeek API key not configured');
    }

    const body: Record<string, unknown> = {
      model: model || this.config.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls && { tool_calls: m.toolCalls }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
        ...(m.name && { name: m.name }),
      })),
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
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
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
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
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta;
              const content = delta?.content || '';
              const toolCalls = delta?.tool_calls;
              const finishReason = data.choices?.[0]?.finish_reason;

              if (content || toolCalls || finishReason) {
                yield {
                  content,
                  done: finishReason === 'stop',
                  usage: data.usage ? {
                    promptTokens: data.usage.prompt_tokens || 0,
                    completionTokens: data.usage.completion_tokens || 0,
                  } : undefined,
                  toolCalls: toolCalls?.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments || '{}'),
                  })),
                };
              }
            } catch (e) {
              logger.debug({ line: trimmed, error: e }, 'Failed to parse SSE data');
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content || '';
            yield {
              content,
              done: true,
              usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens || 0,
                completionTokens: data.usage.completion_tokens || 0,
              } : undefined,
            };
          } catch (e) {
            // Ignore parse errors in final buffer
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// Singleton instance
let globalDeepSeekProvider: DeepSeekProvider | null = null;

export function getDeepSeekProvider(config?: DeepSeekConfig): DeepSeekProvider {
  if (!globalDeepSeekProvider) {
    globalDeepSeekProvider = new DeepSeekProvider(config);
  } else if (config) {
    globalDeepSeekProvider.configure(config);
  }
  return globalDeepSeekProvider;
}
