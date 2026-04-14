import type { ChannelAdapter, ChannelType, ChannelConfig } from './types.js';
import { logger } from '../utils/logger.js';

export class ChannelRegistry {
  private adapters = new Map<string, ChannelAdapter>();
  private configs = new Map<string, ChannelConfig>();

  register(adapter: ChannelAdapter, config: ChannelConfig): void {
    if (this.adapters.has(adapter.id)) {
      logger.warn(`Channel adapter ${adapter.id} already registered, overwriting`);
    }
    this.adapters.set(adapter.id, adapter);
    this.configs.set(adapter.id, config);
    logger.info(`Registered channel adapter: ${adapter.id} (${adapter.type})`);
  }

  unregister(adapterId: string): boolean {
    const adapter = this.adapters.get(adapterId);
    if (adapter) {
      this.adapters.delete(adapterId);
      this.configs.delete(adapterId);
      logger.info(`Unregistered channel adapter: ${adapterId}`);
      return true;
    }
    return false;
  }

  get(adapterId: string): ChannelAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  getConfig(adapterId: string): ChannelConfig | undefined {
    return this.configs.get(adapterId);
  }

  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  list(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  listByType(type: ChannelType): ChannelAdapter[] {
    return this.list().filter(adapter => adapter.type === type);
  }

  listEnabled(): ChannelAdapter[] {
    return this.list().filter(adapter => {
      const config = this.configs.get(adapter.id);
      return config?.enabled ?? false;
    });
  }

  async initializeAll(): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      const config = this.configs.get(id);
      if (config) {
        try {
          await adapter.initialize(config.config);
          if (config.enabled) {
            await adapter.start();
          }
        } catch (error) {
          logger.error({ err: error, adapterId: id }, 'Failed to initialize channel adapter');
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      try {
        await adapter.stop();
      } catch (error) {
        logger.error({ err: error, adapterId: id }, 'Failed to stop channel adapter');
      }
    }
  }
}

// Singleton instance
let globalRegistry: ChannelRegistry | null = null;

export function getChannelRegistry(): ChannelRegistry {
  if (!globalRegistry) {
    globalRegistry = new ChannelRegistry();
  }
  return globalRegistry;
}

export function resetChannelRegistry(): void {
  globalRegistry = null;
}
