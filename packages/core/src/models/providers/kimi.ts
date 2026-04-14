import { logger } from '../../utils/logger.js';
import type {
  ModelProvider,
  ChatMessage,
  ChatCompletionChunk,
  ModelProviderCapabilities,
} from '../../agent/model.js';

interface KimiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class KimiProvider implements ModelProvider {
  id = 'kimi';
  name = 'Kimi (Moonshot AI)';
  private config: KimiConfig = {};
  private readonly capabilities: ModelProviderCapabilities = {
    defaultModel: 'moonshot-v1-8k',
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    parameterSupport: {
      temperature: {
        supported: true,
        min: 0,
        max: 2,
        default: 1,
      },
      maxTokens: { supported: true },
      toolChoice: { supported: true },
    },
  };

  constructor(config?: KimiConfig) {
    this.config = {
      apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY,
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k',
      ...config,
    };
  }

  configure(config: KimiConfig): void {
    this.config = { ...this.config, ...config };
  }

  async validateConfig(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async listModels(): Promise<string[]> {
    return [
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
      'moonshot-v1-8k-vision-preview',
      'moonshot-v1-32k-vision-preview',
    ];
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
      throw new Error('Kimi API key not configured');
    }

    const body: Record<string, unknown> = {
      model: model || this.config.model,
      messages: messages.map((m, index) => {
        const msg: Record<string, unknown> = {
          role: m.role,
        };
        
        // Handle tool calls for assistant messages
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
          // For Kimi: when tool_calls exist, content should be null and reasoning_content should be provided
          msg.content = m.content || null;
          msg.reasoning_content = m.content || 'Using tools to help';
          logger.info({ index, role: m.role, content: msg.content, reasoning: msg.reasoning_content, toolCount: m.toolCalls.length }, 'Kimi message with tool_calls');
        } else {
          msg.content = m.content;
        }
        
        if (m.toolCallId) {
          msg.tool_call_id = m.toolCallId;
        }
        
        if (m.name) {
          msg.name = m.name;
        }
        
        return msg;
      }),
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

    // Debug: log messages with tool calls
    const messagesWithTools = messages.filter(m => m.toolCalls && m.toolCalls.length > 0);
    if (messagesWithTools.length > 0) {
      logger.info({ 
        messageCount: messages.length, 
        toolMessages: messagesWithTools.map(m => ({ 
          role: m.role, 
          hasContent: !!m.content,
          toolCount: m.toolCalls?.length 
        })) 
      }, 'Messages with tool_calls detected');
    }
    
    logger.debug({ model, messageCount: messages.length, hasTools: !!tools }, 'Sending request to Kimi API');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      logger.debug({ status: response.status }, 'Kimi API response received');

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Kimi API error: ${response.status} - ${error}`);
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
                    usage: data.usage,
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

        if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const content = data.choices?.[0]?.delta?.content || '';
              yield {
                content,
                done: true,
                usage: data.usage,
              };
            } catch (e) {
              // Ignore parse errors in final buffer
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error('Kimi API request timeout after 60 seconds');
      }
      throw error;
    }
  }
}

let globalKimiProvider: KimiProvider | null = null;

export function getKimiProvider(config?: KimiConfig): KimiProvider {
  if (!globalKimiProvider) {
    globalKimiProvider = new KimiProvider(config);
  } else if (config) {
    globalKimiProvider.configure(config);
  }
  return globalKimiProvider;
}
