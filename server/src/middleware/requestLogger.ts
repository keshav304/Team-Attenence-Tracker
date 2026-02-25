/**
 * HTTP request logger middleware.
 *
 * Logs:  route · method · timestamp · userId (if authenticated)
 * Never logs:  passwords · raw tokens · sensitive request bodies
 */

import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Structured logger                                                 */
/* ------------------------------------------------------------------ */

const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'oldPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'apiSecret',
  'clientSecret',
  'ssn',
  'creditCard',
  'cardNumber',
  'cvv',
  'otp',
  'pin',
  'sessionId',
]);

function sanitizeBody(body: unknown): unknown {
  if (body === null || body === undefined) return undefined;
  if (Array.isArray(body)) return body.map(item => sanitizeBody(item));
  if (typeof body === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeBody(value);
      }
    }
    return sanitized;
  }
  return body;
}

export const logger = {
  info(data: Record<string, unknown>): void {
    console.log(
      JSON.stringify({ level: 'info', timestamp: new Date().toISOString(), ...data }),
    );
  },
  warn(data: Record<string, unknown>): void {
    console.warn(
      JSON.stringify({ level: 'warn', timestamp: new Date().toISOString(), ...data }),
    );
  },
  error(data: Record<string, unknown>): void {
    console.error(
      JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), ...data }),
    );
  },
};

/* ------------------------------------------------------------------ */
/*  Quiet routes — suppress logging for high-frequency polling         */
/* ------------------------------------------------------------------ */

const QUIET_ROUTES = new Set([
  '/api/notifications/unread-count',
  '/api/status/today',
]);

/** Suppress logging for high-frequency polling GETs that return 304 */
function isQuietRoute(method: string, path: string, status: number): boolean {
  if (method !== 'GET') return false;
  // Only suppress 304 (not-modified) responses — still log 200/400/500
  if (status !== 304) return false;
  const basePath = path.split('?')[0];
  return QUIET_ROUTES.has(basePath);
}

/* ------------------------------------------------------------------ */
/*  Express middleware                                                 */
/* ------------------------------------------------------------------ */

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    // Skip noisy polling routes
    if (isQuietRoute(req.method, req.originalUrl, res.statusCode)) {
      return;
    }

    const userId = (req as AuthRequest).user?._id?.toString() ?? null;

    // Strip sensitive query parameters from the logged path
    const sanitizePath = (url: string): string => {
      const qIndex = url.indexOf('?');
      if (qIndex === -1) return url;
      const basePath = url.substring(0, qIndex);
      const params = new URLSearchParams(url.substring(qIndex + 1));
      const sensitiveParams = new Set(['token', 'code', 'password', 'reset', 'auth', 'otp', 'secret']);
      for (const key of [...params.keys()]) {
        if (sensitiveParams.has(key.toLowerCase())) {
          params.set(key, '[REDACTED]');
        }
      }
      const remaining = params.toString();
      return remaining ? `${basePath}?${remaining}` : basePath;
    };

    const logEntry: Record<string, unknown> = {
      method: req.method,
      path: sanitizePath(req.originalUrl),
      status: res.statusCode,
      duration: `${duration}ms`,
      userId,
      ip: req.ip,
    };

    // Only log body for non-GET requests, and always sanitize
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
      logEntry.body = sanitizeBody(req.body);
    }

    if (res.statusCode >= 400) {
      logger.warn(logEntry);
    } else {
      logger.info(logEntry);
    }
  });

  next();
}
