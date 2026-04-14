// Tools module exports
export * from './types.js';
export * from './registry.js';
export * from './executor.js';
export * from './engine.js';
export * from './formatter.js';
export * from './orchestrator.js';
export * from './workflows.js';
export * from './builtins/index.js';

import { getToolRegistry } from './registry.js';
import { builtinTools } from './builtins/index.js';
import { logger } from '../utils/logger.js';

/**
 * Register all built-in tools
 */
export function registerBuiltinTools(): void {
  const registry = getToolRegistry();
  
  for (const tool of builtinTools) {
    registry.register(tool);
  }
  
  logger.info(`Registered ${builtinTools.length} built-in tools`);
}
