import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  role: z.enum(['member', 'admin']).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['member', 'admin']).optional(),
  isActive: z.boolean().optional(),
}).refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field to update is required' }
);

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

const userIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user ID'),
});

/* ------------------------------------------------------------------ */
/*  Validation middleware factories                                   */
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

function validateParams(schema: z.ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
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
    Object.assign(req.params, result.data);
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateUser = validate(createUserSchema);
export const validateUpdateUser = validate(updateUserSchema);
export const validateResetPassword = validate(resetPasswordSchema);
export const validateUserIdParam = validateParams(userIdParamSchema);
