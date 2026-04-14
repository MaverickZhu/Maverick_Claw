// Code execution and analysis tools
import type { Tool } from '../types.js';

export const analyzeCodeTool: Tool = {
  definition: {
    name: 'analyze_code',
    description: '分析代码，提供代码质量建议、潜在问题检测和优化建议',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要分析的代码',
        },
        language: {
          type: 'string',
          description: '代码语言（javascript, typescript, python, java, cpp, etc.）',
        },
      },
      required: ['code', 'language'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const code = String(args.code);
    const language = String(args.language).toLowerCase();

    const analysis = {
      language,
      lines: code.split('\n').length,
      issues: [] as Array<{ type: string; message: string; line?: number }>,
      metrics: {
        functions: 0,
        classes: 0,
        comments: 0,
        emptyLines: 0,
      },
    };

    // Basic code analysis
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Count metrics
      if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('/*')) {
        analysis.metrics.comments++;
      }
      if (line.trim() === '') {
        analysis.metrics.emptyLines++;
      }

      // Language-specific patterns
      if (['javascript', 'typescript', 'java', 'cpp', 'c', 'csharp'].includes(language)) {
        if (/function\s+\w+|\w+\s*\([^)]*\)\s*{|=>\s*{/.test(line)) {
          analysis.metrics.functions++;
        }
        if (/class\s+\w+/.test(line)) {
          analysis.metrics.classes++;
        }
      } else if (language === 'python') {
        if (/^def\s+\w+/.test(line)) {
          analysis.metrics.functions++;
        }
        if (/^class\s+\w+/.test(line)) {
          analysis.metrics.classes++;
        }
      }

      // Common issues detection
      if (line.includes('TODO') || line.includes('FIXME')) {
        analysis.issues.push({
          type: 'info',
          message: `Found ${line.includes('TODO') ? 'TODO' : 'FIXME'} comment`,
          line: lineNum,
        });
      }

      if (/console\.log|print\(|Debug\.|logger\.debug/.test(line)) {
        analysis.issues.push({
          type: 'warning',
          message: 'Debug logging statement found',
          line: lineNum,
        });
      }

      if (/password|secret|api_key|token/i.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('#')) {
        analysis.issues.push({
          type: 'warning',
          message: 'Possible hardcoded secret detected',
          line: lineNum,
        });
      }
    }

    // File size check
    if (analysis.lines > 500) {
      analysis.issues.push({
        type: 'warning',
        message: 'File is quite large (>500 lines), consider splitting into smaller modules',
      });
    }

    return analysis;
  },
};

export const formatJsonTool: Tool = {
  definition: {
    name: 'format_json',
    description: '格式化 JSON 数据，验证 JSON 有效性并美化输出',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON 字符串',
        },
        indent: {
          type: 'number',
          description: '缩进空格数，默认2',
        },
      },
      required: ['json'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const jsonStr = String(args.json);
    const indent = args.indent ? Number(args.indent) : 2;

    try {
      const parsed = JSON.parse(jsonStr);
      const formatted = JSON.stringify(parsed, null, indent);
      
      return {
        valid: true,
        formatted,
        type: getJsonType(parsed),
        size: {
          original: jsonStr.length,
          formatted: formatted.length,
          keys: countJsonKeys(parsed),
        },
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  },
};

function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function countJsonKeys(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  if (Array.isArray(value)) return value.length;
  return Object.keys(value).length;
}
