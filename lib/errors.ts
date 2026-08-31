/**
 * Central error model. Every API route converts thrown errors into a uniform
 * JSON envelope via `toErrorResponse`. Internal/technical details stay on the
 * server; the client only sees a stable `code` + user-facing `message`.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'EMPLOYEE_NOT_LINKED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'EMPLOYEE_ALREADY_LINKED'
  | 'LINE_ACCOUNT_ALREADY_LINKED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ALREADY_PROCESSED'
  | 'INSUFFICIENT_LEAVE_BALANCE'
  | 'BALANCE_NOT_CONFIGURED'
  | 'BALANCE_DATA_INVALID'
  | 'UNSUPPORTED_EVIDENCE_TYPE'
  | 'EVIDENCE_TOO_LARGE'
  | 'TOO_MANY_EVIDENCE_FILES'
  | 'EVIDENCE_TOTAL_TOO_LARGE'
  | 'EVIDENCE_CONTENT_MISMATCH'
  | 'EVIDENCE_UPLOAD_FAILED'
  | 'OVERLAPPING_LEAVE_REQUEST'
  | 'UNKNOWN_LEAVE_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: ErrorCode;
  /** Message safe to show the end user. */
  readonly userMessage: string;
  /** Extra technical detail kept server-side (never sent to the client). */
  readonly detail?: string;

  constructor(userMessage: string, detail?: string) {
    super(userMessage);
    this.name = this.constructor.name;
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'VALIDATION_ERROR' as const;
  readonly clientDetail?: string;
  constructor(userMessage: string, clientDetail?: string) {
    super(userMessage);
    this.clientDetail = clientDetail;
  }
}
export class AuthenticationError extends AppError {
  readonly status = 401;
  readonly code = 'AUTHENTICATION_ERROR' as const;
}
export class AuthorizationError extends AppError {
  readonly status = 403;
  readonly code = 'AUTHORIZATION_ERROR' as const;
}
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND' as const;
}
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'CONFLICT';
  constructor(userMessage: string, code?: Extract<ErrorCode, 'CONFLICT' | 'ALREADY_PROCESSED' | 'OVERLAPPING_LEAVE_REQUEST'>, detail?: string) {
    super(userMessage, detail);
    if (code) this.code = code;
  }
}
export class PayloadTooLargeError extends AppError {
  readonly status = 413;
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
}
export class UnsupportedMediaTypeError extends AppError {
  readonly status = 415;
  readonly code = 'UNSUPPORTED_MEDIA_TYPE' as const;
}
export class RateLimitError extends AppError {
  readonly status = 429;
  readonly code = 'RATE_LIMITED' as const;
}
export class ExternalServiceError extends AppError {
  readonly status = 502;
  readonly code = 'EXTERNAL_SERVICE_ERROR' as const;
}
export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly code = 'SERVICE_UNAVAILABLE' as const;
}

/** Domain-specific 400s with their own codes. */
export class BusinessRuleError extends AppError {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(code: ErrorCode, userMessage: string, status = 400, detail?: string) {
    super(userMessage, detail);
    this.code = code;
    this.status = status;
  }
}

export interface ErrorEnvelope {
  success: false;
  code: ErrorCode;
  message: string;
  correlationId: string;
  /** Stable, non-sensitive validation reason that a client may act on. */
  detail?: string;
}

/** Convert any thrown value into a safe, uniform error envelope. */
export function toErrorEnvelope(err: unknown, correlationId: string): {
  status: number;
  body: ErrorEnvelope;
  detail?: string;
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        success: false,
        code: err.code,
        message: err.userMessage,
        correlationId,
        ...(err instanceof ValidationError && err.clientDetail ? { detail: err.clientDetail } : {}),
      },
      detail: err.detail,
    };
  }
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    status: 500,
    body: {
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
      correlationId,
    },
    detail,
  };
}
