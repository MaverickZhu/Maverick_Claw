import { Queue, Worker, type Job, type QueueOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';
import { reportError } from '../monitoring/error-tracking.js';
import type {
  QueueName,
  JobData,
  JobResult,
  QueueMetrics,
  QueueConfig,
} from './types.js';

export interface QueueServiceOptions {
  connection: Redis;
  prefix?: string;
  onJobComplete?: (job: Job, result: JobResult) => void;
  onJobFailed?: (job: Job, error: Error) => void;
}

/**
 * Queue Service for managing BullMQ queues and workers
 */
export class QueueService {
  private connection: Redis;
  private prefix: string;
  private queues = new Map<QueueName, Queue>();
  private workers = new Map<QueueName, Worker>();
  private processors = new Map<QueueName, (job: Job) => Promise<JobResult>>();
  private onJobComplete?: (job: Job, result: JobResult) => void;
  private onJobFailed?: (job: Job, error: Error) => void;

  constructor(options: QueueServiceOptions) {
    this.connection = options.connection;
    this.prefix = options.prefix || 'maverick';
    this.onJobComplete = options.onJobComplete;
    this.onJobFailed = options.onJobFailed;
  }

  /**
   * Initialize a queue with configuration
   */
  initializeQueue(config: QueueConfig): Queue {
    const { name, options = {} } = config;

    // Create queue
    const queue = new Queue(name, {
      connection: this.connection,
      prefix: this.prefix,
      ...options,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        ...options.defaultJobOptions,
      },
    });

    this.queues.set(name, queue);
    logger.info({ queue: name }, 'Queue initialized');

    return queue;
  }

  /**
   * Register a processor for a queue
   */
  registerProcessor(
    queueName: QueueName,
    processor: (job: Job) => Promise<JobResult>,
    workerOptions?: { concurrency?: number }
  ): Worker {
    // Store processor for potential reuse
    this.processors.set(queueName, processor);

    // Create worker
    const worker = new Worker(
      queueName,
      async (job: Job) => {
        const startTime = Date.now();
        logger.debug({ jobId: job.id, queue: queueName }, 'Processing job');

        try {
          const result = await processor(job);
          const processingTime = Date.now() - startTime;

          logger.info({
            jobId: job.id,
            queue: queueName,
            processingTime,
            success: result.success,
          }, 'Job completed');

          return { ...result, processingTime };
        } catch (error) {
          const processingTime = Date.now() - startTime;
          reportError(error, {
            area: 'queue.job',
            tags: {
              queue: queueName,
            },
            extra: {
              jobId: job.id,
              processingTime,
            },
          });
          logger.error({
            err: error,
            jobId: job.id,
            queue: queueName,
            processingTime,
          }, 'Job failed');
          throw error;
        }
      },
      {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: workerOptions?.concurrency || 5,
      }
    );

    // Handle completion
    worker.on('completed', (job, result) => {
      this.onJobComplete?.(job, result as JobResult);
    });

    // Handle failure
    worker.on('failed', (job, error) => {
      if (job) {
        this.onJobFailed?.(job, error);
      }
    });

    this.workers.set(queueName, worker);
    logger.info({ queue: queueName, concurrency: workerOptions?.concurrency || 5 }, 'Worker registered');

    return worker;
  }

  /**
   * Add a job to a queue
   */
  async addJob<T extends JobData>(
    queueName: QueueName,
    data: T,
    options?: {
      priority?: number;
      delay?: number;
      jobId?: string;
      attempts?: number;
    }
  ): Promise<Job<T>> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not initialized`);
    }

    const job = await queue.add(queueName, data, {
      priority: options?.priority,
      delay: options?.delay,
      jobId: options?.jobId,
      attempts: options?.attempts,
    });

    logger.debug({ jobId: job.id, queue: queueName }, 'Job added to queue');
    return job as Job<T>;
  }

  /**
   * Get queue metrics
   */
  async getMetrics(queueName: QueueName): Promise<QueueMetrics> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.isPaused(),
    ]);

    return {
      name: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
    };
  }

  /**
   * Get all queue metrics
   */
  async getAllMetrics(): Promise<QueueMetrics[]> {
    const promises = Array.from(this.queues.keys()).map((name) =>
      this.getMetrics(name).catch((err) => ({
        name,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
        error: err.message,
      }))
    );

    return Promise.all(promises as Promise<QueueMetrics>[]);
  }

  /**
   * Pause a queue (stop processing new jobs)
   */
  async pauseQueue(queueName: QueueName): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.pause();
    logger.info({ queue: queueName }, 'Queue paused');
  }

  /**
   * Resume a paused queue
   */
  async resumeQueue(queueName: QueueName): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.resume();
    logger.info({ queue: queueName }, 'Queue resumed');
  }

  /**
   * Clean completed or failed jobs from a queue
   */
  async cleanQueue(
    queueName: QueueName,
    status: 'completed' | 'failed' | 'wait' | 'active' | 'delayed' | 'paused',
    count: number = 100
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.clean(0, count, status);
    logger.info({ queue: queueName, status, count }, 'Queue cleaned');
  }

  /**
   * Get job by ID
   */
  async getJob(queueName: QueueName, jobId: string): Promise<Job | undefined> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    return queue.getJob(jobId);
  }

  /**
   * Close all queues and workers
   */
  async close(): Promise<void> {
    // Close all workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.debug({ worker: name }, 'Worker closed');
    }
    this.workers.clear();

    // Close all queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.debug({ queue: name }, 'Queue closed');
    }
    this.queues.clear();

    logger.info('Queue service closed');
  }

  /**
   * Get a queue instance
   */
  getQueue(name: QueueName): Queue | undefined {
    return this.queues.get(name);
  }

  /**
   * Get a worker instance
   */
  getWorker(name: QueueName): Worker | undefined {
    return this.workers.get(name);
  }
}
