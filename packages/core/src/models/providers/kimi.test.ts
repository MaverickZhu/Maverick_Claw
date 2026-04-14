import { describe, expect, it } from 'vitest';
import { KimiProvider } from './kimi.js';

describe('KimiProvider', () => {
  it('should fail validation without api key', async () => {
    const provider = new KimiProvider({ apiKey: undefined });
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(false);
  });

  it('should pass validation with api key', async () => {
    const provider = new KimiProvider({ apiKey: 'test-kimi-key' });
    const isValid = await provider.validateConfig();
    expect(isValid).toBe(true);
  });

  it('should expose standardized capability matrix', () => {
    const provider = new KimiProvider({ apiKey: 'test-kimi-key' });
    const capabilities = provider.getCapabilities();
    expect(capabilities.supportsTools).toBe(true);
    expect(capabilities.supportsVision).toBe(true);
    expect(capabilities.parameterSupport.temperature.default).toBe(1);
  });

  it('should list default model candidates', async () => {
    const provider = new KimiProvider({ apiKey: 'test-kimi-key' });
    const models = await provider.listModels();
    expect(models).toContain('moonshot-v1-8k');
  });
});
