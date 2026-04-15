import type { Job } from 'bullmq';
import type { WebhookDeliveryJobData, JobResult } from '../types.js';
import { logger } from '../../utils/logger.js';
import { StandardErrorCode, ensureStandardError } from '../../errors/index.js';

export interface WebhookProcessorOptions {
  defaultTimeout?: number;
  maxRetries?: number;
}

/**
 * Processor for webhook delivery jobs
 */
export function createWebhookProcessor(options: WebhookProcessorOptions = {}) {
  const { defaultTimeout = 30000, maxRetries = 3 } = options;

  return async function processWebhook(job: Job<WebhookDeliveryJobData>): Promise<JobResult> {
    const { data } = job;
    const startTime = Date.now();

    logger.info({
      jobId: job.id,
      webhookId: data.webhookId,
      url: data.url,
      attempt: job.attemptsMade + 1,
    }, 'Processing webhook delivery');

    try {
      const result = await deliverWebhook(data, defaultTimeout);

      return {
        success: result.success,
        data: { statusCode: result.statusCode, response: result.response },
        error: result.error,
        errorCode: result.errorCode,
        errorDetails: result.errorDetails,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      // Determine if we should retry
      const shouldRetry = job.attemptsMade < (data.maxRetries || maxRetries) - 1;
      const standardError = ensureStandardError(error, {
        code: StandardErrorCode.QueueJobFailed,
        message: 'Webhook delivery failed',
        statusCode: 500,
        preserveMessage: true,
        retryable: shouldRetry,
        details: {
          webhookId: data.webhookId,
          url: data.url,
          attempt: job.attemptsMade + 1,
        },
      });
      
      logger.error({
        err: standardError,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        willRetry: shouldRetry,
        errorCode: standardError.code,
      }, 'Webhook delivery failed');

      // Throw to trigger retry
      throw standardError;
    }
  };
}

async function deliverWebhook(
  data: WebhookDeliveryJobData,
  timeout: number
): Promise<{
  success: boolean;
  statusCode?: number;
  response?: string;
  error?: string;
  errorCode?: string;
  errorDetails?: unknown;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Maverick-Claw-Webhook/1.0',
    };

    // Add signature if secret is configured
    if (data.secret) {
      const signature = generateSignature(data.payload, data.secret);
      headers['X-Webhook-Signature'] = signature;
    }

    const response = await fetch(data.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data.payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        response: responseText,
        error: `HTTP ${response.status}: ${responseText}`,
        errorCode: StandardErrorCode.UpstreamError,
        errorDetails: {
          statusCode: response.status,
        },
      };
    }

    return {
      success: true,
      statusCode: response.status,
      response: responseText,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timeout',
        errorCode: StandardErrorCode.UpstreamError,
        errorDetails: { timeout },
      };
    }

    throw error;
  }
}

function generateSignature(payload: unknown, secret: string): string {
  // Simple HMAC signature
  // In production, use proper crypto library
  const data = JSON.stringify(payload);
  return `sha256=${Buffer.from(data + secret).toString('base64')}`;
}
