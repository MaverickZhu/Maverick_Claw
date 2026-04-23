import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoubaoProvider, getDoubaoProvider } from './doubao.js';

describe('DoubaoProvider', () => {
  let provider: DoubaoProvider;

  beforeEach(() => {
    provider = new DoubaoProvider({
      apiKey: 'test-api-key',
    });
  });

  it('should have correct id and name', () => {
    expect(provider.id).toBe('doubao');
    expect(provider.name).toBe('豆包 (Doubao)');
  });

  it('should validate config with api key', async () => {
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
  });

  it('should invalidate config without api key', async () => {
    const invalidProvider = new DoubaoProvider({ apiKey: '' });
    const isValid = await invalidProvider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should list available models', async () => {
    const models = await provider.listModels();
    expect(models).toContain('doubao-pro-32k');
    expect(models).toContain('doubao-lite-32k');
    expect(models).toContain('doubao-vision-pro-32k');
  });

  it('should support tools', () => {
    expect(provider.supportsTools()).toBe(true);
  });

  it('should expose standardized capability matrix', () => {
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsStreaming).toBe(true);
    expect(capabilities.supportsVision).toBe(true);
    expect(capabilities.defaultModel).toBe('doubao-pro-32k');
  });

  it('should configure with new values', () => {
    provider.configure({
      apiKey: 'new-key',
      baseUrl: 'https://custom.api.com',
    });

    expect(provider.validateConfig()).resolves.toBe(true);
  });

  it('should throw when api key not configured', async () => {
    const noKeyProvider = new DoubaoProvider({ apiKey: '' });

    await expect(
      (async () => {
        for await (const chunk of noKeyProvider.chatCompletion({
          model: 'doubao-pro-32k',
          messages: [{ role: 'user', content: 'test' }],
        })) {
          // Should throw before yielding
        }
      })()
    ).rejects.toThrow('API key not configured');
  });
});

describe('Global DoubaoProvider', () => {
  it('should return singleton instance', () => {
    const provider1 = getDoubaoProvider();
    const provider2 = getDoubaoProvider();

    expect(provider1).toBe(provider2);
  });

  it('should configure existing instance', () => {
    const provider = getDoubaoProvider({ apiKey: 'config-key' });
    expect(provider.validateConfig()).resolves.toBe(true);
  });
});
