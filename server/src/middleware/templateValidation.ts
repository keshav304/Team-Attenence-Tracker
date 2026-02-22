import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(100),
  status: z.enum(['office', 'leave']),
  startTime: z.string().regex(TIME_PATTERN, 'Must be HH:mm').optional().nullable(),
  endTime: z.string().regex(TIME_PATTERN, 'Must be HH:mm').optional().nullable(),
  note: z.string().max(500).optional().nullable(),
}).refine(
  (d) => !(d.startTime && d.endTime && d.endTime <= d.startTime),
  { message: 'endTime must be after startTime', path: ['endTime'] }
).refine(
  (d) => !((d.startTime && !d.endTime) || (!d.startTime && d.endTime)),
  { message: 'Both startTime and endTime must be provided together', path: ['startTime'] }
);

const templateIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid template ID'),
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
    req.params = result.data as typeof req.params;
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['office', 'leave']).optional(),
  startTime: z.string().regex(TIME_PATTERN, 'Must be HH:mm').optional().nullable(),
  endTime: z.string().regex(TIME_PATTERN, 'Must be HH:mm').optional().nullable(),
  note: z.string().max(500).optional().nullable(),
}).refine(
  (d) => !(d.startTime && d.endTime && d.endTime <= d.startTime),
  { message: 'endTime must be after startTime', path: ['endTime'] }
);
// Note: the pairing constraint (both startTime and endTime must be present together)
// is enforced in the controller after merging with existing template data, since a
// partial update may only send one of the two fields.

export const validateCreateTemplate = validate(createTemplateSchema);
export const validateUpdateTemplate = validate(updateTemplateSchema);
export const validateTemplateIdParam = validateParams(templateIdParamSchema);
