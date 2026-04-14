import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from './openai.js';

describe('OpenAIProvider', () => {
  it('should fail validation without api key', async () => {
    const provider = new OpenAIProvider({ apiKey: undefined });
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should pass validation with api key', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-openai-key' });
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
  });

  it('should support tool calling', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-openai-key' });
    expect(provider.supportsTools()).toBe(true);
  });

  it('should expose standardized capability matrix', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-openai-key' });
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsVision).toBe(true);
    expect(capabilities.parameterSupport.temperature.default).toBe(0.7);
  });

  it('should list default model candidates', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-openai-key' });
    const models = await provider.listModels();
    expect(models).toContain('gpt-4o-mini');
  });
});
