import type { Job } from 'bullmq';
import type { MessageJobData, JobResult } from '../types.js';
import type { ChannelRegistry } from '../../channels/registry.js';
import type { ChannelAgentBridge } from '../../channels/bridge.js';
import { logger } from '../../utils/logger.js';

export interface MessageProcessorOptions {
  channelRegistry: ChannelRegistry;
  bridge: ChannelAgentBridge;
}

/**
 * Processor for incoming/outgoing message jobs
 */
export function createMessageProcessor(options: MessageProcessorOptions) {
  return async function processMessage(job: Job<MessageJobData>): Promise<JobResult> {
    const { data } = job;
    const startTime = Date.now();

    logger.info({
      jobId: job.id,
      type: data.type,
      channelId: data.channelId,
      userId: data.userId,
    }, 'Processing message job');

    try {
      if (data.type === 'incoming') {
        // Process incoming message through AI
        return await processIncomingMessage(job, options);
      } else {
        // Process outgoing message (delivery)
        return await processOutgoingMessage(job, options);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ err: error, jobId: job.id }, 'Message processing failed');
      
      return {
        success: false,
        error: errorMessage,
        processingTime: Date.now() - startTime,
      };
    }
  };
}

async function processIncomingMessage(
  job: Job<MessageJobData>,
  options: MessageProcessorOptions
): Promise<JobResult> {
  const { data } = job;
  const startTime = Date.now();

  const adapter = options.channelRegistry.get(data.channelId);
  if (!adapter) {
    throw new Error(`Channel adapter not found: ${data.channelId}`);
  }

  // Process through bridge (which handles AI)
  const result = await options.bridge.processMessage(
    {
      id: data.messageId || job.id!,
      channelType: adapter.type,
      channelId: data.channelId,
      userId: data.userId,
      content: data.content,
      contentType: 'text',
      timestamp: new Date(data.timestamp),
      metadata: data.metadata,
      isGroup: data.metadata?.isGroup as boolean || false,
    },
    adapter
  );

  return {
    success: result.success,
    data: { sessionId: result.sessionId, toolCalls: result.toolCalls },
    error: result.error,
    processingTime: Date.now() - startTime,
  };
}

async function processOutgoingMessage(
  job: Job<MessageJobData>,
  options: MessageProcessorOptions
): Promise<JobResult> {
  const { data } = job;
  const startTime = Date.now();

  const adapter = options.channelRegistry.get(data.channelId);
  if (!adapter) {
    throw new Error(`Channel adapter not found: ${data.channelId}`);
  }

  // Send message through adapter
  const response = await adapter.sendDirectMessage(data.userId, {
    content: data.content,
    contentType: 'text',
    metadata: data.metadata,
  });

  return {
    success: response.success,
    data: { messageId: response.messageId },
    error: response.error,
    processingTime: Date.now() - startTime,
  };
}
