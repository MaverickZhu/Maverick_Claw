import type { Tool } from '../types.js';

export const calculatorTool: Tool = {
  definition: {
    name: 'calculator',
    description: '执行数学计算，支持基本运算、科学计算和表达式求值',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式，如 "2 + 2", "sin(30)", "sqrt(16)"',
        },
        precision: {
          type: 'number',
          description: '结果精度（小数位数），默认为 10',
        },
      },
      required: ['expression'],
    },
  },

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const expression = (args.expression as string)?.trim();
    const precision = (args.precision as number) ?? 10;

    if (!expression) {
      throw new Error('Expression is required');
    }

    // Safe math evaluation - only allow basic operators and math functions
    const sanitized = sanitizeExpression(expression);
    
    try {
      const result = evaluateSafely(sanitized);
      
      return {
        expression,
        result: Number(result.toFixed(precision)),
        raw: result,
      };
    } catch (error) {
      throw new Error(`Failed to evaluate expression: ${expression}. Error: ${error}`);
    }
  },
};

function sanitizeExpression(expr: string): string {
  // Remove potentially dangerous characters
  const allowed = /^[\d\s+\-*/().,^%!&|<>=""''a-zA-Z]+$/;
  
  if (!allowed.test(expr)) {
    throw new Error('Expression contains invalid characters');
  }

  // Replace common mathematical notations
  let sanitized = expr
    .replace(/\^/g, '**')
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\be\b/gi, 'Math.E');

  // Replace math functions with Math.
  const mathFunctions = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'floor', 'ceil', 'round', 'log', 'ln', 'exp', 'min', 'max', 'pow'];
  
  for (const fn of mathFunctions) {
    const regex = new RegExp(`\\b${fn}\\s*\\(`, 'gi');
    sanitized = sanitized.replace(regex, `Math.${fn}(`);
  }

  // Handle ln (natural log) -> log
  sanitized = sanitized.replace(/Math\.ln\(/g, 'Math.log(');

  return sanitized;
}

function evaluateSafely(expr: string): number {
  const func = new Function(`
    "use strict";
    return (${expr});
  `);
  
  const result = func();
  
  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Invalid calculation result');
  }
  
  return result;
}
