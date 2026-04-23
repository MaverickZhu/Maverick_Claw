import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, existsSync } from 'fs';
import type { Plugin, PluginContext } from './types.js';
import { logger } from '../utils/logger.js';
import type { DatabaseManager } from '../storage/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private loaded = false;

  constructor(
    private context: PluginContext,
    private dbManager?: DatabaseManager
  ) {}

  async loadAll(): Promise<void> {
    if (this.loaded) return;

    // 1. Scan built-in plugins directory
    const pluginsDir = path.resolve(__dirname, '../../../../plugins');
    if (existsSync(pluginsDir)) {
      const entries = readdirSync(pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      for (const dir of pluginDirs) {
        const pluginDir = path.join(pluginsDir, dir);
        // Skip if this is a dynamically installed plugin managed by DB
        if (this.isDbManagedPlugin(dir)) continue;
        await this.loadPluginFromDir(dir, pluginDir);
      }
    }

    // 2. Load DB-managed plugins (installed via market)
    if (this.dbManager) {
      await this.loadDbPlugins();
    }

    this.loaded = true;
    logger.info({ count: this.plugins.size }, 'Plugins loaded');
  }

  /**
   * Load a plugin from a directory (built-in / local)
   */
  private async loadPluginFromDir(name: string, dir: string): Promise<void> {
    try {
      const entryPath = path.join(dir, 'dist/index.js');
      if (!existsSync(entryPath)) {
        // Try manifest.json entry fallback
        const manifestPath = path.join(dir, 'manifest.json');
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(await import('fs').then((fs) => fs.readFileSync(manifestPath, 'utf-8')));
          const customEntry = manifest.entry ? path.join(dir, manifest.entry) : null;
          if (customEntry && existsSync(customEntry)) {
            await this.loadPluginModule(name, customEntry);
            return;
          }
        }
        logger.debug({ plugin: name, path: entryPath }, 'Plugin entry not found');
        return;
      }

      await this.loadPluginModule(name, entryPath);
    } catch (error) {
      logger.error({ err: error, plugin: name }, 'Failed to load plugin from directory');
    }
  }

  /**
   * Load DB-managed plugins that are enabled
   */
  private async loadDbPlugins(): Promise<void> {
    try {
      const db = this.dbManager!.getDb();
      const rows = db
        .prepare("SELECT id, manifest FROM plugins WHERE enabled = 1 AND source != 'builtin'")
        .all() as Array<{ id: string; manifest: string | null }>;

      const pluginsDir = path.resolve(__dirname, '../../../../plugins');

      for (const row of rows) {
        const pluginDir = path.join(pluginsDir, row.id);
        let entryPath = path.join(pluginDir, 'dist/index.js');

        // Check manifest for custom entry
        if (!existsSync(entryPath) && row.manifest) {
          try {
            const manifest = JSON.parse(row.manifest) as { entry?: string };
            if (manifest.entry) {
              const customEntry = path.join(pluginDir, manifest.entry);
              if (existsSync(customEntry)) {
                entryPath = customEntry;
              }
            }
          } catch {
            // ignore manifest parse error
          }
        }

        if (!existsSync(entryPath)) {
          logger.debug({ plugin: row.id, path: entryPath }, 'DB plugin entry not found, skipping');
          continue;
        }

        await this.loadPluginModule(row.id, entryPath);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load DB plugins');
    }
  }

  /**
   * Load a plugin module from a file path
   */
  private async loadPluginModule(name: string, entryPath: string): Promise<void> {
    if (this.plugins.has(name)) {
      logger.debug({ plugin: name }, 'Plugin already loaded, skipping');
      return;
    }

    try {
      const module = await import(entryPath);
      const plugin: Plugin | undefined = module.default || module.plugin;

      if (!plugin || typeof plugin.init !== 'function') {
        logger.warn({ plugin: name }, 'Plugin does not export a valid Plugin object');
        return;
      }

      // Initialize
      await plugin.init(this.context);
      this.plugins.set(name, plugin);
      logger.info({ plugin: plugin.name, version: plugin.version }, 'Plugin initialized');

      // Start if available
      if (plugin.start) {
        await plugin.start();
        logger.info({ plugin: plugin.name }, 'Plugin started');
      }
    } catch (error) {
      logger.error({ err: error, plugin: name, path: entryPath }, 'Failed to load plugin module');
    }
  }

  /**
   * Unload a specific plugin (stop + remove from map)
   */
  async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    try {
      if (plugin.stop) {
        await plugin.stop();
        logger.info({ plugin: name }, 'Plugin stopped');
      }
    } catch (error) {
      logger.error({ err: error, plugin: name }, 'Failed to stop plugin');
    }

    this.plugins.delete(name);
    return true;
  }

  /**
   * Reload a plugin (unload then load again)
   */
  async reloadPlugin(name: string, entryPath?: string): Promise<boolean> {
    const wasLoaded = await this.unloadPlugin(name);
    if (!wasLoaded) {
      logger.warn({ plugin: name }, 'Plugin not loaded, cannot reload');
      return false;
    }

    if (entryPath) {
      await this.loadPluginModule(name, entryPath);
    } else {
      // Try to find the plugin directory again
      const pluginsDir = path.resolve(__dirname, '../../../../plugins');
      const pluginDir = path.join(pluginsDir, name);
      if (existsSync(pluginDir)) {
        await this.loadPluginFromDir(name, pluginDir);
      } else {
        // Try DB path
        const db = this.dbManager?.getDb();
        if (db) {
          const row = db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(name) as
            | { manifest: string | null }
            | undefined;
          if (row) {
            let entry = path.join(pluginDir, 'dist/index.js');
            if (row.manifest) {
              try {
                const manifest = JSON.parse(row.manifest) as { entry?: string };
                if (manifest.entry) {
                  const custom = path.join(pluginDir, manifest.entry);
                  if (existsSync(custom)) entry = custom;
                }
              } catch {
                // ignore
              }
            }
            if (existsSync(entry)) {
              await this.loadPluginModule(name, entry);
            }
          }
        }
      }
    }

    return this.plugins.has(name);
  }

  async stopAll(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.stop) {
          await plugin.stop();
          logger.info({ plugin: name }, 'Plugin stopped');
        }
      } catch (error) {
        logger.error({ err: error, plugin: name }, 'Failed to stop plugin');
      }
    }
    this.plugins.clear();
    this.loaded = false;
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  private isDbManagedPlugin(dirName: string): boolean {
    if (!this.dbManager) return false;
    try {
      const db = this.dbManager.getDb();
      const row = db.prepare('SELECT 1 FROM plugins WHERE id = ?').get(dirName) as
        | { '1': number }
        | undefined;
      return !!row;
    } catch {
      return false;
    }
  }
}
