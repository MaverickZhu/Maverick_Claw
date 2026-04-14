import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from './executor.js';
import { ToolRegistry } from './registry.js';
import type { Tool, ToolCall } from './types.js';

describe('ToolExecutor', () => {
  let registry: ToolRegistry;
  let executor: ToolExecutor;

  beforeEach(() => {
    registry = new ToolRegistry();
    executor = new ToolExecutor(registry);
  });

  const mockTool: Tool = {
    definition: {
      name: 'calculator',
      description: 'Calculator tool',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
    },
    execute: async (args) => (args.a as number) + (args.b as number),
  };

  it('should execute tool successfully', async () => {
    registry.register(mockTool);

    const toolCall: ToolCall = {
      id: 'call-1',
      name: 'calculator',
      arguments: { a: 5, b: 3 },
    };

    const result = await executor.execute(toolCall, { sessionId: 'test' });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(8);
    expect(result.toolCallId).toBe('call-1');
    expect(result.duration).toBeDefined();
  });

  it('should return error for non-existent tool', async () => {
    const toolCall: ToolCall = {
      id: 'call-1',
      name: 'non-existent',
      arguments: {},
    };

    const result = await executor.execute(toolCall, { sessionId: 'test' });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('not found');
  });

  it('should handle tool execution error', async () => {
    registry.register({
      ...mockTool,
      execute: async () => {
        throw new Error('Calculation failed');
      },
    });

    const toolCall: ToolCall = {
      id: 'call-1',
      name: 'calculator',
      arguments: { a: 1, b: 2 },
    };

    const result = await executor.execute(toolCall, { sessionId: 'test' });

    expect(result.error).toBeDefined();
    expect(result.error).toBe('Calculation failed');
  });

  it('should timeout long-running tool', async () => {
    registry.register({
      ...mockTool,
      execute: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'done';
      },
    });

    const toolCall: ToolCall = {
      id: 'call-1',
      name: 'calculator',
      arguments: { a: 1, b: 2 },
    };

    const result = await executor.execute(toolCall, { sessionId: 'test' }, { timeout: 100 });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('timeout');
  });

  it('should execute batch in parallel', async () => {
    let callCount = 0;
    registry.register({
      ...mockTool,
      execute: async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return callCount;
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'call-1', name: 'calculator', arguments: { a: 1, b: 1 } },
      { id: 'call-2', name: 'calculator', arguments: { a: 2, b: 2 } },
      { id: 'call-3', name: 'calculator', arguments: { a: 3, b: 3 } },
    ];

    const startTime = Date.now();
    const results = await executor.executeBatch(toolCalls, { sessionId: 'test' }, { parallel: true });
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(3);
    expect(duration).toBeLessThan(200); // Should be parallel, not sequential
  });

  it('should execute batch sequentially when parallel is false', async () => {
    const executionOrder: number[] = [];
    registry.register({
      ...mockTool,
      execute: async (args) => {
        const order = args.a as number;
        executionOrder.push(order);
        return order;
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'call-1', name: 'calculator', arguments: { a: 1, b: 1 } },
      { id: 'call-2', name: 'calculator', arguments: { a: 2, b: 2 } },
      { id: 'call-3', name: 'calculator', arguments: { a: 3, b: 3 } },
    ];

    await executor.executeBatch(toolCalls, { sessionId: 'test' }, { parallel: false });

    expect(executionOrder).toEqual([1, 2, 3]);
  });
});
