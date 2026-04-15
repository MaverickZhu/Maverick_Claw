export const StandardErrorCode = {
  InvalidRequest: 'invalid_request',
  ValidationFailed: 'validation_failed',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'conflict',
  QueueNotInitialized: 'queue_not_initialized',
  QueueNotFound: 'queue_not_found',
  QueueJobFailed: 'queue_job_failed',
  QueueJobResultError: 'queue_job_result_error',
  UpstreamError: 'upstream_error',
  MethodNotFound: 'method_not_found',
  InternalError: 'internal_error',
} as const;

export type StandardErrorCodeValue =
  (typeof StandardErrorCode)[keyof typeof StandardErrorCode];

export interface StandardErrorOptions {
  code: StandardErrorCodeValue;
  message: string;
  statusCode?: number;
  details?: unknown;
  retryable?: boolean;
  cause?: unknown;
}

export interface StandardizedGatewayError {
  code: string;
  message: string;
  details?: unknown;
}

export interface StandardizedHttpErrorBody {
  error: string;
  errorCode: string;
  requestId?: string;
  details?: unknown;
}

export class StandardError extends Error {
  readonly code: StandardErrorCodeValue;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(options: StandardErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'StandardError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

interface EnsureErrorFallback {
  code: StandardErrorCodeValue;
  message: string;
  statusCode?: number;
  details?: unknown;
  retryable?: boolean;
  preserveMessage?: boolean;
}

export function ensureStandardError(
  error: unknown,
  fallback: EnsureErrorFallback
): StandardError {
  if (error instanceof StandardError) {
    return error;
  }

  const message =
    fallback.preserveMessage && error instanceof Error
      ? error.message
      : fallback.message;

  return new StandardError({
    code: fallback.code,
    message,
    statusCode: fallback.statusCode,
    details: fallback.details,
    retryable: fallback.retryable,
    cause: error,
  });
}

export function createValidationError(message: string, details?: unknown): StandardError {
  return new StandardError({
    code: StandardErrorCode.ValidationFailed,
    message,
    statusCode: 400,
    details,
  });
}

export function createBadRequestError(message: string, details?: unknown): StandardError {
  return new StandardError({
    code: StandardErrorCode.InvalidRequest,
    message,
    statusCode: 400,
    details,
  });
}

export function createUnauthorizedError(message: string): StandardError {
  return new StandardError({
    code: StandardErrorCode.Unauthorized,
    message,
    statusCode: 401,
  });
}

export function createForbiddenError(message: string): StandardError {
  return new StandardError({
    code: StandardErrorCode.Forbidden,
    message,
    statusCode: 403,
  });
}

export function createNotFoundError(message: string, details?: unknown): StandardError {
  return new StandardError({
    code: StandardErrorCode.NotFound,
    message,
    statusCode: 404,
    details,
  });
}

export function createMethodNotFoundError(method: string): StandardError {
  return new StandardError({
    code: StandardErrorCode.MethodNotFound,
    message: `Unknown method: ${method}`,
    statusCode: 404,
    details: { method },
  });
}

export function createQueueNotFoundError(queueName: string): StandardError {
  return new StandardError({
    code: StandardErrorCode.QueueNotFound,
    message: `Queue '${queueName}' not found`,
    statusCode: 404,
    details: { queueName },
  });
}

export function createQueueNotInitializedError(queueName: string): StandardError {
  return new StandardError({
    code: StandardErrorCode.QueueNotInitialized,
    message: `Queue '${queueName}' not initialized`,
    statusCode: 400,
    details: { queueName },
  });
}

export function toHttpErrorBody(
  error: StandardError,
  requestId?: string
): StandardizedHttpErrorBody {
  return {
    error: error.message,
    errorCode: error.code,
    requestId,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

export function toGatewayErrorDetail(error: StandardError): StandardizedGatewayError {
  return {
    code: error.code,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}
