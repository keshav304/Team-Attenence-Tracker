import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateStr = z
  .string()
  .regex(DATE_PATTERN, 'Must be YYYY-MM-DD')
  .refine(
    (v) => {
      const [y, m, d] = v.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    },
    { message: 'Invalid calendar date' },
  );

const objectIdStr = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid ObjectId');

/* ── Schemas ──────────────────────────────────── */

const matchPreviewSchema = z
  .object({
    favoriteUserId: objectIdStr,
    startDate: dateStr,
    endDate: dateStr,
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be >= startDate',
    path: ['endDate'],
  });

const matchApplySchema = z
  .object({
    favoriteUserId: objectIdStr,
    dates: z
      .array(dateStr)
      .min(1, 'At least one date is required')
      .max(366, 'Cannot exceed 366 dates'),
    overrideLeave: z.boolean().optional().default(false),
  });

/* ── Middleware factory ───────────────────────── */

function validateBody(schema: z.ZodSchema) {
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
    req.body = result.data;
    next();
  };
}

/* ── Exports ──────────────────────────────────── */

export const validateMatchPreviewInput = validateBody(matchPreviewSchema);
export const validateMatchApplyInput = validateBody(matchApplySchema);
