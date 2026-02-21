import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const chatSchema = z.object({
  question: z.string().trim().min(1, 'Question is required').max(500),
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
    req.body = result.data;
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateChat = validate(chatSchema);
