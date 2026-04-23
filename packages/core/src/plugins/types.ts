import type { ModelRegistry } from '../agent/model.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ChannelRegistry } from '../channels/registry.js';
import type { ConfigManager } from '../config/manager.js';
import type { DatabaseManager } from '../storage/db.js';
import type { SessionManager } from '../storage/session.js';
import type { MessageManager } from '../storage/message.js';
import type { Logger } from 'pino';

export interface PluginContext {
  modelRegistry: ModelRegistry;
  toolRegistry: ToolRegistry;
  channelRegistry: ChannelRegistry;
  configManager: ConfigManager;
  dbManager: DatabaseManager;
  sessionManager: SessionManager;
  messageManager: MessageManager;
  logger: Logger;
}

export interface Plugin {
  name: string;
  version: string;
  init(context: PluginContext): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  entry: string;
  permissions?: string[];
  dependencies?: Record<string, string>;
}

export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  downloadUrl: string;
  permissions?: string[];
  dependencies?: Record<string, string>;
  updatedAt?: string;
}

export interface RegistryIndex {
  version: string;
  updatedAt: string;
  plugins: RegistryPlugin[];
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  source?: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  manifest?: PluginManifest;
}
