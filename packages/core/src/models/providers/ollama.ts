import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import type {
  ModelProvider,
  ChatMessage,
  ChatCompletionChunk,
  ModelProviderCapabilities,
} from '../../agent/model.js';

interface OllamaConfig {
  baseUrl?: string;
}

interface OllamaTagResponse {
  models?: Array<{
    name: string;
    model?: string;
  }>;
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      id?: string;
      function: {
        name: string;
        arguments: string | Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaProvider implements ModelProvider {
  id = 'ollama';
  name = 'Ollama';
  private config: OllamaConfig = {};
  private readonly capabilities: ModelProviderCapabilities = {
    defaultModel: 'llama3.2',
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

  constructor(config?: OllamaConfig) {
    this.config = {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      ...config,
    };
  }

  configure(config: OllamaConfig): void {
    this.config = { ...this.config, ...config };
  }

  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      if (!response.ok) {
        return [this.capabilities.defaultModel];
      }
      const data = (await response.json()) as OllamaTagResponse;
      const models = data.models?.map((m) => m.name).filter(Boolean) ?? [];
      return models.length > 0 ? models : [this.capabilities.defaultModel];
    } catch (error) {
      logger.debug({ err: error }, 'Ollama listModels failed');
      return [this.capabilities.defaultModel];
    }
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

    const body: Record<string, unknown> = {
      model: model || this.capabilities.defaultModel,
      messages: messages.map((message) => {
        const msg: Record<string, unknown> = {
          role: message.role,
          content: message.content,
        };
        if (message.toolCalls && message.toolCalls.length > 0) {
          msg.tool_calls = message.toolCalls.map(tc => ({
            id: tc.id || randomUUID(),
            type: 'function',
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments,
            },
          }));
        }
        if (message.toolCallId) {
          msg.tool_call_id = message.toolCallId;
        }
        return msg;
      }),
      stream,
      options: {
        temperature,
      },
    };

    if (maxTokens) {
      body.options = { ...(body.options as Record<string, unknown>), num_predict: maxTokens };
    }

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

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
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
        if (done) {
          // Process any remaining buffer content
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            try {
              const data = JSON.parse(trimmed) as OllamaChatResponse;
              const rawContent = data.message?.content;
              const content = (Array.isArray(rawContent) ? '' : (rawContent || ''));
              const isDone = data.done;
              const toolCalls = data.message?.tool_calls?.map((tc) => ({
                id: tc.id || randomUUID(),
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments || '{}')
                  : tc.function.arguments,
              }));

              if (content || toolCalls || isDone) {
                yield {
                  content,
                  done: isDone,
                  toolCalls,
                  usage: data.eval_count !== undefined
                    ? {
                        promptTokens: data.prompt_eval_count ?? 0,
                        completionTokens: data.eval_count ?? 0,
                      }
                    : undefined,
                };
              }
            } catch (error) {
              logger.debug({ line: trimmed, error }, 'Failed to parse Ollama NDJSON data');
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed) as OllamaChatResponse;
            const rawContent = data.message?.content;
            const content = (Array.isArray(rawContent) ? '' : (rawContent || ''));
            const isDone = data.done;
            const toolCalls = data.message?.tool_calls?.map((tc) => ({
              id: tc.id || randomUUID(),
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments || '{}')
                : tc.function.arguments,
            }));

            if (!content && !toolCalls?.length && !isDone) {
              continue;
            }

            yield {
              content,
              done: isDone,
              toolCalls,
              usage: data.eval_count !== undefined
                ? {
                    promptTokens: data.prompt_eval_count ?? 0,
                    completionTokens: data.eval_count ?? 0,
                  }
                : undefined,
            };
          } catch (error) {
            logger.debug({ line: trimmed, error }, 'Failed to parse Ollama NDJSON data');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

let globalOllamaProvider: OllamaProvider | null = null;

export function getOllamaProvider(config?: OllamaConfig): OllamaProvider {
  if (!globalOllamaProvider) {
    globalOllamaProvider = new OllamaProvider(config);
  } else if (config) {
    globalOllamaProvider.configure(config);
  }

  return globalOllamaProvider;
}
