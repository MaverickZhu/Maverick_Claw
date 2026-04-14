// Tool Result Formatter - Formats tool results for display
import type { ToolResult } from './types.js';

export interface FormattedResult {
  type: 'text' | 'json' | 'table' | 'image' | 'error' | 'code';
  content: string;
  metadata?: Record<string, unknown>;
}

export class ToolResultFormatter {
  /**
   * Format a tool result for display
   */
  format(result: ToolResult): FormattedResult {
    if (result.error) {
      return {
        type: 'error',
        content: result.error,
        metadata: { toolName: result.name },
      };
    }

    const output = result.output;

    // Handle different output types
    if (output === null || output === undefined) {
      return {
        type: 'text',
        content: 'No output',
        metadata: { toolName: result.name },
      };
    }

    // String output
    if (typeof output === 'string') {
      return {
        type: 'text',
        content: output,
        metadata: { toolName: result.name },
      };
    }

    // Object output - format based on tool name
    return this.formatObject(result.name, output);
  }

  /**
   * Format object output based on tool type
   */
  private formatObject(toolName: string, output: unknown): FormattedResult {
    const obj = output as Record<string, unknown>;

    // File read tool
    if (toolName === 'read_file' && obj.content !== undefined) {
      return {
        type: 'code',
        content: String(obj.content),
        metadata: {
          toolName,
          filename: obj.name,
          path: obj.path,
          size: obj.size,
        },
      };
    }

    // Directory listing
    if (toolName === 'list_directory' && Array.isArray(obj.items)) {
      const lines = obj.items.map((item: { name: string; type: string }) => 
        `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`
      );
      return {
        type: 'text',
        content: `Directory: ${obj.path}\n\n${lines.join('\n')}`,
        metadata: { toolName, count: obj.count },
      };
    }

    // System info
    if (toolName === 'system_info') {
      const info = obj as Record<string, any>;
      const lines = [
        `💻 System Information`,
        `Platform: ${info.platform} ${info.arch}`,
        `Hostname: ${info.hostname}`,
        `Release: ${info.release}`,
        ``,
        `🧠 CPU: ${info.cpus?.model} (${info.cpus?.count} cores)`,
        `💾 Memory: ${info.memory?.used} / ${info.memory?.total} (${info.memory?.usagePercent}%)`,
        `⏱️ Uptime: ${info.uptime}`,
      ];
      return {
        type: 'text',
        content: lines.join('\n'),
        metadata: { toolName },
      };
    }

    // Datetime
    if (toolName === 'datetime') {
      return {
        type: 'text',
        content: `🕐 ${obj.datetime}\n📅 Date: ${obj.date}\n⏰ Time: ${obj.time}\n🌍 Timezone: ${obj.timezone}`,
        metadata: { toolName, iso: obj.iso },
      };
    }

    // Calculator
    if (toolName === 'calculator') {
      return {
        type: 'text',
        content: `🧮 ${obj.expression} = ${obj.result}`,
        metadata: { toolName },
      };
    }

    // Fetch URL
    if (toolName === 'fetch_url') {
      if (obj.error) {
        return {
          type: 'error',
          content: String(obj.error),
          metadata: { toolName, url: obj.url },
        };
      }
      return {
        type: 'text',
        content: `📄 ${obj.title || obj.url}\n\n${obj.content}`,
        metadata: { 
          toolName, 
          url: obj.url, 
          type: obj.type,
          truncated: obj.truncated,
        },
      };
    }

    // Code analysis
    if (toolName === 'analyze_code') {
      const analysis = obj as Record<string, any>;
      const lines = [
        `🔍 Code Analysis: ${analysis.language}`,
        `Lines: ${analysis.lines}`,
        `Functions: ${analysis.metrics?.functions || 0}`,
        `Classes: ${analysis.metrics?.classes || 0}`,
        `Comments: ${analysis.metrics?.comments || 0}`,
      ];
      
      const issues = analysis.issues as Array<{ type: string; message: string; line?: number }>;
      if (issues?.length > 0) {
        lines.push('\n⚠️ Issues:');
        issues.forEach((issue) => {
          lines.push(`  [${issue.type}] ${issue.message}${issue.line ? ` (line ${issue.line})` : ''}`);
        });
      }

      return {
        type: 'text',
        content: lines.join('\n'),
        metadata: { toolName },
      };
    }

    // JSON formatter
    if (toolName === 'format_json') {
      if (!obj.valid) {
        return {
          type: 'error',
          content: String(obj.error),
          metadata: { toolName },
        };
      }
      return {
        type: 'json',
        content: String(obj.formatted),
        metadata: { toolName, type: obj.type, size: obj.size },
      };
    }

    // Run command
    if (toolName === 'run_command') {
      if (!obj.success) {
        return {
          type: 'error',
          content: `Command failed: ${obj.error}`,
          metadata: { toolName, command: obj.command },
        };
      }
      return {
        type: 'code',
        content: `$ ${obj.command}\n${obj.stdout}${obj.stderr ? '\n[stderr]\n' + obj.stderr : ''}`,
        metadata: { toolName, command: obj.command },
      };
    }

    // Default: pretty print JSON
    return {
      type: 'json',
      content: JSON.stringify(output, null, 2),
      metadata: { toolName },
    };
  }

  /**
   * Format multiple results
   */
  formatMultiple(results: ToolResult[]): FormattedResult[] {
    return results.map(r => this.format(r));
  }

  /**
   * Create a summary of multiple tool executions
   */
  createSummary(results: ToolResult[]): string {
    const total = results.length;
    const success = results.filter(r => !r.error).length;
    const failed = total - success;

    const lines = [
      `🔧 Tool Execution Summary`,
      `Total: ${total} | ✅ Success: ${success} | ❌ Failed: ${failed}`,
      ``,
    ];

    for (const result of results) {
      const icon = result.error ? '❌' : '✅';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      lines.push(`${icon} ${result.name}${duration}${result.error ? ': ' + result.error : ''}`);
    }

    return lines.join('\n');
  }
}

// Singleton
let globalFormatter: ToolResultFormatter | null = null;

export function getToolResultFormatter(): ToolResultFormatter {
  if (!globalFormatter) {
    globalFormatter = new ToolResultFormatter();
  }
  return globalFormatter;
}
