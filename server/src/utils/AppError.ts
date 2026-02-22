/**
 * Centralized application error class.
 *
 * Throw AppError anywhere in a controller or middleware and the global
 * error handler will format it into the standardized API response:
 *   { success: false, message: "...", code: "ERROR_CODE" }
 *
 * Only `message` is sent to the client.  Stack traces and raw internal
 * details are logged server-side only.
 */

/* ------------------------------------------------------------------ */
/*  Error codes                                                       */
/* ------------------------------------------------------------------ */

export const ErrorCode = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Resource
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // Business logic
  DATE_LOCKED: 'DATE_LOCKED',
  DATE_NOT_ALLOWED: 'DATE_NOT_ALLOWED',
  SELF_REFERENCE: 'SELF_REFERENCE',

  // External services
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Generic
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/* ------------------------------------------------------------------ */
/*  User-friendly default messages per code                           */
/* ------------------------------------------------------------------ */

const defaultMessages: Record<ErrorCodeType, string> = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
  INVALID_TOKEN: 'Session expired. Please login again.',
  TOKEN_EXPIRED: 'Session expired. Please login again.',
  FORBIDDEN: "You don't have permission to perform this action.",
  UNAUTHORIZED: 'Authentication is required.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'A conflict occurred with the current state.',
  DATE_LOCKED: 'This date can no longer be modified.',
  DATE_NOT_ALLOWED: 'This date is outside the allowed planning window.',
  SELF_REFERENCE: 'You cannot reference yourself for this action.',
  AI_UNAVAILABLE: 'AI assistant is temporarily unavailable.',
  SERVICE_UNAVAILABLE: 'Service is temporarily unavailable. Please try again later.',
  BAD_REQUEST: 'The request could not be processed.',
  INTERNAL_ERROR: 'Something went wrong. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  UNPROCESSABLE_ENTITY: 'The request could not be processed.',
};

/* ------------------------------------------------------------------ */
/*  AppError class                                                    */
/* ------------------------------------------------------------------ */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCodeType;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: ErrorCodeType,
    message?: string,
    isOperational = true,
  ) {
    super(message || defaultMessages[code] || 'An unexpected error occurred.');
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    // Capture proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience factory helpers                                       */
/* ------------------------------------------------------------------ */

export const Errors = {
  invalidCredentials: (msg?: string) =>
    new AppError(401, ErrorCode.INVALID_CREDENTIALS, msg),

  emailExists: (msg?: string) =>
    new AppError(409, ErrorCode.EMAIL_ALREADY_EXISTS, msg),

  invalidToken: (msg?: string) =>
    new AppError(401, ErrorCode.INVALID_TOKEN, msg),

  tokenExpired: (msg?: string) =>
    new AppError(401, ErrorCode.TOKEN_EXPIRED, msg),

  forbidden: (msg?: string) =>
    new AppError(403, ErrorCode.FORBIDDEN, msg),

  unauthorized: (msg?: string) =>
    new AppError(401, ErrorCode.UNAUTHORIZED, msg),

  validation: (msg?: string) =>
    new AppError(400, ErrorCode.VALIDATION_ERROR, msg),

  notFound: (msg?: string) =>
    new AppError(404, ErrorCode.NOT_FOUND, msg),

  conflict: (msg?: string) =>
    new AppError(409, ErrorCode.CONFLICT, msg),

  dateLocked: (msg?: string) =>
    new AppError(403, ErrorCode.DATE_LOCKED, msg),

  dateNotAllowed: (msg?: string) =>
    new AppError(403, ErrorCode.DATE_NOT_ALLOWED, msg),

  selfReference: (msg?: string) =>
    new AppError(400, ErrorCode.SELF_REFERENCE, msg),

  aiUnavailable: (msg?: string) =>
    new AppError(503, ErrorCode.AI_UNAVAILABLE, msg),

  serviceUnavailable: (msg?: string) =>
    new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, msg),

  badRequest: (msg?: string) =>
    new AppError(400, ErrorCode.BAD_REQUEST, msg),

  internal: (msg?: string) =>
    new AppError(500, ErrorCode.INTERNAL_ERROR, msg, false),

  rateLimited: (msg?: string) =>
    new AppError(429, ErrorCode.RATE_LIMITED, msg),

  unprocessableEntity: (msg?: string) =>
    new AppError(422, ErrorCode.UNPROCESSABLE_ENTITY, msg),
};
