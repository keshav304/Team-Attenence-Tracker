import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD shape check + semantic validity (rejects e.g. 2024-13-45). */
const validDate = z
  .string()
  .regex(DATE_PATTERN, 'Date must be YYYY-MM-DD')
  .refine(
    (val) => {
      const [y, m, d] = val.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return !isNaN(dt.getTime()) && dt.toISOString().startsWith(val);
    },
    { message: 'Date is not a valid calendar date' }
  );

const createHolidaySchema = z.object({
  date: validDate,
  name: z.string().trim().min(1, 'Holiday name is required').max(200),
});

const updateHolidaySchema = z.object({
  date: validDate.optional(),
  name: z.string().trim().min(1).max(200).optional(),
}).refine(
  (d) => d.date !== undefined || d.name !== undefined,
  { message: 'At least one of date or name is required' }
);

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
    req.body = result.data;
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateHoliday = validate(createHolidaySchema);
export const validateUpdateHoliday = validate(updateHolidaySchema);
