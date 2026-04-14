// Tool Execution Engine - Manages tool lifecycle, policies, and execution
import type { Tool, ToolCall, ToolResult } from './types.js';
import { getToolRegistry } from './registry.js';
import { logger } from '../utils/logger.js';

export interface ToolExecutionContext {
  sessionId: string;
  userId?: string;
  requestId: string;
  startTime: number;
  timeout?: number;
}

export interface ToolExecutionRecord {
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  error?: string;
  duration: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'running' | 'success' | 'error' | 'timeout';
}

export interface ToolPolicy {
  allow?: string[];      // Whitelist of allowed tools
  deny?: string[];       // Blacklist of denied tools
  requireApproval?: string[];  // Tools requiring manual approval
  timeout?: number;      // Default timeout in ms
}

export class ToolExecutionEngine {
  private executionHistory = new Map<string, ToolExecutionRecord[]>();
  private activeExecutions = new Map<string, AbortController>();
  private policy: ToolPolicy;

  constructor(policy: ToolPolicy = {}) {
    this.policy = policy;
  }

  /**
   * Check if tool is allowed by policy
   */
  isToolAllowed(toolName: string): boolean {
    // Check deny list first
    if (this.policy.deny?.includes(toolName)) {
      return false;
    }
    // Check allow list
    if (this.policy.allow && !this.policy.allow.includes(toolName)) {
      return false;
    }
    return true;
  }

  /**
   * Check if tool requires approval
   */
  requiresApproval(toolName: string): boolean {
    return this.policy.requireApproval?.includes(toolName) ?? false;
  }

  /**
   * Update policy
   */
  setPolicy(policy: ToolPolicy): void {
    this.policy = { ...this.policy, ...policy };
    logger.info({ policy: this.policy }, 'Tool policy updated');
  }

  /**
   * Execute a single tool with full lifecycle management
   */
  async execute(
    toolCall: ToolCall,
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolResult> {
    const registry = getToolRegistry();
    const tool = registry.get(toolCall.name);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: null,
        error: `Tool not found: ${toolCall.name}`,
      };
    }

    // Policy check
    if (!this.isToolAllowed(toolCall.name)) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: null,
        error: `Tool "${toolCall.name}" is not allowed by policy`,
      };
    }

    const executionId = `${context.sessionId || 'anon'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const timeout = context.timeout || this.policy.timeout || 30000;

    // Create execution record
    const record: ToolExecutionRecord = {
      id: executionId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      result: null,
      duration: 0,
      startTime,
      endTime: 0,
      status: 'running',
    };

    // Store in history
    this.addToHistory(context.sessionId || 'global', record);

    // Create abort controller for timeout
    const controller = new AbortController();
    this.activeExecutions.set(executionId, controller);

    try {
      logger.info({ 
        executionId, 
        tool: toolCall.name, 
        sessionId: context.sessionId 
      }, 'Executing tool');

      // Execute with timeout
      const result = await this.executeWithTimeout(
        tool,
        toolCall.arguments,
        timeout,
        controller.signal
      );

      // Update record
      record.result = result;
      record.status = 'success';
      record.duration = Date.now() - startTime;
      record.endTime = Date.now();

      logger.info({ 
        executionId, 
        tool: toolCall.name, 
        duration: record.duration 
      }, 'Tool execution completed');

      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: result,
        duration: record.duration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Tool execution failed';
      
      record.error = errorMsg;
      record.status = errorMsg.includes('timeout') ? 'timeout' : 'error';
      record.duration = Date.now() - startTime;
      record.endTime = Date.now();

      logger.error({ 
        executionId, 
        tool: toolCall.name, 
        error: errorMsg 
      }, 'Tool execution failed');

      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: null,
        error: errorMsg,
        duration: record.duration,
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute tool with timeout support
   */
  private async executeWithTimeout(
    tool: Tool,
    args: Record<string, unknown>,
    timeout: number,
    signal: AbortSignal
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Tool execution timeout'));
      }, timeout);

      // Listen for abort
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Tool execution aborted'));
      });

      // Execute tool
      tool.execute(args)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Execute multiple tools sequentially
   */
  async executeSequential(
    toolCalls: ToolCall[],
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.execute(toolCall, context);
      results.push(result);

      // Stop on error
      if (result.error) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeParallel(
    toolCalls: ToolCall[],
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolResult[]> {
    const promises = toolCalls.map(tc => this.execute(tc, context));
    return Promise.all(promises);
  }

  /**
   * Cancel active execution
   */
  cancelExecution(executionId: string): boolean {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Get execution history for a session
   */
  getHistory(sessionId: string): ToolExecutionRecord[] {
    return this.executionHistory.get(sessionId) || [];
  }

  /**
   * Get all active executions
   */
  getActiveExecutions(): Array<{ id: string; toolName: string; startTime: number }> {
    const result = [];
    for (const [sessionId, records] of this.executionHistory) {
      for (const record of records) {
        if (record.status === 'running') {
          result.push({
            id: record.id,
            toolName: record.toolName,
            startTime: record.startTime,
          });
        }
      }
    }
    return result;
  }

  /**
   * Clear history for a session
   */
  clearHistory(sessionId: string): void {
    this.executionHistory.delete(sessionId);
  }

  private addToHistory(sessionId: string, record: ToolExecutionRecord): void {
    if (!this.executionHistory.has(sessionId)) {
      this.executionHistory.set(sessionId, []);
    }
    const history = this.executionHistory.get(sessionId)!;
    history.push(record);

    // Keep only last 100 records per session
    if (history.length > 100) {
      history.shift();
    }
  }
}

// Singleton instance
let globalEngine: ToolExecutionEngine | null = null;

export function getToolExecutionEngine(policy?: ToolPolicy): ToolExecutionEngine {
  if (!globalEngine) {
    globalEngine = new ToolExecutionEngine(policy);
  }
  return globalEngine;
}

export function resetToolExecutionEngine(): void {
  globalEngine = null;
}
