/**
 * Global Express error-handling middleware.
 *
 * Catches any error thrown or passed via next(err) and returns a
 * standardized JSON response.  Internal details (stack traces, raw
 * Mongo/JWT errors) are logged server-side but never sent to clients.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../utils/AppError.js';
import { logger } from './requestLogger.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Detect Mongoose validation errors */
function isMongooseValidationError(err: any): boolean {
  return err.name === 'ValidationError' && err.errors !== undefined;
}

/** Detect Mongo duplicate-key error */
function isMongoDuplicateKeyError(err: any): boolean {
  return err.name === 'MongoServerError' && err.code === 11000;
}

/** Detect JWT errors */
function isJwtError(err: any): boolean {
  return (
    err.name === 'JsonWebTokenError' ||
    err.name === 'TokenExpiredError' ||
    err.name === 'NotBeforeError'
  );
}

/* ------------------------------------------------------------------ */
/*  Error handler                                                     */
/* ------------------------------------------------------------------ */

export function globalErrorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // ── AppError (operational) ────────────────────────────────────
  if (err instanceof AppError) {
    logger.error({
      type: 'operational',
      code: err.code,
      message: err.message,
      method: req.method,
      path: req.path,
      userId: (req as any).user?._id?.toString(),
      stack: err.stack,
    });

    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  // ── Mongoose validation error ─────────────────────────────────
  if (isMongooseValidationError(err)) {
    const messages = Object.values((err as any).errors).map(
      (e: any) => e.message,
    );
    logger.error({
      type: 'mongoose_validation',
      message: messages.join('; '),
      method: req.method,
      path: req.path,
    });

    res.status(400).json({
      success: false,
      message: 'Please check your input and try again.',
      code: ErrorCode.VALIDATION_ERROR,
      errors: messages,
    });
    return;
  }

  // ── Mongo duplicate key error ─────────────────────────────────
  if (isMongoDuplicateKeyError(err)) {
    logger.error({
      type: 'mongo_duplicate',
      message: (err as any).message,
      method: req.method,
      path: req.path,
    });

    res.status(409).json({
      success: false,
      message: 'A record with this information already exists.',
      code: ErrorCode.CONFLICT,
    });
    return;
  }

  // ── JWT errors ────────────────────────────────────────────────
  if (isJwtError(err)) {
    const code =
      err.name === 'TokenExpiredError'
        ? ErrorCode.TOKEN_EXPIRED
        : ErrorCode.INVALID_TOKEN;

    const message =
      err.name === 'TokenExpiredError'
        ? 'Session expired. Please login again.'
        : err.name === 'NotBeforeError'
          ? 'Token not yet valid. Please try again later.'
          : 'Invalid token. Please login again.';

    logger.error({
      type: 'jwt',
      jwtErrorName: err.name,
      method: req.method,
      path: req.path,
    });

    res.status(401).json({
      success: false,
      message,
      code,
    });
    return;
  }

  // ── Unknown / programming error ───────────────────────────────
  logger.error({
    type: 'unexpected',
    message: err.message,
    name: err.name,
    method: req.method,
    path: req.path,
    userId: (req as any).user?._id?.toString(),
    stack: err.stack,
  });

  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again later.',
    code: ErrorCode.INTERNAL_ERROR,
  });
}

/* ------------------------------------------------------------------ */
/*  404 catch-all (mounted after all routes)                          */
/* ------------------------------------------------------------------ */

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found.`,
    code: ErrorCode.NOT_FOUND,
  });
}
