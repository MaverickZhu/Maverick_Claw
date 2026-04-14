// Queue module exports
export * from './types.js';
export * from './connection.js';
export * from './service.js';
export * from './processors/index.js';

import { QueueService } from './service.js';
import { getQueueConnection } from './connection.js';
import { logger } from '../utils/logger.js';

let globalQueueService: QueueService | null = null;

export function getQueueService(): QueueService {
  if (!globalQueueService) {
    const connection = getQueueConnection();
    globalQueueService = new QueueService({ connection });
    
    // Initialize default queues
    globalQueueService.initializeQueue({
      name: 'messages',
      options: {
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      },
    });

    globalQueueService.initializeQueue({
      name: 'webhook-delivery',
      options: {
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        },
      },
    });

    globalQueueService.initializeQueue({
      name: 'notifications',
      options: {
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 5000 },
        },
      },
    });

    logger.info('Queue service initialized with default queues');
  }
  return globalQueueService;
}

export function getExistingQueueService(): QueueService | null {
  return globalQueueService;
}

export async function closeQueueService(): Promise<void> {
  if (globalQueueService) {
    await globalQueueService.close();
    globalQueueService = null;
  }
}
