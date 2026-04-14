import type { ModelProvider, ModelProviderCapabilitySnapshot } from '../agent/model.js';
import { getDeepSeekProvider } from './providers/deepseek.js';
import { getOpenAIProvider } from './providers/openai.js';
import { getKimiProvider } from './providers/kimi.js';

function getBuiltinProviders(): ModelProvider[] {
  return [getDeepSeekProvider(), getOpenAIProvider(), getKimiProvider()];
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
