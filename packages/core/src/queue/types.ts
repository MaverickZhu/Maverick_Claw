import type { Job, Queue, Worker } from 'bullmq';

export type QueueName = 'messages' | 'ai-processing' | 'notifications' | 'webhook-delivery';

export interface MessageJobData {
  type: 'incoming' | 'outgoing';
  channelId: string;
  userId: string;
  content: string;
  messageId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface AIProcessingJobData {
  sessionId: string;
  messageId: string;
  content: string;
  modelId: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  enableTools?: boolean;
  timestamp: number;
}

export interface NotificationJobData {
  type: 'email' | 'sms' | 'push' | 'webhook';
  recipient: string;
  subject?: string;
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface WebhookDeliveryJobData {
  webhookId: string;
  url: string;
  payload: unknown;
  secret?: string;
  retryCount?: number;
  maxRetries?: number;
  timestamp: number;
}

export type JobData = MessageJobData | AIProcessingJobData | NotificationJobData | WebhookDeliveryJobData;

export interface JobResult {
  success: boolean;
  data?: unknown;
  error?: string;
  processingTime?: number;
}

export interface QueueConfig {
  name: QueueName;
  options?: {
    defaultJobOptions?: {
      attempts?: number;
      backoff?: {
        type: 'fixed' | 'exponential';
        delay: number;
      };
      removeOnComplete?: boolean | number;
      removeOnFail?: boolean | number;
    };
  };
  worker?: {
    concurrency?: number;
    limiter?: {
      max: number;
      duration: number;
    };
  };
}

export interface QueueMetrics {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface IQueueService {
  queues: Map<QueueName, Queue>;
  workers: Map<QueueName, Worker>;
  addJob<T extends JobData>(queueName: QueueName, data: T, options?: { priority?: number; delay?: number }): Promise<Job<T>>;
  getMetrics(queueName: QueueName): Promise<QueueMetrics>;
  pauseQueue(queueName: QueueName): Promise<void>;
  resumeQueue(queueName: QueueName): Promise<void>;
  cleanQueue(queueName: QueueName, status: 'completed' | 'failed', count?: number): Promise<void>;
  close(): Promise<void>;
}
