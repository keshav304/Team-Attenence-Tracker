import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

const monthlyQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format')
    .refine((val) => {
      const m = Number(val.split('-')[1]);
      return m >= 1 && m <= 12;
    }, 'Invalid month value'),
});

export const validateMonthlyInsightsQuery = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const result = monthlyQuerySchema.safeParse(req.query);
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
  res.locals.validatedQuery = result.data;
  next();
};
