import type { ChannelAdapter, ChannelMessage, SendMessageOptions } from './types.js';
import type { ChannelSessionManager } from './session-manager.js';
import type { MessageManager } from '../storage/message.js';
import type { ModelProvider } from '../agent/model.js';
import { ToolAgent } from '../agent/tool-agent.js';
import { logger } from '../utils/logger.js';

export interface ChannelAgentBridgeOptions {
  messageManager: MessageManager;
  channelSessionManager: ChannelSessionManager;
  modelProvider: ModelProvider;
  modelId: string;
  systemPrompt?: string;
}

export interface ProcessMessageResult {
  success: boolean;
  response?: string;
  sessionId: string;
  error?: string;
  toolCalls?: number;
}

/**
 * Bridges channel messages with AI Agent
 * 
 * This class handles:
 * 1. Receiving messages from channel adapters
 * 2. Mapping to internal sessions
 * 3. Processing through ToolAgent
 * 4. Sending responses back to channel
 */
export class ChannelAgentBridge {
  private messageManager: MessageManager;
  private channelSessionManager: ChannelSessionManager;
  private toolAgent: ToolAgent;
  private modelId: string;

  constructor(options: ChannelAgentBridgeOptions) {
    this.messageManager = options.messageManager;
    this.channelSessionManager = options.channelSessionManager;
    this.modelId = options.modelId;

    // Create ToolAgent instance
    this.toolAgent = new ToolAgent({
      provider: options.modelProvider,
      model: this.modelId.split(':')[1] || this.modelId, // Extract model name from provider:model
      systemPrompt: options.systemPrompt || this.defaultSystemPrompt(),
      temperature: 0.7,
      maxToolIterations: 5,
    });
  }

