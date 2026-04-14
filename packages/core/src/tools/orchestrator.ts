// Tool Orchestrator - Manages multi-tool execution with dependencies
import type { ToolCall, ToolResult } from './types.js';
import { getToolExecutionEngine } from './engine.js';
import { logger } from '../utils/logger.js';

export interface ToolNode {
  id: string;
  toolCall: ToolCall;
  dependencies: string[];  // IDs of tools that must complete before this one
  condition?: (results: Map<string, ToolResult>) => boolean;  // Conditional execution
}

export interface ExecutionPlan {
  nodes: ToolNode[];
  parallel: boolean;  // Whether to execute independent nodes in parallel
  timeout?: number;   // Total plan timeout
}

export interface ExecutionResult {
  success: boolean;
  results: Map<string, ToolResult>;
  errors: Map<string, string>;
  executionTime: number;
  completedNodes: string[];
  failedNodes: string[];
}

export class ToolOrchestrator {
  private engine = getToolExecutionEngine();

  /**
   * Execute a plan of multiple tools
   */
  async executePlan(
    plan: ExecutionPlan,
    context: { sessionId: string; requestId: string }
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const results = new Map<string, ToolResult>();
    const errors = new Map<string, string>();
    const completedNodes: string[] = [];
    const failedNodes: string[] = [];

    logger.info({ 
      nodeCount: plan.nodes.length, 
      parallel: plan.parallel,
      requestId: context.requestId 
    }, 'Starting tool execution plan');

    // Build dependency graph
    const nodeMap = new Map(plan.nodes.map(n => [n.id, n]));
    const pendingNodes = new Set(plan.nodes.map(n => n.id));
    const executingNodes = new Set<string>();

    while (pendingNodes.size > 0 || executingNodes.size > 0) {
      // Find ready nodes (all dependencies satisfied)
      const readyNodes = plan.nodes.filter(node => 
        pendingNodes.has(node.id) &&
        !executingNodes.has(node.id) &&
        node.dependencies.every(dep => completedNodes.includes(dep)) &&
        !failedNodes.includes(node.id) &&
        this.checkCondition(node, results)
      );

      if (readyNodes.length === 0 && executingNodes.size === 0) {
        // Deadlock or all remaining nodes have failed dependencies
        break;
      }

      if (readyNodes.length > 0) {
        if (plan.parallel && readyNodes.length > 1) {
          // Execute independent nodes in parallel
          const batch = readyNodes;
          logger.debug({ nodes: batch.map(n => n.id) }, 'Executing batch in parallel');
          
          const batchPromises = batch.map(async node => {
            executingNodes.add(node.id);
            pendingNodes.delete(node.id);
            
            const result = await this.executeNode(node, context, results);
            
            executingNodes.delete(node.id);
            
            if (result.error) {
              errors.set(node.id, result.error);
              failedNodes.push(node.id);
            } else {
              completedNodes.push(node.id);
            }
            results.set(node.id, result);
          });

          await Promise.all(batchPromises);
        } else {
          // Execute sequentially
          const node = readyNodes[0];
          executingNodes.add(node.id);
          pendingNodes.delete(node.id);
          
          const result = await this.executeNode(node, context, results);
          
          executingNodes.delete(node.id);
          
          if (result.error) {
            errors.set(node.id, result.error);
            failedNodes.push(node.id);
          } else {
            completedNodes.push(node.id);
          }
          results.set(node.id, result);
        }
      } else {
        // Wait for executing nodes to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const executionTime = Date.now() - startTime;
    const success = failedNodes.length === 0;

    logger.info({ 
      success,
      completed: completedNodes.length,
      failed: failedNodes.length,
      executionTime,
      requestId: context.requestId 
    }, 'Tool execution plan completed');

    return {
      success,
      results,
      errors,
      executionTime,
      completedNodes,
      failedNodes,
    };
  }

  /**
   * Execute a single node with argument substitution
   */
  private async executeNode(
    node: ToolNode,
    context: { sessionId: string; requestId: string },
    previousResults: Map<string, ToolResult>
  ): Promise<ToolResult> {
    // Substitute variables in arguments
    const substitutedArgs = this.substituteArguments(
      node.toolCall.arguments,
      previousResults
    );

    const toolCall: ToolCall = {
      ...node.toolCall,
      arguments: substitutedArgs,
    };

    logger.debug({ nodeId: node.id, tool: toolCall.name }, 'Executing node');

    return this.engine.execute(toolCall, {
      sessionId: context.sessionId,
      requestId: `${context.requestId}-${node.id}`,
      startTime: Date.now(),
    });
  }

  /**
   * Check if node's condition is satisfied
   */
  private checkCondition(
    node: ToolNode,
    results: Map<string, ToolResult>
  ): boolean {
    if (!node.condition) return true;
    return node.condition(results);
  }

  /**
   * Substitute variables like ${nodeId.output.field} in arguments
   */
  private substituteArguments(
    args: Record<string, unknown>,
    results: Map<string, ToolResult>
  ): Record<string, unknown> {
    const substituted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        substituted[key] = this.substituteVariables(value, results);
      } else if (typeof value === 'object' && value !== null) {
        substituted[key] = this.substituteArguments(
          value as Record<string, unknown>,
          results
        );
      } else {
        substituted[key] = value;
      }
    }

    return substituted;
  }

  /**
   * Substitute variables in a string
   * Pattern: ${nodeId.output.field}
   */
  private substituteVariables(
    str: string,
    results: Map<string, ToolResult>
  ): string {
    const pattern = /\$\{(\w+)\.output(?:\.(\w+))?\}/g;
    
    return str.replace(pattern, (match, nodeId, field) => {
      const result = results.get(nodeId);
      if (!result || result.error) {
        logger.warn({ nodeId, match }, 'Variable substitution failed - result not found');
        return match; // Keep original if not found
      }

      const output = result.output as Record<string, unknown>;
      if (field && output && typeof output === 'object') {
        return String(output[field] ?? match);
      }
      return String(output ?? match);
    });
  }

  /**
   * Create a simple sequential plan from tool calls
   */
  createSequentialPlan(toolCalls: ToolCall[]): ExecutionPlan {
    return {
      nodes: toolCalls.map((tc, index) => ({
        id: `step-${index}`,
        toolCall: tc,
        dependencies: index > 0 ? [`step-${index - 1}`] : [],
      })),
      parallel: false,
    };
  }

  /**
   * Create a parallel plan from independent tool calls
   */
  createParallelPlan(toolCalls: ToolCall[]): ExecutionPlan {
    return {
      nodes: toolCalls.map((tc, index) => ({
        id: `step-${index}`,
        toolCall: tc,
        dependencies: [],
      })),
      parallel: true,
    };
  }

  /**
   * Create a plan from AI's multi-tool call
   * Analyzes dependencies automatically
   */
  createSmartPlan(toolCalls: ToolCall[]): ExecutionPlan {
    // Simple heuristic: file read operations should go first
    const fileTools = ['read_file', 'list_directory'];
    
    const nodes: ToolNode[] = toolCalls.map((tc, index) => {
      const isFileOp = fileTools.includes(tc.name);
      
      return {
        id: `tool-${index}`,
        toolCall: tc,
        // File operations have no dependencies
        // Other tools may depend on file reads
        dependencies: isFileOp ? [] : [],
      };
    });

    return {
      nodes,
      parallel: true, // Try parallel first
    };
  }
}

// Singleton
let globalOrchestrator: ToolOrchestrator | null = null;

export function getToolOrchestrator(): ToolOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new ToolOrchestrator();
  }
  return globalOrchestrator;
}
