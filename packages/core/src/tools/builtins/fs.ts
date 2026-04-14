// File system tool for reading files
import type { Tool } from '../types.js';
import { readFile, stat } from 'fs/promises';
import { resolve, basename } from 'path';

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: '读取文件内容，支持文本文件。可以读取代码文件、配置文件、日志文件等。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对路径或绝对路径）',
        },
        limit: {
          type: 'number',
          description: '读取的最大行数，默认读取全部',
        },
      },
      required: ['path'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const filePath = String(args.path);
    const limit = args.limit ? Number(args.limit) : undefined;

    try {
      // Resolve to absolute path
      const resolvedPath = resolve(filePath);
      
      // Security: Check file stats
      const stats = await stat(resolvedPath);
      
      if (!stats.isFile()) {
        return { error: 'Path is not a file' };
      }

      // Security: Limit file size (10MB)
      const MAX_SIZE = 10 * 1024 * 1024;
      if (stats.size > MAX_SIZE) {
        return { error: 'File too large (>10MB)' };
      }

      // Read file
      let content = await readFile(resolvedPath, 'utf-8');

      // Apply line limit if specified
      if (limit && limit > 0) {
        const lines = content.split('\n');
        const totalLines = lines.length;
        if (totalLines > limit) {
          content = lines.slice(0, limit).join('\n') + 
            `\n\n... (${totalLines - limit} more lines)`;
        }
      }

      return {
        path: resolvedPath,
        name: basename(resolvedPath),
        size: stats.size,
        content,
        truncated: limit && content.split('\n').length >= limit,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to read file',
        path: filePath,
      };
    }
  },
};

export const listDirectoryTool: Tool = {
  definition: {
    name: 'list_directory',
    description: '列出目录中的文件和子目录',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目录路径（相对路径或绝对路径），默认为当前目录',
        },
        recursive: {
          type: 'boolean',
          description: '是否递归列出子目录内容',
        },
      },
      required: [],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const dirPath = String(args.path || '.');
    const recursive = Boolean(args.recursive);

    try {
      const { readdir } = await import('fs/promises');
      const { resolve, join, relative } = await import('path');
      
      const resolvedPath = resolve(dirPath);

      async function listDir(dir: string, basePath: string): Promise<unknown[]> {
        const entries = await readdir(dir, { withFileTypes: true });
        const result = [];

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          const relativePath = relative(basePath, fullPath);

          if (entry.isDirectory()) {
            const item: Record<string, unknown> = {
              name: entry.name,
              type: 'directory',
              path: relativePath,
            };
            
            if (recursive) {
              try {
                item.children = await listDir(fullPath, basePath);
              } catch {
                // Ignore permission errors for subdirectories
              }
            }
            
            result.push(item);
          } else {
            result.push({
              name: entry.name,
              type: 'file',
              path: relativePath,
            });
          }
        }

        return result;
      }

      const items = await listDir(resolvedPath, resolvedPath);

      return {
        path: resolvedPath,
        items,
        count: items.length,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to list directory',
        path: dirPath,
      };
    }
  },
};
