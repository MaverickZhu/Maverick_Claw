// Chat service with streaming support and tools
import type { SessionManager } from '../storage/session.js';
import type { MessageManager } from '../storage/message.js';
import type { ChatMessage } from './model.js';
import { getModelRegistry } from './model.js';
import { getToolRegistry } from '../tools/index.js';
import { getToolExecutionEngine } from '../tools/engine.js';
import { getToolResultFormatter } from '../tools/formatter.js';
import { getToolOrchestrator } from '../tools/orchestrator.js';
import type { ToolCall, ToolResult } from '../tools/types.js';
import { logger } from '../utils/logger.js';

export interface ChatStreamOptions {
  sessionId: string;
  content: string;
  modelId?: string;
  onChunk: (chunk: { content: string; done: boolean }) => void;
  onError: (error: Error) => void;
}

export class ChatService {
  private toolEngine = getToolExecutionEngine();
  private toolFormatter = getToolResultFormatter();
  private orchestrator = getToolOrchestrator();

  constructor(
    private sessionManager: SessionManager,
    private messageManager: MessageManager
  ) {}

  async *streamChat(options: ChatStreamOptions): AsyncGenerator<{ content: string; done: boolean }> {
    const { sessionId, content, modelId } = options;

    try {
      // Get session
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Save user message
      await this.messageManager.createMessage({
        sessionId,
        role: 'user',
        content,
      });

      // Get model provider
      const registry = getModelRegistry();
      const preferredModelRefs = [modelId, session.modelId].filter(
        (ref): ref is string => Boolean(ref && ref.trim())
      );
      let modelRef = preferredModelRefs.find((ref) => {
        const providerId = ref.split(':')[0];
        return registry.has(providerId);
      });

      if (!modelRef) {
        const [fallbackProvider] = registry.list();
        if (!fallbackProvider) {
          throw new Error('No model provider registered');
        }
        const fallbackModels = await fallbackProvider.listModels();
        modelRef = `${fallbackProvider.id}:${fallbackModels[0] ?? ''}`;
      }

      const colonIndex = modelRef.indexOf(':') > 0 ? modelRef.indexOf(':') : modelRef.length;
      const providerId = modelRef.slice(0, colonIndex);
      const provider = registry.get(providerId);

      if (!provider) {
        throw new Error(`Model provider not found: ${providerId}`);
      }

      let actualModel = colonIndex < modelRef.length ? modelRef.slice(colonIndex + 1) : '';
      if (!actualModel) {
        const providerModels = await provider.listModels();
        actualModel = providerModels[0] ?? '';
      }

      if (!actualModel) {
        throw new Error(`No available model found for provider: ${providerId}`);
      }

      // Get conversation history
      const messages = await this.getConversationHistory(sessionId);

      // Get tools
      const toolRegistry = getToolRegistry();
      const availableTools = toolRegistry?.list() || [];
      const useTools = availableTools.length > 0 && provider.supportsTools();
      const providerCapabilities = provider.getCapabilities();
      const preferredTemperature =
        providerCapabilities.parameterSupport.temperature.default ?? 0.7;
      
      logger.info({ 
        providerId, 
        actualModel, 
        toolsAvailable: availableTools.length,
        useTools,
        preferredTemperature,
        toolNames: availableTools.map(t => t.name)
      }, 'Starting chat completion');

      // First pass: stream completion with tools
      let fullContent = '';
      const toolCallMap = new Map<string, ToolCall>();
      
      const stream = provider.chatCompletion({
        model: actualModel,
        messages,
        temperature: preferredTemperature,
        stream: true,
        tools: useTools ? availableTools : undefined,
        toolChoice: useTools ? 'auto' : undefined,
      });

      for await (const chunk of stream) {
        // Handle content
        if (chunk.content) {
          fullContent += chunk.content;
          yield { content: chunk.content, done: false };
        }

        // Collect tool calls (deduplicate by id)
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          for (const tc of chunk.toolCalls) {
            if (!toolCallMap.has(tc.id)) {
              toolCallMap.set(tc.id, tc);
              logger.info({ tool: tc.name, id: tc.id }, 'Tool call received');
            }
          }
        }

        if (chunk.done) {
          yield { content: '', done: true };
        }
      }
      
      const toolCalls = Array.from(toolCallMap.values());

      // Execute tools if any
      if (toolCalls.length > 0) {
        logger.info({ toolCount: toolCalls.length, tools: toolCalls.map(t => t.name) }, 'Executing tools');
        
        // Use orchestrator for smart parallel execution
        const plan = this.orchestrator.createSmartPlan(toolCalls);
        
        yield { content: `\n🔧 Executing ${toolCalls.length} tool(s)...\n`, done: false };

        const orchestrationResult = await this.orchestrator.executePlan(plan, {
          sessionId,
          requestId: `${sessionId}-${Date.now()}`,
        });

        // Show execution summary
        if (orchestrationResult.success) {
          yield { content: `✅ All tools completed (${orchestrationResult.executionTime}ms)\n`, done: false };
        } else {
          yield { content: `⚠️ ${orchestrationResult.failedNodes.length} tool(s) failed\n`, done: false };
        }

        // Build tool results for messages
        const toolResults: ToolResult[] = [];
        for (const [, result] of orchestrationResult.results) {
          toolResults.push(result);
          
          // Show individual results
          const status = result.error ? '❌' : '✅';
          yield { content: `${status} ${result.name}${result.duration ? ` (${result.duration}ms)` : ''}\n`, done: false };
        }

        // Add assistant message with tool calls to history
        messages.push({
          role: 'assistant',
          content: fullContent,
          toolCalls,
        } as ChatMessage);

        // Add tool results to messages
        for (const result of toolResults) {
          messages.push({
            role: 'tool',
            content: JSON.stringify(result.output ?? { error: result.error }),
            toolCallId: result.toolCallId,
          });
        }

        // Get final response from AI with tool results
        logger.info('Getting final response after tool execution');
        yield { content: '\n💭 Analyzing results...\n', done: false };
        
        const finalStream = provider.chatCompletion({
          model: actualModel,
          messages,
          temperature: preferredTemperature,
          stream: true,
        });

        for await (const chunk of finalStream) {
          if (chunk.content) {
            fullContent += chunk.content;
            yield { content: chunk.content, done: false };
          }
          if (chunk.done) {
            yield { content: '', done: true };
          }
        }
      }

      // Save assistant message
      await this.messageManager.createMessage({
        sessionId,
        role: 'assistant',
        content: fullContent,
        metadata: {
          model: actualModel,
          provider: providerId,
          providerName: provider.name,
          hasToolCalls: toolCalls.length > 0,
          toolNames: toolCalls.length > 0 ? toolCalls.map(t => t.name) : undefined,
        },
      });

    } catch (error) {
      logger.error({ err: error }, 'Chat stream error');
      throw error;
    }
  }

  /**
   * Execute a predefined workflow
   */
  async executeWorkflow(
    workflowName: string,
    params: Record<string, unknown>,
    sessionId: string
  ): Promise<{ success: boolean; results: ToolResult[]; summary: string }> {
    const { getWorkflowTemplate } = await import('../tools/workflows.js');
    const template = getWorkflowTemplate(workflowName);
    
    if (!template) {
      throw new Error(`Workflow not found: ${workflowName}`);
    }

    const plan = template.createPlan(params);
    const result = await this.orchestrator.executePlan(plan, {
      sessionId,
      requestId: `${sessionId}-workflow-${Date.now()}`,
    });

    const results = Array.from(result.results.values());
    const summary = this.toolFormatter.createSummary(results);

    return {
      success: result.success,
      results,
      summary,
    };
  }

  /**
   * Get tool execution history for a session
   */
  getToolHistory(sessionId: string) {
    return this.toolEngine.getHistory(sessionId);
  }

  /**
   * List available workflows
   */
  listWorkflows() {
    const { listWorkflowTemplates } = require('../tools/workflows.js');
    return listWorkflowTemplates();
  }

  private async getConversationHistory(sessionId: string): Promise<ChatMessage[]> {
    const messages = await this.messageManager.listMessages(sessionId);
    
    return messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.toolCallId && { toolCallId: m.toolCallId }),
    }));
  }
}
