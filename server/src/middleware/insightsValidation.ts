import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const insightsQuerySchema = z.object({
  month: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(12)),
  year: z.string().regex(/^\d{4}$/).transform(Number).pipe(z.number().int().min(2000).max(2100)),
});

/* ------------------------------------------------------------------ */
/*  Validation middleware factory                                     */
/* ------------------------------------------------------------------ */

function validateQuery(schema: z.ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
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
    // Attach transformed (numeric) values so controllers don't re-parse
    res.locals.validatedQuery = result.data;
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateInsightsQuery = validateQuery(insightsQuerySchema);
export const validateUserInsightsQuery = validateQuery(insightsQuerySchema);