  /**
   * Process incoming channel message and send response
   */
  async processMessage(
    message: ChannelMessage,
    adapter: ChannelAdapter
  ): Promise<ProcessMessageResult> {
    const startTime = Date.now();
    
    try {
      // Get or create session for this channel user
      const { sessionId, isNew } = await this.channelSessionManager.getOrCreateSession(
        message.channelId,
        message.userId,
        message.userName
      );

      logger.info({ 
        sessionId, 
        isNew, 
        channelId: message.channelId,
        userId: message.userId,
        content: message.content.substring(0, 100)
      }, 'Processing channel message');

      // Save user message to session
      await this.messageManager.createMessage({
        sessionId,
        role: 'user',
        content: message.content,
        metadata: {
          channelId: message.channelId,
          channelMessageId: message.id,
          isGroup: message.isGroup,
          groupId: message.groupId,
        },
      });

      // Get conversation history
      const history = await this.messageManager.listMessages(sessionId, { limit: 20 });
      
      // Format messages for agent
      const messages = history.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      // Process through ToolAgent
      const agentResponse = await this.toolAgent.chat(messages, {
        sessionId,
        userId: message.userId,
      });

      // Save assistant response
      if (agentResponse.content) {
        await this.messageManager.createMessage({
          sessionId,
          role: 'assistant',
          content: agentResponse.content,
          metadata: {
            modelId: this.modelId,
            toolCalls: agentResponse.toolCalls.length,
            usage: agentResponse.usage,
          },
        });
      }

      // Send response back to channel
      if (agentResponse.content) {
        const sendResult = await this.sendResponse(adapter, message, agentResponse.content);
        
        if (!sendResult.success) {
          logger.error({ 
            sessionId, 
            error: sendResult.error 
          }, 'Failed to send response to channel');
        }
      }

      // Update session activity
      this.channelSessionManager.touchSession(message.channelId, message.userId);

      const duration = Date.now() - startTime;
      logger.info({ 
        sessionId, 
        duration,
        toolCalls: agentResponse.toolCalls.length,
        responseLength: agentResponse.content?.length 
      }, 'Channel message processed');

      return {
        success: true,
        response: agentResponse.content,
        sessionId,
        toolCalls: agentResponse.toolCalls.length,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ 
        err: error, 
        channelId: message.channelId,
        userId: message.userId 
      }, 'Failed to process channel message');

      // Try to send error message to user
      try {
        await this.sendResponse(
          adapter, 
          message, 
          '抱歉，处理消息时出现了错误，请稍后重试。'
        );
      } catch {
        // Ignore send error
      }

      return {
        success: false,
        error: errorMessage,
        sessionId: '',
      };
    }
  }

  /**
   * Process message with streaming response
   */
  async *streamProcessMessage(
    message: ChannelMessage,
    adapter: ChannelAdapter
  ): AsyncGenerator<{ type: 'chunk'; content: string } | { type: 'complete'; result: ProcessMessageResult }> {
    const startTime = Date.now();
    
    try {
      // Get or create session
      const { sessionId } = await this.channelSessionManager.getOrCreateSession(
        message.channelId,
        message.userId,
        message.userName
      );

      // Save user message
      await this.messageManager.createMessage({
        sessionId,
        role: 'user',
        content: message.content,
      });

      // Get history
      const history = await this.messageManager.listMessages(sessionId, { limit: 20 });
      const messages = history.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      // Stream through ToolAgent
      let fullResponse = '';
      let toolCallCount = 0;

      for await (const chunk of this.toolAgent.streamChat(messages, { sessionId })) {
        if ('type' in chunk) {
          if (chunk.type === 'tool_calls') {
            toolCallCount += chunk.calls.length;
          }
          // Yield tool events for logging/monitoring
          yield { type: 'chunk', content: '' };
        } else {
          // Regular content chunk
          if (chunk.content) {
            fullResponse += chunk.content;
            yield { type: 'chunk', content: chunk.content };
          }

          if (chunk.done) {
            break;
          }
        }
      }

      // Save complete response
      if (fullResponse) {
        await this.messageManager.createMessage({
          sessionId,
          role: 'assistant',
          content: fullResponse,
          metadata: {
            modelId: this.modelId,
            toolCalls: toolCallCount,
          },
        });
      }

      // Send complete response to channel
      await this.sendResponse(adapter, message, fullResponse);

      // Update activity
      this.channelSessionManager.touchSession(message.channelId, message.userId);

      const duration = Date.now() - startTime;
      logger.info({ sessionId, duration, toolCalls: toolCallCount }, 'Stream processing complete');

      yield {
        type: 'complete',
        result: {
          success: true,
          response: fullResponse,
          sessionId,
          toolCalls: toolCallCount,
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ err: error }, 'Stream processing failed');

      yield {
        type: 'complete',
        result: {
          success: false,
          error: errorMessage,
          sessionId: '',
        },
      };
    }
  }

  /**
   * Send response back to channel
   */
  private async sendResponse(
    adapter: ChannelAdapter,
    originalMessage: ChannelMessage,
    response: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // If it's a group message, reply to the specific message
      if (originalMessage.isGroup && originalMessage.groupId) {
        const result = await adapter.replyToMessage(
          originalMessage.id,
          originalMessage.groupId,
          {
            content: response,
            contentType: 'text',
          }
        );
        return { success: result.success, error: result.error };
      } else {
        // Direct message
        const result = await adapter.sendDirectMessage(originalMessage.userId, {
          content: response,
          contentType: 'text',
        });
        return { success: result.success, error: result.error };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Send failed',
      };
    }
  }

  private defaultSystemPrompt(): string {
    return `You are a helpful AI assistant integrated into a multi-channel messaging platform.

You can use tools to help answer user questions:
- datetime: Get current date and time
- calculator: Perform mathematical calculations

Guidelines:
1. Be concise and helpful
2. Use tools when appropriate
3. If you don't know something, say so
4. Keep responses appropriate for chat format
5. Respond in the same language as the user's message`;
  }
}
