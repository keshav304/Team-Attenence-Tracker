import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types/index.js';

// Shared helpers


const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM');
const timeStr = z.string().regex(TIME_PATTERN, 'Must be HH:mm 24-hour format');
const statusOL = z.enum(['office', 'leave']);
const statusOLC = z.enum(['office', 'leave', 'clear']);
const leaveDurationEnum = z.enum(['full', 'half']);
const halfDayPortionEnum = z.enum(['first-half', 'second-half']);
const workingPortionEnum = z.enum(['wfh', 'office']);

/** Apply startTime / endTime pair-validation refinements to any schema that
 *  contains optional startTime and endTime fields. */
function withTimeRangeRefinements<
  T extends z.ZodType<{ startTime?: string | null; endTime?: string | null }>,
>(schema: T) {
  return schema
    .refine(
      (d) => !(d.startTime && d.endTime && d.endTime <= d.startTime),
      { message: 'endTime must be after startTime', path: ['endTime'] },
    )
    .refine(
      (d) => !((d.startTime && !d.endTime) || (!d.startTime && d.endTime)),
      { message: 'Both startTime and endTime must be provided together', path: ['startTime'] },
    );
}

/** Apply half-day leave validation refinements. */
function withHalfDayRefinements<
  T extends z.ZodType<{ status?: string; leaveDuration?: string | null; halfDayPortion?: string | null; workingPortion?: string | null }>,
>(schema: T) {
  return schema
    .refine(
      (d) => !(d.leaveDuration && d.status !== 'leave'),
      { message: 'leaveDuration is only allowed when status is leave', path: ['leaveDuration'] },
    )
    .refine(
      (d) => !(d.leaveDuration === 'half' && !d.halfDayPortion),
      { message: 'halfDayPortion is required when leaveDuration is half', path: ['halfDayPortion'] },
    )
    .refine(
      (d) => !(d.workingPortion && d.leaveDuration !== 'half'),
      { message: 'workingPortion is only valid for half-day leave', path: ['workingPortion'] },
    );
}

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

const upsertEntrySchema = withHalfDayRefinements(withTimeRangeRefinements(
  z.object({
    date: dateStr,
    status: statusOL,
    leaveDuration: leaveDurationEnum.optional().nullable(),
    halfDayPortion: halfDayPortionEnum.optional().nullable(),
    workingPortion: workingPortionEnum.optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    startTime: timeStr.optional().nullable(),
    endTime: timeStr.optional().nullable(),
  }),
));

const adminUpsertEntrySchema = withHalfDayRefinements(withTimeRangeRefinements(
  z.object({
    userId: z.string().min(1, 'userId is required').regex(/^[a-f\d]{24}$/i, 'Invalid userId'),
    date: dateStr,
    status: statusOL,
    leaveDuration: leaveDurationEnum.optional().nullable(),
    halfDayPortion: halfDayPortionEnum.optional().nullable(),
    workingPortion: workingPortionEnum.optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    startTime: timeStr.optional().nullable(),
    endTime: timeStr.optional().nullable(),
  }),
));

const bulkSetSchema = withHalfDayRefinements(withTimeRangeRefinements(
  z.object({
    dates: z.array(dateStr).min(1, 'At least one date is required').max(366),
    status: statusOLC,
    leaveDuration: leaveDurationEnum.optional().nullable(),
    halfDayPortion: halfDayPortionEnum.optional().nullable(),
    workingPortion: workingPortionEnum.optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    startTime: timeStr.optional().nullable(),
    endTime: timeStr.optional().nullable(),
  }),
));

const copyFromDateSchema = z.object({
  sourceDate: dateStr,
  targetDates: z.array(dateStr).min(1, 'At least one target date is required').max(366),
});

const repeatPatternSchema = withHalfDayRefinements(withTimeRangeRefinements(
  z.object({
    status: statusOLC,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'At least one day of week is required'),
    startDate: dateStr,
    endDate: dateStr,
    leaveDuration: leaveDurationEnum.optional().nullable(),
    halfDayPortion: halfDayPortionEnum.optional().nullable(),
    workingPortion: workingPortionEnum.optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    startTime: timeStr.optional().nullable(),
    endTime: timeStr.optional().nullable(),
  }),
)).refine(
  (d) => d.endDate >= d.startDate,
  { message: 'endDate must be >= startDate', path: ['endDate'] }
);

const copyRangeSchema = z.object({
  sourceStart: dateStr,
  sourceEnd: dateStr,
  targetStart: dateStr,
}).refine(
  (d) => d.sourceEnd >= d.sourceStart,
  { message: 'sourceEnd must be >= sourceStart', path: ['sourceEnd'] }
);

const deleteEntryParamsSchema = z.object({
  date: dateStr,
});

const adminDeleteEntryParamsSchema = z.object({
  userId: z.string().min(1, 'userId is required').regex(/^[a-f\d]{24}$/i, 'Invalid userId'),
  date: dateStr,
});

const getMyEntriesQuerySchema = z.object({
  startDate: dateStr,
  endDate: dateStr,
}).refine(
  (d) => d.endDate >= d.startDate,
  { message: 'endDate must be >= startDate', path: ['endDate'] }
);

const teamQuerySchema = z.object({
  month: monthStr,
});

/* ------------------------------------------------------------------ */
/*  Validation middleware factories                                   */
/* ------------------------------------------------------------------ */

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
    req.query = result.data as typeof req.query;
    next();
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

// Body validators
export const validateUpsertEntry = validateBody(upsertEntrySchema);
export const validateAdminUpsertEntry = validateBody(adminUpsertEntrySchema);
export const validateBulkSet = validateBody(bulkSetSchema);
export const validateCopyFromDate = validateBody(copyFromDateSchema);
export const validateRepeatPattern = validateBody(repeatPatternSchema);
export const validateCopyRange = validateBody(copyRangeSchema);

// Params validators
export const validateDeleteEntry = validateParams(deleteEntryParamsSchema);
export const validateAdminDeleteEntry = validateParams(adminDeleteEntryParamsSchema);

// Query validators
export const validateGetMyEntries = validateQuery(getMyEntriesQuerySchema);
export const validateTeamQuery = validateQuery(teamQuerySchema);
