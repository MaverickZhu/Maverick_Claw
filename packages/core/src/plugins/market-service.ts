import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import JSZip from 'jszip';
import type { DatabaseManager } from '../storage/db.js';
import type {
  PluginManifest,
  RegistryIndex,
  RegistryPlugin,
  InstalledPlugin,
} from './types.js';
import { logger } from '../utils/logger.js';

const DEFAULT_REGISTRY_URL = 'https://registry.maverick-claw.dev/plugins.json';

export interface MarketServiceOptions {
  registryUrl?: string;
  pluginsDir?: string;
}

export class PluginMarketService {
  private registryUrl: string;
  private pluginsDir: string;

  constructor(
    private dbManager: DatabaseManager,
    options: MarketServiceOptions = {}
  ) {
    this.registryUrl = options.registryUrl || DEFAULT_REGISTRY_URL;
    this.pluginsDir = options.pluginsDir || this.resolvePluginsDir();
  }

  private get db() {
    return this.dbManager.getDb();
  }

  private resolvePluginsDir(): string {
    return path.resolve(process.cwd(), 'plugins');
  }

  /**
   * Fetch remote registry index
   */
  async fetchRegistry(url?: string): Promise<RegistryIndex | null> {
    const targetUrl = url || this.registryUrl;
    try {
      const data = await this.fetchJson<RegistryIndex>(targetUrl);
      logger.debug({ url: targetUrl, count: data.plugins?.length || 0 }, 'Fetched plugin registry');
      return data;
    } catch (err) {
      logger.warn({ err, url: targetUrl }, 'Failed to fetch plugin registry');
      return null;
    }
  }

  /**
   * List available plugins from registry
   */
  async listMarketPlugins(url?: string): Promise<RegistryPlugin[]> {
    const registry = await this.fetchRegistry(url);
    return registry?.plugins || [];
  }

  /**
   * Get a single market plugin by ID
   */
  async getMarketPlugin(id: string, url?: string): Promise<RegistryPlugin | null> {
    const plugins = await this.listMarketPlugins(url);
    return plugins.find((p) => p.id === id) || null;
  }

