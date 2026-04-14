import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepSeekProvider, getDeepSeekProvider } from './deepseek.js';

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;

  beforeEach(() => {
    provider = new DeepSeekProvider({
      apiKey: 'test-api-key',
    });
  });

  it('should have correct id and name', () => {
    expect(provider.id).toBe('deepseek');
    expect(provider.name).toBe('DeepSeek');
  });

  it('should validate config with api key', async () => {
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
  });

  it('should invalidate config without api key', async () => {
    const invalidProvider = new DeepSeekProvider({ apiKey: '' });
    const isValid = await invalidProvider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should list available models', async () => {
    const models = await provider.listModels();
    expect(models).toContain('deepseek-chat');
    expect(models).toContain('deepseek-coder');
  });

  it('should support tools', () => {
    expect(provider.supportsTools()).toBe(true);
  });

  it('should expose standardized capability matrix', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsVision).toBe(false);
    expect(capabilities.defaultModel).toBe('deepseek-chat');
  });

  it('should configure with new values', () => {
    provider.configure({
      apiKey: 'new-key',
      baseUrl: 'https://custom.api.com',
    });

    expect(provider.validateConfig()).resolves.toBe(true);
  });

  it('should throw when api key not configured', async () => {
    const noKeyProvider = new DeepSeekProvider({ apiKey: '' });
    
    await expect(
      (async () => {
        for await (const chunk of noKeyProvider.chatCompletion({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'test' }],
        })) {
          // Should throw before yielding
        }
      })()
    ).rejects.toThrow('API key not configured');
  });
});

describe('Global DeepSeekProvider', () => {
  it('should return singleton instance', () => {
    const provider1 = getDeepSeekProvider();
    const provider2 = getDeepSeekProvider();
    
    expect(provider1).toBe(provider2);
  });

  it('should configure existing instance', () => {
    const provider = getDeepSeekProvider({ apiKey: 'config-key' });
    expect(provider.validateConfig()).resolves.toBe(true);
  });
});
