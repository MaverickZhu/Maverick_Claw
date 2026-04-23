import type { ModelProvider, ModelProviderCapabilitySnapshot } from '../agent/model.js';
import { getDeepSeekProvider } from './providers/deepseek.js';
import { getOpenAIProvider } from './providers/openai.js';
import { getKimiProvider } from './providers/kimi.js';
import { getOllamaProvider } from './providers/ollama.js';
import { getQwenProvider } from './providers/qwen.js';
import { getErnieProvider } from './providers/ernie.js';
import { getDoubaoProvider } from './providers/doubao.js';

function getBuiltinProviders(): ModelProvider[] {
  return [getDeepSeekProvider(), getOpenAIProvider(), getKimiProvider(), getOllamaProvider(), getQwenProvider(), getErnieProvider(), getDoubaoProvider()];
}

export async function getBuiltinProviderCapabilityMatrix(): Promise<ModelProviderCapabilitySnapshot[]> {
  const providers = getBuiltinProviders();
  const snapshots = await Promise.all(
    providers.map(async (provider) => ({
      providerId: provider.id,
      providerName: provider.name,
      models: await provider.listModels(),
      ...provider.getCapabilities(),
    }))
  );

  return snapshots.sort((a, b) => a.providerId.localeCompare(b.providerId));
}
