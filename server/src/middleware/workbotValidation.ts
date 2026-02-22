import { Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const MAX_NOTE_LENGTH = 1000;

const parseSchema = z.object({
  command: z.string().min(1).max(1000),
});

const scheduleActionSchema = z.object({
  type: z.enum(['set', 'clear']),
  status: z.enum(['office', 'leave']).optional(),
  dateExpressions: z.array(z.string().min(1)).min(1),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});

const resolveSchema = z.object({
  actions: z.array(scheduleActionSchema).min(1).max(50),
});

const applyItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine(
    (val) => {
      const [y, m, d] = val.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    },
    { message: 'Date must be a valid calendar date' }
  ),
  status: z.enum(['office', 'leave', 'clear']),
  leaveDuration: z.enum(['full', 'half']).optional(),
  halfDayPortion: z.enum(['first-half', 'second-half']).optional(),
  workingPortion: z.enum(['wfh', 'office']).optional(),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'leave') {
    if (data.leaveDuration === 'half' && !data.halfDayPortion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['halfDayPortion'],
        message: 'halfDayPortion is required when leaveDuration is "half"',
      });
    }
    if (data.leaveDuration !== 'half' && data.halfDayPortion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['halfDayPortion'],
        message: 'halfDayPortion is only allowed when leaveDuration is "half"',
      });
    }
    if (data.leaveDuration !== 'half' && data.workingPortion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workingPortion'],
        message: 'workingPortion is only allowed when leaveDuration is "half"',
      });
    }
  } else {
    // status is 'office' or 'clear' — no leave fields allowed
    if (data.leaveDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leaveDuration'],
        message: 'leaveDuration is only allowed when status is "leave"',
      });
    }
    if (data.halfDayPortion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['halfDayPortion'],
        message: 'halfDayPortion is only allowed when status is "leave"',
      });
    }
    if (data.workingPortion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workingPortion'],
        message: 'workingPortion is only allowed when status is "leave"',
      });
    }
  }
});

const applySchema = z.object({
  changes: z.array(applyItemSchema).min(1).max(100),
});

/* ------------------------------------------------------------------ */
/*  Validation middleware factory                                     */
/* ------------------------------------------------------------------ */

function validate(schema: z.ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages,
      });
      return;
    }
    // Replace body with parsed (cleaned) data
    req.body = result.data;
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exported middleware                                                */
/* ------------------------------------------------------------------ */

export const validateParse = validate(parseSchema);
export const validateResolve = validate(resolveSchema);
export const validateApply = validate(applySchema);

/**
 * Rate limiter for the destructive /apply endpoint.
 * 10 requests per minute per user (keyed by authenticated user id).
 * Auth middleware must run before this — keyGenerator requires user._id.
 */
export const applyRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).user?._id?.toString();
    if (!userId) {
      throw new Error('applyRateLimiter: missing authenticated user — ensure auth middleware runs first');
    }
    return userId;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many apply requests. Please wait a minute before trying again.',
  },
});
