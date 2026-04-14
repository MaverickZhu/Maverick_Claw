import type { Tool, ToolDefinition, ToolContext } from './types.js';
import { logger } from '../utils/logger.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      logger.warn(`Tool ${name} already registered, overwriting`);
    }
    this.tools.set(name, tool);
    logger.info(`Registered tool: ${name}`);
  }

  unregister(name: string): boolean {
    const existed = this.tools.delete(name);
    if (existed) {
      logger.info(`Unregistered tool: ${name}`);
    }
    return existed;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  clear(): void {
    this.tools.clear();
  }
}

// Singleton instance
let globalRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}

export function resetToolRegistry(): void {
  globalRegistry = null;
}
