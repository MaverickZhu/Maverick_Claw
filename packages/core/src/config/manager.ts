import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import JSON5 from 'json5';
import { z } from 'zod';
import type { GatewayConfig, ModelConfig, ChannelConfig, ChannelType } from '@maverick-claw/shared';
import { logger } from '../utils/logger.js';
import { watch, type FSWatcher } from 'fs';
import { parseChannelConfig } from '../channels/contracts.js';

const configSchema = z.object({
  port: z.number().default(18789),
  host: z.string().default('127.0.0.1'),
  auth: z.object({
    type: z.enum(['token', 'oauth', 'ldap', 'none']).default('token'),
    token: z.string().optional(),
    oauth: z.object({
      providers: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['oidc', 'oauth2']),
        clientId: z.string(),
        clientSecret: z.string(),
        issuerUrl: z.string().optional(),
        authorizationUrl: z.string().optional(),
        tokenUrl: z.string().optional(),
        userinfoUrl: z.string().optional(),
        redirectUri: z.string(),
        scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
        enabled: z.boolean().default(true),
        roleMapping: z.record(z.string()).optional(),
      })).default([]),
    }).optional(),
    ldap: z.object({
      enabled: z.boolean().default(false),
      server: z.string(),
      bindDN: z.string().optional(),
      bindPassword: z.string().optional(),
      baseDN: z.string(),
      userFilter: z.string().default('(uid={{username}})'),
      groupFilter: z.string().optional(),
      tls: z.boolean().default(false),
      tlsOptions: z.record(z.unknown()).optional(),
      groupRoleMapping: z.record(z.string()).optional(),
      defaultRoleId: z.string().optional(),
    }).optional(),
  }).default({}),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    enabled: z.boolean().default(true),
    parameters: z.record(z.unknown()).optional(),
  })).default([]),
  defaultModel: z.string().optional(),
  channels: z.array(z.object({
    id: z.string(),
    type: z.enum(['webchat', 'wechat', 'dingtalk', 'lark', 'wecom', 'email', 'webhook', 'telegram', 'slack']),
    name: z.string(),
    enabled: z.boolean().default(true),
    config: z.record(z.unknown()).default({}),
  })).default([]),
  plugins: z.object({
    registryUrl: z.string().optional(),
  }).default({}),
  storage: z.object({
    type: z.enum(['sqlite', 'postgres']).default('sqlite'),
    url: z.string().optional(),
  }).default({}),
});

export interface ConfigManagerOptions {
  configPath?: string;
  enableHotReload?: boolean;
}

export type ConfigChangeCallback = (config: GatewayConfig, changedPath?: string) => void;
export type ConfigChangeType = 'models' | 'channels' | 'auth' | 'storage' | 'system';

export class ConfigManager {
  private config: GatewayConfig;
  private configPath: string;
  private enableHotReload: boolean;
  private watcher?: FSWatcher;
  private changeCallbacks = new Map<ConfigChangeType, Set<ConfigChangeCallback>>();
  private isLoading = false;

  constructor(options: ConfigManagerOptions = {}) {
    this.configPath = options.configPath || this.getDefaultConfigPath();
    this.enableHotReload = options.enableHotReload ?? true;
    this.config = this.getDefaultConfig();
  }

  private getDefaultConfigPath(): string {
    const configDir = process.env.MAVERICK_CLAW_CONFIG_DIR || 
      path.join(os.homedir(), '.maverick-claw');
    return path.join(configDir, 'config.json5');
  }

