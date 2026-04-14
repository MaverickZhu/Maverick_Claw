import { describe, expect, it } from 'vitest';
import {
  ModelRegistry,
  type ChatCompletionChunk,
  type ChatCompletionParams,
  type ModelProvider,
} from './model.js';

class MockProvider implements ModelProvider {
  constructor(
    public id: string,
    public name: string,
    private models: string[],
    private supportsVision: boolean
  ) {}

  async *chatCompletion(_params: ChatCompletionParams): AsyncIterable<ChatCompletionChunk> {
    yield { content: 'ok', done: true };
  }

  async validateConfig(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }

  getCapabilities() {
    return {
      defaultModel: this.models[0] || '',
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: this.supportsVision,
      supportsJsonMode: true,
      parameterSupport: {
        temperature: { supported: true, min: 0, max: 2, default: 0.7 },
        maxTokens: { supported: true },
        toolChoice: { supported: true },
      },
    };
  }

  supportsTools(): boolean {
    return true;
  }
}

describe('ModelRegistry capability matrix', () => {
  it('should return sorted capability snapshots', async () => {
    const registry = new ModelRegistry();
    registry.register(new MockProvider('openai', 'OpenAI Compatible', ['gpt-4o-mini'], true));
    registry.register(new MockProvider('deepseek', 'DeepSeek', ['deepseek-chat'], false));

    const matrix = await registry.getCapabilityMatrix();

    expect(matrix).toHaveLength(2);
    expect(matrix[0].providerId).toBe('deepseek');
    expect(matrix[1].providerId).toBe('openai');
    expect(matrix[1].supportsVision).toBe(true);
    expect(matrix[0].models).toEqual(['deepseek-chat']);
  });
});