  /**
   * List installed plugins from DB
   */
  listInstalled(): InstalledPlugin[] {
    const rows = this.db
      .prepare('SELECT * FROM plugins ORDER BY installed_at DESC')
      .all() as Array<{
      id: string;
      name: string;
      version: string;
      description: string | null;
      author: string | null;
      source: string | null;
      enabled: number;
      installed_at: number;
      updated_at: number;
      manifest: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      description: r.description || undefined,
      author: r.author || undefined,
      source: r.source || undefined,
      enabled: Boolean(r.enabled),
      installedAt: r.installed_at,
      updatedAt: r.updated_at,
      manifest: r.manifest ? (JSON.parse(r.manifest) as PluginManifest) : undefined,
    }));
  }

  /**
   * Get a single installed plugin by ID
   */
  getInstalled(id: string): InstalledPlugin | null {
    const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as
      | {
          id: string;
          name: string;
          version: string;
          description: string | null;
          author: string | null;
          source: string | null;
          enabled: number;
          installed_at: number;
          updated_at: number;
          manifest: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description || undefined,
      author: row.author || undefined,
      source: row.source || undefined,
      enabled: Boolean(row.enabled),
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
      manifest: row.manifest ? (JSON.parse(row.manifest) as PluginManifest) : undefined,
    };
  }

  /**
   * Install a plugin from registry
   */
  async install(pluginId: string, url?: string): Promise<InstalledPlugin | null> {
    const plugin = await this.getMarketPlugin(pluginId, url);
    if (!plugin) {
      logger.warn({ pluginId }, 'Plugin not found in registry');
      return null;
    }

    // Check if already installed
    const existing = this.getInstalled(pluginId);
    if (existing) {
      logger.warn({ pluginId, version: existing.version }, 'Plugin already installed');
      return null;
    }

    // Download plugin package
    const zipBuffer = await this.downloadBuffer(plugin.downloadUrl);
    if (!zipBuffer) {
      logger.warn({ pluginId, url: plugin.downloadUrl }, 'Failed to download plugin');
      return null;
    }

    // Extract to plugins directory
    const pluginDir = path.join(this.pluginsDir, pluginId);
    await this.extractZip(zipBuffer, pluginDir);

    // Read manifest from extracted directory
    const manifest = await this.readManifest(pluginDir);
    if (!manifest) {
      logger.warn({ pluginId, pluginDir }, 'Plugin manifest not found after extraction');
      // Cleanup
      await this.removeDir(pluginDir);
      return null;
    }

    // Validate manifest ID matches
    if (manifest.id && manifest.id !== pluginId) {
      logger.warn({ pluginId, manifestId: manifest.id }, 'Plugin manifest ID mismatch');
      await this.removeDir(pluginDir);
      return null;
    }

    // Write to DB
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        'INSERT INTO plugins (id, name, version, description, author, source, enabled, installed_at, updated_at, manifest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        pluginId,
        manifest.name || plugin.name,
        manifest.version || plugin.version,
        manifest.description || plugin.description || null,
        manifest.author || plugin.author || null,
        plugin.downloadUrl,
        1,
        now,
        now,
        JSON.stringify(manifest)
      );

    logger.info({ pluginId, version: manifest.version }, 'Plugin installed');
    return this.getInstalled(pluginId);
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginId: string): Promise<boolean> {
    const existing = this.getInstalled(pluginId);
    if (!existing) {
      logger.warn({ pluginId }, 'Plugin not installed, cannot uninstall');
      return false;
    }

    // Remove plugin directory
    const pluginDir = path.join(this.pluginsDir, pluginId);
    if (fs.existsSync(pluginDir)) {
      await this.removeDir(pluginDir);
    }

    // Remove from DB
    this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);

    logger.info({ pluginId }, 'Plugin uninstalled');
    return true;
  }

  /**
   * Update a plugin to the latest version
   */
  async update(pluginId: string, url?: string): Promise<InstalledPlugin | null> {
    const existing = this.getInstalled(pluginId);
    if (!existing) {
      logger.warn({ pluginId }, 'Plugin not installed, cannot update');
      return null;
    }

    const marketPlugin = await this.getMarketPlugin(pluginId, url);
    if (!marketPlugin) {
      logger.warn({ pluginId }, 'Plugin not found in registry, cannot update');
      return null;
    }

    // Simple version comparison (string comparison, assuming semver)
    if (existing.version === marketPlugin.version) {
      logger.info({ pluginId, version: existing.version }, 'Plugin is already up to date');
      return existing;
    }

    // Remove old version
    const pluginDir = path.join(this.pluginsDir, pluginId);
    if (fs.existsSync(pluginDir)) {
      await this.removeDir(pluginDir);
    }

    // Download new version
    const zipBuffer = await this.downloadBuffer(marketPlugin.downloadUrl);
    if (!zipBuffer) {
      logger.warn({ pluginId, url: marketPlugin.downloadUrl }, 'Failed to download plugin update');
      return null;
    }

    // Extract
    await this.extractZip(zipBuffer, pluginDir);

    // Read new manifest
    const manifest = await this.readManifest(pluginDir);
    if (!manifest) {
      logger.warn({ pluginId, pluginDir }, 'Plugin manifest not found after update extraction');
      await this.removeDir(pluginDir);
      return null;
    }

    // Update DB
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        'UPDATE plugins SET name = ?, version = ?, description = ?, author = ?, source = ?, updated_at = ?, manifest = ? WHERE id = ?'
      )
      .run(
        manifest.name || marketPlugin.name,
        manifest.version || marketPlugin.version,
        manifest.description || marketPlugin.description || null,
        manifest.author || marketPlugin.author || null,
        marketPlugin.downloadUrl,
        now,
        JSON.stringify(manifest),
        pluginId
      );

    logger.info({ pluginId, from: existing.version, to: manifest.version }, 'Plugin updated');
    return this.getInstalled(pluginId);
  }

  /**
   * Check for available updates for installed plugins
   */
  async checkUpdates(url?: string): Promise<Array<{ id: string; current: string; latest: string }>> {
    const registry = await this.fetchRegistry(url);
    if (!registry) return [];

    const installed = this.listInstalled();
    const updates: Array<{ id: string; current: string; latest: string }> = [];

    for (const local of installed) {
      const remote = registry.plugins.find((p) => p.id === local.id);
      if (remote && remote.version !== local.version) {
        updates.push({ id: local.id, current: local.version, latest: remote.version });
      }
    }

    return updates;
  }

  /**
   * Enable or disable a plugin
   */
  setEnabled(pluginId: string, enabled: boolean): boolean {
    const existing = this.getInstalled(pluginId);
    if (!existing) return false;

    this.db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, pluginId);
    logger.info({ pluginId, enabled }, 'Plugin enabled state changed');
    return true;
  }

  // ---- Private helpers ----

  private async fetchJson<T>(url: string): Promise<T> {
    const text = await this.fetchText(url);
    return JSON.parse(text) as T;
  }

  private fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          this.fetchText(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  private downloadBuffer(url: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.downloadBuffer(res.headers.location).then(resolve);
          return;
        }
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(60000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  private async extractZip(buffer: Buffer, targetDir: string): Promise<void> {
    const zip = await JSZip.loadAsync(buffer);

    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Extract all files
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      const entryPath = path.join(targetDir, entry.name);
      const entryDir = path.dirname(entryPath);
      if (!fs.existsSync(entryDir)) {
        fs.mkdirSync(entryDir, { recursive: true });
      }
      const content = await entry.async('nodebuffer');
      fs.writeFileSync(entryPath, content);
    }
  }

  private async readManifest(pluginDir: string): Promise<PluginManifest | null> {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as PluginManifest;
    } catch {
      return null;
    }
  }

  private async removeDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.removeDir(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }
    fs.rmdirSync(dir);
  }
}
