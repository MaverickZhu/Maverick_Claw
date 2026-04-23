import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QwenProvider, getQwenProvider } from './qwen.js';

describe('QwenProvider', () => {
  let provider: QwenProvider;

  beforeEach(() => {
    provider = new QwenProvider({
      apiKey: 'test-api-key',
    });
  });

  it('should have correct id and name', () => {
    expect(provider.id).toBe('qwen');
    expect(provider.name).toBe('通义千问 (Qwen)');
  });

  it('should validate config with api key', async () => {
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
  });

  it('should invalidate config without api key', async () => {
    const invalidProvider = new QwenProvider({ apiKey: '' });
    const isValid = await invalidProvider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should list available models', async () => {
    const models = await provider.listModels();
    expect(models).toContain('qwen-turbo');
    expect(models).toContain('qwen-plus');
    expect(models).toContain('qwen-max');
    expect(models).toContain('qwen-coder');
  });

  it('should support tools', () => {
    expect(provider.supportsTools()).toBe(true);
  });

  it('should expose standardized capability matrix', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsVision).toBe(false);
    expect(capabilities.defaultModel).toBe('qwen-turbo');
  });

  it('should configure with new values', () => {
    provider.configure({
      apiKey: 'new-key',
      baseUrl: 'https://custom.api.com',
    });

    expect(provider.validateConfig()).resolves.toBe(true);
  });

  it('should throw when api key not configured', async () => {
    const noKeyProvider = new QwenProvider({ apiKey: '' });

    await expect(
      (async () => {
        for await (const chunk of noKeyProvider.chatCompletion({
          model: 'qwen-turbo',
          messages: [{ role: 'user', content: 'test' }],
        })) {
          // Should throw before yielding
        }
      })()
    ).rejects.toThrow('API key not configured');
  });
});

describe('Global QwenProvider', () => {
  it('should return singleton instance', () => {
    const provider1 = getQwenProvider();
    const provider2 = getQwenProvider();

    expect(provider1).toBe(provider2);
  });

  it('should configure existing instance', () => {
    const provider = getQwenProvider({ apiKey: 'config-key' });
    expect(provider.validateConfig()).resolves.toBe(true);
  });
});