  private getDefaultConfig(): GatewayConfig {
    return {
      port: 31987,
      host: '127.0.0.1',
      auth: {
        type: 'token',
      },
      models: [],
      channels: [
        {
          id: 'webchat',
          type: 'webchat',
          name: 'WebChat',
          enabled: true,
          config: {},
        },
      ],
      storage: {
        type: 'sqlite',
      },
    };
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON5.parse(content);
      this.config = configSchema.parse(parsed);
      this.normalizeChannels();
      this.normalizeDefaultModel();
      logger.info({ configPath: this.configPath }, 'Configuration loaded');
      
      // Start watching for changes
      if (this.enableHotReload) {
        this.startWatching();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Config doesn't exist, create default
        logger.info({ configPath: this.configPath }, 'Creating default configuration');
        await this.save();
        
        if (this.enableHotReload) {
          this.startWatching();
        }
      } else {
        throw new Error(`Failed to load config: ${error}`);
      }
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const content = JSON5.stringify(this.config, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');
    logger.debug({ configPath: this.configPath }, 'Configuration saved');
  }

  get(): GatewayConfig {
    return this.config;
  }

  private toModelRef(model: Pick<ModelConfig, 'provider' | 'id'>): string {
    return `${model.provider}:${model.id}`;
  }

  private findModelByRef(modelRef: string): ModelConfig | undefined {
    return this.config.models.find((model) => this.toModelRef(model) === modelRef);
  }

  private normalizeDefaultModel(): void {
    if (this.config.models.length === 0) {
      this.config.defaultModel = undefined;
      return;
    }

    const enabledModels = this.config.models.filter((model) => model.enabled);
    if (this.config.defaultModel) {
      const existing = this.findModelByRef(this.config.defaultModel);
      if (existing?.enabled) {
        return;
      }
    }

    const fallback = enabledModels[0] ?? this.config.models[0];
    this.config.defaultModel = fallback ? this.toModelRef(fallback) : undefined;
  }

  private normalizeChannels(): void {
    this.config.channels = this.config.channels.map((channel) => ({
      ...channel,
      config: parseChannelConfig(channel.type as ChannelType, channel.config || {}),
    }));
  }

  async update(updates: Partial<GatewayConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...updates };
    this.normalizeChannels();
    this.normalizeDefaultModel();
    await this.save();
    
    // Notify listeners of changes
    this.notifyChanges(oldConfig, this.config);
  }

  // Model configuration methods
  async addModel(model: ModelConfig): Promise<void> {
    // Check for duplicate ID
    if (this.config.models.some(m => m.id === model.id)) {
      throw new Error(`Model with ID '${model.id}' already exists`);
    }
    
    this.config.models.push(model);
    this.normalizeDefaultModel();
    await this.save();
    this.notifyChangeType('models');
    logger.info({ modelId: model.id, name: model.name }, 'Model added');
  }

  async updateModel(modelId: string, updates: Partial<ModelConfig>): Promise<void> {
    const index = this.config.models.findIndex(m => m.id === modelId);
    if (index === -1) {
      throw new Error(`Model '${modelId}' not found`);
    }
    
    this.config.models[index] = { ...this.config.models[index], ...updates };
    this.normalizeDefaultModel();
    await this.save();
    this.notifyChangeType('models');
    logger.info({ modelId }, 'Model updated');
  }

  async removeModel(modelId: string): Promise<void> {
    const index = this.config.models.findIndex(m => m.id === modelId);
    if (index === -1) {
      throw new Error(`Model '${modelId}' not found`);
    }
    
    this.config.models.splice(index, 1);
    this.normalizeDefaultModel();
    await this.save();
    this.notifyChangeType('models');
    logger.info({ modelId }, 'Model removed');
  }

  async setDefaultModel(modelRef: string): Promise<void> {
    const model = this.findModelByRef(modelRef);
    if (!model) {
      throw new Error(`Model '${modelRef}' not found`);
    }

    if (!model.enabled) {
      throw new Error(`Model '${modelRef}' is disabled and cannot be default`);
    }

    this.config.defaultModel = modelRef;
    await this.save();
    this.notifyChangeType('models');
    logger.info({ modelRef }, 'Default model updated');
  }

  // Channel configuration methods
  async addChannel(channel: ChannelConfig): Promise<void> {
    // Check for duplicate ID
    if (this.config.channels.some(c => c.id === channel.id)) {
      throw new Error(`Channel with ID '${channel.id}' already exists`);
    }
    
    this.config.channels.push({
      ...channel,
      config: parseChannelConfig(channel.type as ChannelType, channel.config || {}),
    });
    await this.save();
    this.notifyChangeType('channels');
    logger.info({ channelId: channel.id, name: channel.name }, 'Channel added');
  }

