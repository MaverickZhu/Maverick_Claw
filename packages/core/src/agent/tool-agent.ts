import type { ModelProvider, ChatMessage, ChatCompletionChunk } from './model.js';
import type { ToolCall, ToolResult, ToolContext } from '../tools/types.js';
import { getToolRegistry, ToolExecutor, type ToolRegistry } from '../tools/index.js';
import { logger } from '../utils/logger.js';

export interface ToolAgentOptions {
  provider: ModelProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
  toolRegistry?: ToolRegistry;
}

export interface ToolAgentResponse {
  content: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export class ToolAgent {
  private provider: ModelProvider;
  private model: string;
  private systemPrompt: string;
  private temperature: number;
  private maxTokens?: number;
  private maxToolIterations: number;
  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;

  constructor(options: ToolAgentOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt || this.defaultSystemPrompt();
    const providerDefaultTemperature =
      this.provider.getCapabilities().parameterSupport.temperature.default ?? 0.7;
    this.temperature = options.temperature ?? providerDefaultTemperature;
    this.maxTokens = options.maxTokens;
    this.maxToolIterations = options.maxToolIterations ?? 5;
    this.toolRegistry = options.toolRegistry || getToolRegistry();
    if (!this.toolRegistry) {
      throw new Error('ToolRegistry is not initialized');
    }
    this.toolExecutor = new ToolExecutor(this.toolRegistry);
  }

  async *streamChat(
    messages: ChatMessage[],
    context: ToolContext
  ): AsyncGenerator<ChatCompletionChunk | { type: 'tool_calls'; calls: ToolCall[] } | { type: 'tool_results'; results: ToolResult[] }> {
    const allMessages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages,
    ];

    const availableTools = this.toolRegistry?.list() || [];
    const useTools = availableTools.length > 0 && this.provider.getCapabilities().supportsTools;

    let iterations = 0;
    let hasToolCalls = true;

    while (hasToolCalls && iterations < this.maxToolIterations) {
      iterations++;
      hasToolCalls = false;

      // Collect the full response
      let fullContent = '';
      let accumulatedToolCalls: ToolCall[] = [];
      let usage: { promptTokens: number; completionTokens: number } | undefined;

      // Stream the response
      const stream = this.provider.chatCompletion({
        model: this.model,
        messages: allMessages,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        stream: true,
        tools: useTools ? availableTools : undefined,
        toolChoice: useTools ? 'auto' : undefined,
      });

      for await (const chunk of stream) {
        fullContent += chunk.content;
        usage = chunk.usage;

        if (chunk.toolCalls) {
          accumulatedToolCalls.push(...chunk.toolCalls);
        }

        // Yield content chunks
        if (chunk.content) {
          yield chunk;
        }
      }

      // Handle tool calls
      if (accumulatedToolCalls.length > 0) {
        hasToolCalls = true;
        yield { type: 'tool_calls', calls: accumulatedToolCalls };

        // Execute tools
        const results = await this.toolExecutor.executeBatch(accumulatedToolCalls, context, {
          parallel: true,
          timeout: 30000,
        });

        yield { type: 'tool_results', results };

        // Add assistant message with tool calls
        allMessages.push({
          role: 'assistant',
          content: fullContent,
          toolCalls: accumulatedToolCalls,
        });

        // Add tool results
        for (const result of results) {
          allMessages.push({
            role: 'tool',
            content: JSON.stringify(result.output ?? { error: result.error }),
            toolCallId: result.toolCallId,
            name: result.name,
          });
        }
      } else {
        // No tool calls, we're done
        if (fullContent) {
          yield { content: '', done: true, usage };
        }
      }
    }

    if (iterations >= this.maxToolIterations) {
      logger.warn({ sessionId: context.sessionId }, 'Max tool iterations reached');
    }
  }

  async chat(
    messages: ChatMessage[],
    context: ToolContext
  ): Promise<ToolAgentResponse> {
    const allMessages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages,
    ];

    const availableTools = this.toolRegistry.list();
    const useTools = availableTools.length > 0 && this.provider.getCapabilities().supportsTools;

    let iterations = 0;
    let hasToolCalls = true;
    let finalContent = '';
    let allToolCalls: ToolCall[] = [];
    let allToolResults: ToolResult[] = [];
    let usage: { promptTokens: number; completionTokens: number } | undefined;

    while (hasToolCalls && iterations < this.maxToolIterations) {
      iterations++;
      hasToolCalls = false;

      // Non-streaming completion
      const stream = this.provider.chatCompletion({
        model: this.model,
        messages: allMessages,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        stream: false,
        tools: useTools ? availableTools : undefined,
        toolChoice: useTools ? 'auto' : undefined,
      });

      let content = '';
      let toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        content += chunk.content;
        usage = chunk.usage;
        if (chunk.toolCalls) {
          toolCalls.push(...chunk.toolCalls);
        }
      }

      if (toolCalls.length > 0) {
        hasToolCalls = true;
        allToolCalls.push(...toolCalls);

        // Execute tools
        const results = await this.toolExecutor.executeBatch(toolCalls, context, {
          parallel: true,
          timeout: 30000,
        });

        allToolResults.push(...results);

        // Add assistant message with tool calls
        allMessages.push({
          role: 'assistant',
          content,
          toolCalls,
        });

        // Add tool results
        for (const result of results) {
          allMessages.push({
            role: 'tool',
            content: JSON.stringify(result.output ?? { error: result.error }),
            toolCallId: result.toolCallId,
            name: result.name,
          });
        }
      } else {
        finalContent = content;
      }
    }

    if (iterations >= this.maxToolIterations) {
      logger.warn({ sessionId: context.sessionId }, 'Max tool iterations reached');
    }

    return {
      content: finalContent,
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      usage,
    };
  }

  private defaultSystemPrompt(): string {
    const tools = this.toolRegistry.list();
    if (tools.length === 0) {
      return 'You are a helpful assistant.';
    }

    return `You are a helpful assistant with access to tools. When you need to use a tool, use the function_calling capability.
Available tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Use tools when appropriate to help answer user questions.`;
  }
}
