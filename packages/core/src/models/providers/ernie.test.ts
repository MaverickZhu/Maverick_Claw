import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErnieProvider, getErnieProvider } from './ernie.js';

describe('ErnieProvider', () => {
  let provider: ErnieProvider;

  beforeEach(() => {
    provider = new ErnieProvider({
      apiKey: 'test-api-key',
    });
  });

  it('should have correct id and name', () => {
    expect(provider.id).toBe('ernie');
    expect(provider.name).toBe('文心一言 (ERNIE)');
  });

  it('should validate config with api key', async () => {
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
  });

  it('should invalidate config without api key', async () => {
    const invalidProvider = new ErnieProvider({ apiKey: '' });
    const isValid = await invalidProvider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should list available models', async () => {
    const models = await provider.listModels();
    expect(models).toContain('ernie-4.0-turbo');
    expect(models).toContain('ernie-3.5');
    expect(models).toContain('ernie-speed');
  });

  it('should support tools', () => {
    expect(provider.supportsTools()).toBe(true);
  });

  it('should expose standardized capability matrix', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsVision).toBe(false);
    expect(capabilities.defaultModel).toBe('ernie-4.0-turbo');
  });

  it('should configure with new values', () => {
    provider.configure({
      apiKey: 'new-key',
      baseUrl: 'https://custom.api.com',
    });

    expect(provider.validateConfig()).resolves.toBe(true);
  });

  it('should throw when api key not configured', async () => {
    const noKeyProvider = new ErnieProvider({ apiKey: '' });

    await expect(
      (async () => {
        for await (const chunk of noKeyProvider.chatCompletion({
          model: 'ernie-4.0-turbo',
          messages: [{ role: 'user', content: 'test' }],
        })) {
          // Should throw before yielding
        }
      })()
    ).rejects.toThrow('API key not configured');
  });
});

describe('Global ErnieProvider', () => {
  it('should return singleton instance', () => {
    const provider1 = getErnieProvider();
    const provider2 = getErnieProvider();

    expect(provider1).toBe(provider2);
  });

  it('should configure existing instance', () => {
    const provider = getErnieProvider({ apiKey: 'config-key' });
    expect(provider.validateConfig()).resolves.toBe(true);
  });
});
