import { logger } from '@maverick-claw/core';
import type { 
  ModelProvider, 
  ChatCompletionParams, 
  ChatCompletionChunk,
  ChatMessage,
  ModelProviderCapabilities,
  Plugin,
  PluginContext,
} from '@maverick-claw/core';

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
}

export class DeepSeekProvider implements ModelProvider {
  id = 'deepseek';
  name = 'DeepSeek';

  private config: DeepSeekConfig;
  private baseUrl: string;

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

  constructor(config: DeepSeekConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
  }

  async *chatCompletion(params: ChatCompletionParams): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2000,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${error}`);
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
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield { content: '', done: true };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                yield {
                  content: delta.content,
                  done: false,
                };
              }
            } catch (e) {
              logger.warn({ error: e }, 'Failed to parse SSE data');
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: '', done: true };
  }

  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return [
      'deepseek-chat',
      'deepseek-coder',
      'deepseek-reasoner',
    ];
  }

  getCapabilities(): ModelProviderCapabilities {
    return this.capabilities;
  }

  supportsTools(): boolean {
    return this.capabilities.supportsTools;
  }
}

// Factory function
export function createDeepSeekProvider(config: DeepSeekConfig): DeepSeekProvider {
  return new DeepSeekProvider(config);
}

export default DeepSeekProvider;

// Plugin export
export const plugin: Plugin = {
  name: 'deepseek',
  version: '0.1.0',
  async init(context: PluginContext) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      logger.info('DeepSeek API key not configured, plugin will not register provider');
      return;
    }

    const provider = new DeepSeekProvider({ apiKey });
    if (await provider.validateConfig()) {
      context.modelRegistry.register(provider);
      logger.info('DeepSeek provider registered via plugin');
    } else {
      logger.warn('DeepSeek provider validation failed');
    }
  },
};
