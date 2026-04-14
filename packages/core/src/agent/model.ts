// Model Provider Interface and Registry
import { logger } from '../utils/logger.js';
import type { ToolDefinition, ToolCall } from '../tools/types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface ChatCompletionChunk {
  content: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  toolCalls?: ToolCall[];
}

export interface ProviderNumericParameterCapability {
  supported: boolean;
  min?: number;
  max?: number;
  default?: number;
}

export interface ModelProviderCapabilities {
  defaultModel: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  parameterSupport: {
    temperature: ProviderNumericParameterCapability;
    maxTokens: { supported: boolean };
    toolChoice: { supported: boolean };
  };
}

export interface ModelProviderCapabilitySnapshot extends ModelProviderCapabilities {
  providerId: string;
  providerName: string;
  models: string[];
}

export interface ModelProviderCapabilityReport extends ModelProviderCapabilitySnapshot {
  registered: boolean;
  configuredModels: string[];
}

export interface ModelProvider {
  id: string;
  name: string;
  
  chatCompletion(params: ChatCompletionParams): AsyncIterable<ChatCompletionChunk>;
  validateConfig(): Promise<boolean>;
  listModels(): Promise<string[]>;
  getCapabilities(): ModelProviderCapabilities;
  
  // Check if provider supports native tool calling
  supportsTools(): boolean;
}

export class ModelRegistry {
  private providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
    logger.info(`Registered model provider: ${provider.id}`);
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  list(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  async getCapabilityMatrix(): Promise<ModelProviderCapabilitySnapshot[]> {
    const providers = this.list();
    const snapshots = await Promise.all(
      providers.map(async (provider) => {
        const models = await provider.listModels();
        return {
          providerId: provider.id,
          providerName: provider.name,
          models,
          ...provider.getCapabilities(),
        } satisfies ModelProviderCapabilitySnapshot;
      })
    );

    return snapshots.sort((a, b) => a.providerId.localeCompare(b.providerId));
  }
}

// Singleton
let globalRegistry: ModelRegistry | null = null;

export function getModelRegistry(): ModelRegistry {
  if (!globalRegistry) {
    globalRegistry = new ModelRegistry();
  }
  return globalRegistry;
}