  async updateChannel(channelId: string, updates: Partial<ChannelConfig>): Promise<void> {
    const index = this.config.channels.findIndex(c => c.id === channelId);
    if (index === -1) {
      throw new Error(`Channel '${channelId}' not found`);
    }
    
    const mergedChannel = { ...this.config.channels[index], ...updates };
    this.config.channels[index] = {
      ...mergedChannel,
      config: parseChannelConfig(mergedChannel.type as ChannelType, mergedChannel.config || {}),
    };
    await this.save();
    this.notifyChangeType('channels');
    logger.info({ channelId }, 'Channel updated');
  }

  async removeChannel(channelId: string): Promise<void> {
    const index = this.config.channels.findIndex(c => c.id === channelId);
    if (index === -1) {
      throw new Error(`Channel '${channelId}' not found`);
    }
    
    this.config.channels.splice(index, 1);
    await this.save();
    this.notifyChangeType('channels');
    logger.info({ channelId }, 'Channel removed');
  }

  // Auth configuration
  async updateAuth(auth: Partial<GatewayConfig['auth']>): Promise<void> {
    this.config.auth = { ...this.config.auth, ...auth };
    await this.save();
    this.notifyChangeType('auth');
    logger.info('Auth configuration updated');
  }

  // System configuration (port, host, etc.)
  async updateSystem(updates: Pick<Partial<GatewayConfig>, 'port' | 'host'>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.save();
    this.notifyChangeType('system');
    logger.info({ ...updates }, 'System configuration updated');
  }

  getConfigPath(): string {
    return this.configPath;
  }

  // Hot reload support
  onChange(type: ConfigChangeType, callback: ConfigChangeCallback): () => void {
    if (!this.changeCallbacks.has(type)) {
      this.changeCallbacks.set(type, new Set());
    }
    this.changeCallbacks.get(type)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.changeCallbacks.get(type)?.delete(callback);
    };
  }

  private startWatching(): void {
    if (this.watcher) {
      return;
    }

    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === 'change' && !this.isLoading) {
          logger.debug({ configPath: this.configPath }, 'Config file changed, reloading...');
          this.reload().catch(err => {
            logger.error({ err }, 'Failed to reload config');
          });
        }
      });
      
      logger.debug({ configPath: this.configPath }, 'Started watching config file');
    } catch (error) {
      logger.error({ err: error }, 'Failed to start config watcher');
    }
  }

  private async reload(): Promise<void> {
    this.isLoading = true;
    try {
      const oldConfig = { ...this.config };
      const content = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON5.parse(content);
      this.config = configSchema.parse(parsed);
      this.normalizeChannels();
      this.normalizeDefaultModel();
      
      this.notifyChanges(oldConfig, this.config);
      logger.info('Configuration reloaded from file');
    } finally {
      this.isLoading = false;
    }
  }

  private notifyChanges(oldConfig: GatewayConfig, newConfig: GatewayConfig): void {
    // Detect what changed
    if (
      JSON.stringify(oldConfig.models) !== JSON.stringify(newConfig.models) ||
      oldConfig.defaultModel !== newConfig.defaultModel
    ) {
      this.notifyChangeType('models');
    }
    if (JSON.stringify(oldConfig.channels) !== JSON.stringify(newConfig.channels)) {
      this.notifyChangeType('channels');
    }
    if (JSON.stringify(oldConfig.auth) !== JSON.stringify(newConfig.auth)) {
      this.notifyChangeType('auth');
    }
    if (oldConfig.port !== newConfig.port || oldConfig.host !== newConfig.host) {
      this.notifyChangeType('system');
    }
  }

  private notifyChangeType(type: ConfigChangeType): void {
    const callbacks = this.changeCallbacks.get(type);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(this.config, type);
        } catch (error) {
          logger.error({ err: error, type }, 'Config change callback error');
        }
      }
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
      logger.debug('Stopped watching config file');
    }
  }
}
