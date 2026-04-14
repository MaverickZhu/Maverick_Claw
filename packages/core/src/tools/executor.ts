import type { ToolCall, ToolResult, ToolContext } from './types.js';
import { ToolRegistry } from './registry.js';
import { logger } from '../utils/logger.js';

export interface ExecutionOptions {
  timeout?: number;
  parallel?: boolean;
}

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(
    toolCall: ToolCall,
    context: ToolContext,
    options: ExecutionOptions = {}
  ): Promise<ToolResult> {
    const { name, arguments: args, id } = toolCall;
    const timeout = options.timeout || 30000;

    const tool = this.registry.get(name);
    if (!tool) {
      return {
        toolCallId: id,
        name,
        output: null,
        error: `Tool not found: ${name}`,
      };
    }

    const startTime = Date.now();

    try {
      // Execute with timeout
      const result = await Promise.race([
        tool.execute(args),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      const duration = Date.now() - startTime;

      logger.debug({ tool: name, duration, sessionId: context.sessionId }, 'Tool executed');

      return {
        toolCallId: id,
        name,
        output: result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error({ tool: name, error: errorMessage, sessionId: context.sessionId }, 'Tool execution failed');

      return {
        toolCallId: id,
        name,
        output: null,
        error: errorMessage,
        duration,
      };
    }
  }

  async executeBatch(
    toolCalls: ToolCall[],
    context: ToolContext,
    options: ExecutionOptions = {}
  ): Promise<ToolResult[]> {
    if (options.parallel !== false) {
      // Execute in parallel
      const promises = toolCalls.map(call => this.execute(call, context, options));
      return Promise.all(promises);
    } else {
      // Execute sequentially
      const results: ToolResult[] = [];
      for (const call of toolCalls) {
        const result = await this.execute(call, context, options);
        results.push(result);
      }
      return results;
    }
  }
}
