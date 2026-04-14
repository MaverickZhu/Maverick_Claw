import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry, getToolRegistry, resetToolRegistry } from './registry.js';
import type { Tool } from './types.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  const mockTool: Tool = {
    definition: {
      name: 'test-tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input value' },
        },
        required: ['input'],
      },
    },
    execute: async (args) => ({ result: args.input }),
  };

  it('should register and retrieve tool', () => {
    registry.register(mockTool);
    
    const retrieved = registry.get('test-tool');
    expect(retrieved).toBeDefined();
    expect(retrieved?.definition.name).toBe('test-tool');
  });

  it('should check if tool exists', () => {
    expect(registry.has('test-tool')).toBe(false);
    
    registry.register(mockTool);
    expect(registry.has('test-tool')).toBe(true);
  });

  it('should list all tools', () => {
    registry.register(mockTool);
    registry.register({
      ...mockTool,
      definition: { ...mockTool.definition, name: 'another-tool' },
    });

    const tools = registry.list();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toContain('test-tool');
    expect(tools.map(t => t.name)).toContain('another-tool');
  });

  it('should unregister tool', () => {
    registry.register(mockTool);
    expect(registry.has('test-tool')).toBe(true);
    
    const result = registry.unregister('test-tool');
    expect(result).toBe(true);
    expect(registry.has('test-tool')).toBe(false);
  });

  it('should return false when unregistering non-existent tool', () => {
    const result = registry.unregister('non-existent');
    expect(result).toBe(false);
  });

  it('should overwrite existing tool', () => {
    registry.register(mockTool);
    
    const newTool = {
      ...mockTool,
      definition: { ...mockTool.definition, description: 'Updated' },
    };
    registry.register(newTool);
    
    const retrieved = registry.get('test-tool');
    expect(retrieved?.definition.description).toBe('Updated');
  });

  it('should clear all tools', () => {
    registry.register(mockTool);
    registry.clear();
    
    expect(registry.list()).toHaveLength(0);
  });
});

describe('Global ToolRegistry', () => {
  beforeEach(() => {
    resetToolRegistry();
  });

  it('should return singleton instance', () => {
    const registry1 = getToolRegistry();
    const registry2 = getToolRegistry();
    
    expect(registry1).toBe(registry2);
  });
});
