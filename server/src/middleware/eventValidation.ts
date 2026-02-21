import { Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { AuthRequest } from '../types/index.js';
import { EVENT_TYPES } from '../models/Event.js';

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

const createEventSchema = z.object({
  date: validDate,
  title: z.string().trim().min(1, 'Title is required').max(150),
  description: z.string().trim().max(500).optional(),
  eventType: z.enum(EVENT_TYPES, {
    message: `Event type must be one of: ${EVENT_TYPES.join(', ')}`,
  }).optional(),
});

/** Transform that converts empty / whitespace-only strings to undefined. */
const emptyToUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

const updateEventSchema = z
  .object({
    date: validDate.optional(),
    title: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(150).optional()),
    description: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
    eventType: z.preprocess(emptyToUndefined, z.enum(EVENT_TYPES, {
      message: `Event type must be one of: ${EVENT_TYPES.join(', ')}`,
    }).optional()),
  })
  .refine(
    (d) =>
      d.date !== undefined ||
      d.title !== undefined ||
      d.description !== undefined ||
      d.eventType !== undefined,
    { message: 'At least one field is required' }
  );

/* ------------------------------------------------------------------ */
/*  Validation middleware factory                                     */
/* ------------------------------------------------------------------ */

function validate(schema: z.ZodSchema) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues.map(
        (i) => i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message
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

export const validateCreateEvent = validate(createEventSchema);
export const validateUpdateEvent = validate(updateEventSchema);

/** Validate that :id param is a valid MongoDB ObjectId. */
export const validateEventId = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const { id } = req.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({
      success: false,
      message: 'Invalid event ID format',
    });
    return;
  }
  next();
};
