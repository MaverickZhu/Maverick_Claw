import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueService } from './service.js';
import type { Redis } from 'ioredis';

// Mock Redis
const createMockRedis = (): Redis => ({
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue(undefined),
} as unknown as Redis);

describe('QueueService', () => {
  let connection: Redis;
  let service: QueueService;

  beforeEach(() => {
    connection = createMockRedis();
    service = new QueueService({ connection });
  });

  afterEach(async () => {
    await service.close();
  });

  it('should initialize queue', () => {
    const queue = service.initializeQueue({ name: 'test-queue' });
    
    expect(queue).toBeDefined();
    expect(service.getQueue('test-queue')).toBe(queue);
  });

  it('should throw when adding job to non-existent queue', async () => {
    await expect(
      service.addJob('non-existent', { test: 'data' })
    ).rejects.toThrow("Queue 'non-existent' not initialized");
  });

  it('should get queue metrics', async () => {
    service.initializeQueue({ name: 'metrics-test' });
    
    const metrics = await service.getMetrics('metrics-test');
    
    expect(metrics.name).toBe('metrics-test');
    expect(typeof metrics.waiting).toBe('number');
    expect(typeof metrics.active).toBe('number');
    expect(typeof metrics.completed).toBe('number');
    expect(typeof metrics.failed).toBe('number');
    expect(typeof metrics.delayed).toBe('number');
    expect(typeof metrics.paused).toBe('boolean');
  });

  it('should throw when getting metrics for non-existent queue', async () => {
    await expect(
      service.getMetrics('non-existent')
    ).rejects.toThrow("Queue 'non-existent' not found");
  });

  it('should pause and resume queue', async () => {
    service.initializeQueue({ name: 'pause-test' });
    
    await service.pauseQueue('pause-test');
    let metrics = await service.getMetrics('pause-test');
    expect(metrics.paused).toBe(true);
    
    await service.resumeQueue('pause-test');
    metrics = await service.getMetrics('pause-test');
    expect(metrics.paused).toBe(false);
  });

  it('should get all metrics', async () => {
    service.initializeQueue({ name: 'queue-1' });
    service.initializeQueue({ name: 'queue-2' });
    
    const allMetrics = await service.getAllMetrics();
    
    expect(allMetrics).toHaveLength(2);
    expect(allMetrics.map(m => m.name)).toContain('queue-1');
    expect(allMetrics.map(m => m.name)).toContain('queue-2');
  });

  it('should register processor', () => {
    service.initializeQueue({ name: 'processor-test' });
    
    const processor = vi.fn().mockResolvedValue({ success: true });
    const worker = service.registerProcessor('processor-test', processor);
    
    expect(worker).toBeDefined();
    expect(service.getWorker('processor-test')).toBe(worker);
  });

  it('should close all queues and workers', async () => {
    service.initializeQueue({ name: 'close-test' });
    service.registerProcessor('close-test', vi.fn());
    
    await service.close();
    
    expect(service.getQueue('close-test')).toBeUndefined();
    expect(service.getWorker('close-test')).toBeUndefined();
  });
});
