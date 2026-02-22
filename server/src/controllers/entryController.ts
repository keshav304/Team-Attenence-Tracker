import { Response } from 'express';
import mongoose from 'mongoose';
import Entry from '../models/Entry.js';
import User from '../models/User.js';
import { AuthRequest } from '../types/index.js';
import {
  isMemberAllowedDate,
  getMonthRange,
  getTodayString,
  getFutureDateString,
  toISTDateString,
} from '../utils/date.js';
import { sanitizeText } from '../utils/sanitize.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Maximum number of target dates in copy/bulk operations. */
const MAX_DATES = 366;
/** Maximum source range span in days for copy-range. */
const MAX_RANGE_DAYS = 90;

/**
 * Build a Mongo update operator from validated entry fields.
 * Moves empty/null startTime and note into $unset so the DB fields are removed.
 */
const buildUpdateOp = (
  updateData: Record<string, unknown>,
  startTime: string | null | undefined,
  note: string | null | undefined,
  leaveDuration?: string | null,
  halfDayPortion?: string | null,
  workingPortion?: string | null,
): Record<string, unknown> => {
  const unsetFields: Record<string, 1> = {};
  if (startTime === '' || startTime === null) {
    unsetFields.startTime = 1;
    unsetFields.endTime = 1;
    delete updateData.startTime;
    delete updateData.endTime;
  }
  if (note === '' || note === null) {
    unsetFields.note = 1;
    delete updateData.note;
  }
  // Handle half-day leave fields
  if (!leaveDuration || leaveDuration !== 'half') {
    unsetFields.leaveDuration = 1;
    unsetFields.halfDayPortion = 1;
    unsetFields.workingPortion = 1;
    delete updateData.leaveDuration;
    delete updateData.halfDayPortion;
    delete updateData.workingPortion;
  } else {
    // leaveDuration === 'half'
    if (!halfDayPortion) {
      unsetFields.halfDayPortion = 1;
      delete updateData.halfDayPortion;
    }
    if (!workingPortion) {
      // Default working portion to 'wfh'
      updateData.workingPortion = 'wfh';
    }
  }
  const op: Record<string, unknown> = { $set: updateData };
  if (Object.keys(unsetFields).length) op.$unset = unsetFields;
  return op;
};

/** Validate and sanitise the optional time window. Returns error message or null. */
const validateTimeWindow = (
  startTime?: string,
  endTime?: string
): string | null => {
  if (!startTime && !endTime) return null;
  if ((startTime && !endTime) || (!startTime && endTime)) {
    return 'Both startTime and endTime must be provided together';
  }
  if (!TIME_RE.test(startTime!)) return 'startTime must be in HH:mm 24-hour format';
  if (!TIME_RE.test(endTime!)) return 'endTime must be in HH:mm 24-hour format';
  if (endTime! <= startTime!) return 'endTime must be after startTime';
  return null;
};

/**
 * Set or update a day's status (office or leave), with optional time window & note.
 * PUT /api/entries
 * Body: { date, status, note?, startTime?, endTime? }
 */
export const upsertEntry = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { date, status, note, startTime, endTime, leaveDuration, halfDayPortion, workingPortion } = req.body;
    const userId = req.user!._id;
    const isAdmin = req.user!.role === 'admin';

    // Validate status
    if (!['office', 'leave'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Status must be "office" or "leave"',
      });
      return;
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        message: 'Date must be in YYYY-MM-DD format',
      });
      return;
    }

    // Members can only edit dates within current month start → today + 90 days
    if (!isAdmin && !isMemberAllowedDate(date)) {
      res.status(403).json({
        success: false,
        message: 'You can only edit dates within the current month and up to 90 days ahead',
      });
      return;
    }

    // Validate time window
    const timeErr = validateTimeWindow(startTime, endTime);
    if (timeErr) {
      res.status(400).json({ success: false, message: timeErr });
      return;
    }

    // Validate note length
    if (note && note.length > 500) {
      res.status(400).json({ success: false, message: 'Note cannot exceed 500 characters' });
      return;
    }

    const updateData: Record<string, unknown> = {
      userId,
      date,
      status,
      leaveDuration: (status === 'leave' && leaveDuration) ? leaveDuration : undefined,
      halfDayPortion: (status === 'leave' && leaveDuration === 'half' && halfDayPortion) ? halfDayPortion : undefined,
      workingPortion: (status === 'leave' && leaveDuration === 'half') ? (workingPortion || 'wfh') : undefined,
      note: note ? sanitizeText(note) : undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
    };

    const updateOp = buildUpdateOp(updateData, startTime, note, leaveDuration, halfDayPortion, workingPortion);

    const entry = await Entry.findOneAndUpdate(
      { userId, date },
      updateOp,
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, data: entry });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'Duplicate entry' });
      return;
    }
    console.error('upsertEntry error:', error);
    res.status(500).json({ success: false, message: 'Failed to update entry' });
  }
};

/**
 * Admin sets/updates entry for another user.
 * PUT /api/entries/admin
 * Body: { userId, date, status, note?, startTime?, endTime?, leaveDuration?, halfDayPortion?, workingPortion? }
 */
export const adminUpsertEntry = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { userId, date, status, note, startTime, endTime, leaveDuration, halfDayPortion, workingPortion } = req.body;

    if (!['office', 'leave'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Status must be "office" or "leave"',
      });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        message: 'Date must be in YYYY-MM-DD format',
      });
      return;
    }

    // Validate time window
    const timeErr = validateTimeWindow(startTime, endTime);
    if (timeErr) {
      res.status(400).json({ success: false, message: timeErr });
      return;
    }

    if (note && note.length > 500) {
      res.status(400).json({ success: false, message: 'Note cannot exceed 500 characters' });
      return;
    }

    // Verify target user exists
    if (!mongoose.isValidObjectId(userId)) {
      res.status(400).json({ success: false, message: 'Invalid user ID' });
      return;
    }
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const updateData: Record<string, unknown> = {
      userId,
      date,
      status,
      leaveDuration: (status === 'leave' && leaveDuration) ? leaveDuration : undefined,
      halfDayPortion: (status === 'leave' && leaveDuration === 'half' && halfDayPortion) ? halfDayPortion : undefined,
      workingPortion: (status === 'leave' && leaveDuration === 'half') ? (workingPortion || 'wfh') : undefined,
      note: note ? sanitizeText(note) : undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
    };

    const updateOp = buildUpdateOp(updateData, startTime, note, leaveDuration, halfDayPortion, workingPortion);

    const entry = await Entry.findOneAndUpdate(
      { userId, date },
      updateOp,
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, data: entry });
  } catch (error: any) {
    console.error('adminUpsertEntry error:', error);
    res.status(500).json({ success: false, message: 'Failed to update entry' });
  }
};

/**
 * Remove an entry (revert to WFH).
 * DELETE /api/entries/:date
 */
export const deleteEntry = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { date } = req.params;
    const userId = req.user!._id;
    const isAdmin = req.user!.role === 'admin';

    if (!isAdmin && !isMemberAllowedDate(date)) {
      res.status(403).json({
        success: false,
        message: 'You can only edit dates within the current month and up to 90 days ahead',
      });
      return;
    }

    const entry = await Entry.findOneAndDelete({ userId, date });

    res.json({
      success: true,
      message: entry ? 'Entry removed (status reverted to WFH)' : 'No entry found',
    });
  } catch (error: any) {
    console.error('deleteEntry error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete entry' });
  }
};

/**
 * Admin removes an entry for any user.
 * DELETE /api/entries/admin/:userId/:date
 */
export const adminDeleteEntry = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { userId, date } = req.params;

    const entry = await Entry.findOneAndDelete({ userId, date });

    res.json({
      success: true,
      message: entry ? 'Entry removed (status reverted to WFH)' : 'No entry found',
    });
  } catch (error: any) {
    console.error('adminDeleteEntry error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete entry' });
  }
};

/**
 * Get current user's entries for a date range.
 * GET /api/entries?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const getMyEntries = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    if (!startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
      });
      return;
    }

    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      res.status(400).json({
        success: false,
        message: 'startDate and endDate must be in YYYY-MM-DD format',
      });
      return;
    }

    const entries = await Entry.find({
      userId: req.user!._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    res.json({ success: true, data: entries });
  } catch (error: any) {
    console.error('getMyEntries error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve entries' });
  }
};

/**
 * Get team view: all active users' entries for a month.
 * GET /api/entries/team?month=YYYY-MM
 */
export const getTeamEntries = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { month } = req.query as { month?: string };

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({
        success: false,
        message: 'month query param is required in YYYY-MM format',
      });
      return;
    }

    const { startDate, endDate } = getMonthRange(month);

    // Get all active users
    const users = await User.find({ isActive: true })
      .select('name email role')
      .sort({ name: 1 });

    // Get all entries for the month
    const entries = await Entry.find({
      date: { $gte: startDate, $lte: endDate },
      userId: { $in: users.map((u: any) => u._id) },
    });

    // Build a lookup: { [userId]: { [date]: { status, note?, startTime?, endTime?, leaveDuration?, halfDayPortion?, workingPortion? } } }
    const entryMap: Record<string, Record<string, { status: string; note?: string; startTime?: string; endTime?: string; leaveDuration?: string; halfDayPortion?: string; workingPortion?: string }>> = {};
    entries.forEach((e: any) => {
      const uid = e.userId.toString();
      if (!entryMap[uid]) entryMap[uid] = {};
      entryMap[uid][e.date] = {
        status: e.status,
        ...(e.note ? { note: e.note } : {}),
        ...(e.startTime ? { startTime: e.startTime } : {}),
        ...(e.endTime ? { endTime: e.endTime } : {}),
        ...(e.leaveDuration ? { leaveDuration: e.leaveDuration } : {}),
        ...(e.halfDayPortion ? { halfDayPortion: e.halfDayPortion } : {}),
        ...(e.workingPortion ? { workingPortion: e.workingPortion } : {}),
      };
    });

    const teamData = users.map((user: any) => ({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      entries: entryMap[user._id.toString()] || {},
    }));

    res.json({
      success: true,
      data: {
        month,
        startDate,
        endDate,
        today: getTodayString(),
        team: teamData,
      },
    });
  } catch (error: any) {
    console.error('getTeamEntries error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve team entries' });
  }
};

// ─── Helper: filter valid dates for a member ───────────────
const filterAllowedDates = (dates: string[], isAdmin: boolean): string[] => {
  return dates.filter((d) => {
    if (!DATE_RE.test(d)) return false;
    if (!isAdmin && !isMemberAllowedDate(d)) return false;
    return true;
  });
};

/**
 * Bulk set status for multiple dates.
 * POST /api/entries/bulk
 * Body: { dates: string[], status: 'office' | 'leave' | 'clear', note?, startTime?, endTime? }
 */
export const bulkSetEntries = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { dates, status, note, startTime, endTime, leaveDuration, halfDayPortion, workingPortion } = req.body;
    const userId = req.user!._id;
    const isAdmin = req.user!.role === 'admin';

    if (!Array.isArray(dates) || dates.length === 0) {
      res.status(400).json({ success: false, message: 'dates array is required' });
      return;
    }
    if (dates.length > MAX_DATES) {
      res.status(400).json({ success: false, message: `dates array length must be <= ${MAX_DATES}` });
      return;
    }

    if (!['office', 'leave', 'clear'].includes(status)) {
      res.status(400).json({ success: false, message: 'Status must be "office", "leave", or "clear"' });
      return;
    }

    // Validate time window
    const timeErr = validateTimeWindow(startTime, endTime);
    if (timeErr && status !== 'clear') {
      res.status(400).json({ success: false, message: timeErr });
      return;
    }

    const allowedDates = filterAllowedDates(dates, isAdmin);
    const results: { date: string; success: boolean; message?: string }[] = [];

    if (allowedDates.length > 0) {
      const ops = allowedDates.map((date) => {
        if (status === 'clear') {
          return { deleteOne: { filter: { userId, date } } };
        }
        const updateData: Record<string, unknown> = {
          userId,
          date,
          status,
          leaveDuration: (status === 'leave' && leaveDuration) ? leaveDuration : undefined,
          halfDayPortion: (status === 'leave' && leaveDuration === 'half' && halfDayPortion) ? halfDayPortion : undefined,
          workingPortion: (status === 'leave' && leaveDuration === 'half') ? (workingPortion || 'wfh') : undefined,
          note: note ? sanitizeText(note) : undefined,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        };

        const update = buildUpdateOp(updateData, startTime, note, leaveDuration, halfDayPortion, workingPortion);

        return {
          updateOne: {
            filter: { userId, date },
            update,
            upsert: true,
          },
        };
      });

      try {
        await Entry.bulkWrite(ops, { ordered: false });
        // All ops succeeded
        allowedDates.forEach((date) => {
          results.push({ date, success: true, message: status === 'clear' ? 'cleared' : undefined });
        });
      } catch (err: any) {
        // With ordered: false, successful ops still execute; map failures by index
        const writeErrors: { index: number }[] = err.writeErrors ?? [];
        const failedIndices = new Set(writeErrors.map((e: { index: number }) => e.index));

        allowedDates.forEach((date, i) => {
          if (failedIndices.has(i)) {
            console.error(`bulkSetEntries: failed for date ${date}:`, writeErrors.find((e: { index: number }) => e.index === i));
            results.push({ date, success: false, message: 'Failed to process entry' });
          } else {
            results.push({ date, success: true, message: status === 'clear' ? 'cleared' : undefined });
          }
        });
      }
    }

    // Report skipped dates
    const skipped = dates.filter((d: string) => !allowedDates.includes(d));
    skipped.forEach((d: string) => results.push({ date: d, success: false, message: 'Outside allowed range' }));

    res.json({
      success: true,
      data: {
        processed: results.filter((r) => r.success).length,
        skipped: results.filter((r) => !r.success).length,
        results,
      },
    });
  } catch (error: any) {
    console.error('bulkSetEntries error:', error);
    res.status(500).json({ success: false, message: 'Failed to process bulk entries' });
  }
};

/**
 * Copy entries from one source date to one or more target dates.
 * POST /api/entries/copy
 * Body: { sourceDate: string, targetDates: string[] }
 */
export const copyFromDate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { sourceDate, targetDates } = req.body;
    const userId = req.user!._id;
    const isAdmin = req.user!.role === 'admin';

    if (!sourceDate || !DATE_RE.test(sourceDate)) {
      res.status(400).json({ success: false, message: 'Valid sourceDate is required' });
      return;
    }
    if (!Array.isArray(targetDates) || targetDates.length === 0) {
      res.status(400).json({ success: false, message: 'targetDates array is required' });
      return;
    }
    if (targetDates.length > MAX_DATES) {
      res.status(400).json({ success: false, message: `targetDates array length must be <= ${MAX_DATES}` });
      return;
    }

    // Fetch source entry
    const sourceEntry = await Entry.findOne({ userId, date: sourceDate });

    const allowedTargets = filterAllowedDates(targetDates, isAdmin);
    const results: { date: string; success: boolean; message?: string }[] = [];

    for (const date of allowedTargets) {
      try {
        if (!sourceEntry) {
          // Source is WFH — clear targets
          await Entry.findOneAndDelete({ userId, date });
          results.push({ date, success: true, message: 'cleared (source is WFH)' });
        } else {
          const updateData: Record<string, unknown> = {
            userId,
            date,
            status: sourceEntry.status,
            note: sourceEntry.note || undefined,
            startTime: sourceEntry.startTime || undefined,
            endTime: sourceEntry.endTime || undefined,
            leaveDuration: sourceEntry.leaveDuration || undefined,
            halfDayPortion: sourceEntry.halfDayPortion || undefined,
            workingPortion: sourceEntry.workingPortion || undefined,
          };

          const updateOp = buildUpdateOp(
            updateData,
            sourceEntry.startTime,
            sourceEntry.note,
            sourceEntry.leaveDuration,
            sourceEntry.halfDayPortion,
            sourceEntry.workingPortion,
          );

          await Entry.findOneAndUpdate(
            { userId, date },
            updateOp,
            { upsert: true, new: true, runValidators: true }
          );
          results.push({ date, success: true });
        }
      } catch (err: any) {
        console.error(`copyFromDate: failed for date ${date}:`, err);
        results.push({ date, success: false, message: 'Failed to copy entry' });
      }
    }

    const skipped = targetDates.filter((d: string) => !allowedTargets.includes(d));
    skipped.forEach((d: string) => results.push({ date: d, success: false, message: 'Outside allowed range' }));

    res.json({
      success: true,
      data: {
        sourceDate,
        sourceStatus: sourceEntry?.status || 'wfh',
        processed: results.filter((r) => r.success).length,
        skipped: results.filter((r) => !r.success).length,
        results,
      },
    });
  } catch (error: any) {
    console.error('copyFromDate error:', error);
    res.status(500).json({ success: false, message: 'Failed to copy entries' });
  }
};

/**
 * Repeat a pattern across a date range for specific days of week.
 * POST /api/entries/repeat
 * Body: { status, daysOfWeek: number[], startDate, endDate, note?, startTime?, endTime? }
 */
export const repeatPattern = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { status, daysOfWeek, startDate, endDate, note, startTime, endTime, leaveDuration, halfDayPortion, workingPortion } = req.body;
    const userId = req.user!._id;
    const isAdmin = req.user!.role === 'admin';

    if (!['office', 'leave', 'clear'].includes(status)) {
      res.status(400).json({ success: false, message: 'Status must be "office", "leave", or "clear"' });
      return;
    }
    if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
      res.status(400).json({ success: false, message: 'daysOfWeek array is required (0=Sun, 6=Sat)' });
      return;
    }
    if (!startDate || !DATE_RE.test(startDate) || !endDate || !DATE_RE.test(endDate)) {
      res.status(400).json({ success: false, message: 'Valid startDate and endDate are required' });
      return;
    }
    if (endDate < startDate) {
      res.status(400).json({ success: false, message: 'endDate must be >= startDate' });
      return;
    }

    // Cap end date at 90 days from today for non-admins
    const maxDate = isAdmin ? endDate : getFutureDateString(90);
    const effectiveEndDate = endDate > maxDate ? maxDate : endDate;

    // Validate time window
    const timeErr = validateTimeWindow(startTime, endTime);
    if (timeErr && status !== 'clear') {
      res.status(400).json({ success: false, message: timeErr });
      return;
    }

    // Generate matching dates
    const dates: string[] = [];
    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(effectiveEndDate + 'T00:00:00');

    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (daysOfWeek.includes(dayOfWeek)) {
        const dateStr = toISTDateString(current);
        dates.push(dateStr);
        if (dates.length > MAX_DATES) {
          res.status(400).json({ success: false, message: `Generated dates exceed the maximum of ${MAX_DATES}` });
          return;
        }
      }
      current.setDate(current.getDate() + 1);
    }

    const allowedDates = filterAllowedDates(dates, isAdmin);
    const results: { date: string; success: boolean; message?: string }[] = [];

    for (const date of allowedDates) {
      try {
        if (status === 'clear') {
          await Entry.findOneAndDelete({ userId, date });
          results.push({ date, success: true, message: 'cleared' });
        } else {
          const updateData: Record<string, unknown> = {
            userId,
            date,
            status,
            leaveDuration: (status === 'leave' && leaveDuration) ? leaveDuration : undefined,
            halfDayPortion: (status === 'leave' && leaveDuration === 'half' && halfDayPortion) ? halfDayPortion : undefined,
            workingPortion: (status === 'leave' && leaveDuration === 'half') ? (workingPortion || 'wfh') : undefined,
            note: note ? sanitizeText(note) : undefined,
            startTime: startTime || undefined,
            endTime: endTime || undefined,
          };

          const updateOp = buildUpdateOp(updateData, startTime, note, leaveDuration, halfDayPortion, workingPortion);

          await Entry.findOneAndUpdate(
            { userId, date },
            updateOp,
            { upsert: true, new: true, runValidators: true }
          );
          results.push({ date, success: true });
        }
      } catch (err: any) {
        console.error(`repeatPattern: failed for date ${date}:`, err);
        results.push({ date, success: false, message: 'Failed to process entry' });
      }
    }

    res.json({
      success: true,
      data: {
        processed: results.filter((r) => r.success).length,
        skipped: results.filter((r) => !r.success).length,
        results,
      },
    });
  } catch (error: any) {
    console.error('repeatPattern error:', error);
    res.status(500).json({ success: false, message: 'Failed to process repeat pattern' });
  }
};

/**
 * Copy a date range to another date range (e.g. copy last week to this week).
 * POST /api/entries/copy-range
 * Body: { sourceStart, sourceEnd, targetStart }
 */
export const copyRange = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { sourceStart, sourceEnd, targetStart } = req.body;
    const userId = req.user!._id;
    const isAdmin = req.user!.role === 'admin';

    if (!sourceStart || !sourceEnd || !targetStart) {
      res.status(400).json({ success: false, message: 'sourceStart, sourceEnd, and targetStart are required' });
      return;
    }
    if (!DATE_RE.test(sourceStart) || !DATE_RE.test(sourceEnd) || !DATE_RE.test(targetStart)) {
      res.status(400).json({ success: false, message: 'All dates must be in YYYY-MM-DD format' });
      return;
    }

    // Validate sourceEnd >= sourceStart
    if (sourceEnd < sourceStart) {
      res.status(400).json({ success: false, message: 'sourceEnd must be the same or after sourceStart' });
      return;
    }

    // Enforce maximum range span (UTC arithmetic avoids DST issues)
    const toUTC = (d: string) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
    const rangeDays = (toUTC(sourceEnd) - toUTC(sourceStart)) / 86_400_000 + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      res.status(400).json({ success: false, message: `Source range of ${rangeDays} days exceeds the maximum of ${MAX_RANGE_DAYS} days` });
      return;
    }

    // Fetch source entries
    const sourceEntries = await Entry.find({
      userId,
      date: { $gte: sourceStart, $lte: sourceEnd },
    });

    const sourceMap: Record<string, typeof sourceEntries[0]> = {};
    sourceEntries.forEach((e: any) => { sourceMap[e.date] = e; });

    // Calculate offset in days (UTC)
    const srcStartDate = new Date(sourceStart + 'T00:00:00Z');
    const tgtStartDate = new Date(targetStart + 'T00:00:00Z');
    const offsetMs = tgtStartDate.getTime() - srcStartDate.getTime();

    // Generate source date range (UTC)
    const current = new Date(sourceStart + 'T00:00:00Z');
    const end = new Date(sourceEnd + 'T00:00:00Z');
    const results: { date: string; success: boolean; message?: string }[] = [];

    while (current <= end) {
      const srcDateStr = toISTDateString(current);
      const targetDate = new Date(current.getTime() + offsetMs);
      const tgtDateStr = toISTDateString(targetDate);

      // Check allowed
      if (!isAdmin && !isMemberAllowedDate(tgtDateStr)) {
        results.push({ date: tgtDateStr, success: false, message: 'Outside allowed range' });
        current.setDate(current.getDate() + 1);
        continue;
      }

      try {
        const sourceEntry = sourceMap[srcDateStr];
        if (!sourceEntry) {
          await Entry.findOneAndDelete({ userId, date: tgtDateStr });
          results.push({ date: tgtDateStr, success: true, message: 'cleared (source WFH)' });
        } else {
          const updateData: Record<string, unknown> = {
            userId,
            date: tgtDateStr,
            status: sourceEntry.status,
            note: sourceEntry.note || undefined,
            startTime: sourceEntry.startTime || undefined,
            endTime: sourceEntry.endTime || undefined,
            leaveDuration: sourceEntry.leaveDuration || undefined,
            halfDayPortion: sourceEntry.halfDayPortion || undefined,
            workingPortion: sourceEntry.workingPortion || undefined,
          };

          const updateOp = buildUpdateOp(
            updateData,
            sourceEntry.startTime,
            sourceEntry.note,
            sourceEntry.leaveDuration,
            sourceEntry.halfDayPortion,
            sourceEntry.workingPortion,
          );

          await Entry.findOneAndUpdate(
            { userId, date: tgtDateStr },
            updateOp,
            { upsert: true, new: true, runValidators: true }
          );
          results.push({ date: tgtDateStr, success: true });
        }
      } catch (err: any) {
        console.error(`copyRange: failed for date ${tgtDateStr}:`, err);
        results.push({ date: tgtDateStr, success: false, message: 'Failed to copy entry' });
      }

      current.setDate(current.getDate() + 1);
    }

    res.json({
      success: true,
      data: {
        processed: results.filter((r) => r.success).length,
        skipped: results.filter((r) => !r.success).length,
        results,
      },
    });
  } catch (error: any) {
    console.error('copyRange error:', error);
    res.status(500).json({ success: false, message: 'Failed to copy range' });
  }
};

/**
 * Get team availability summary for a month.
 * GET /api/entries/team-summary?month=YYYY-MM
 */
export const getTeamSummary = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { month } = req.query as { month?: string };
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ success: false, message: 'month query param is required in YYYY-MM format' });
      return;
    }

    const { startDate, endDate } = getMonthRange(month);

    const users = await User.find({ isActive: true }).select('_id');
    const totalMembers = users.length;
    const userIds = users.map((u: any) => u._id);

    const entries = await Entry.find({
      date: { $gte: startDate, $lte: endDate },
      userId: { $in: userIds },
    });

    // Build summary per date
    const summary: Record<string, { office: number; leave: number; wfh: number; halfDayLeave: number; total: number }> = {};

    // Init all dates
    const [year, mo] = month.split('-').map(Number);
    const daysCount = new Date(year, mo, 0).getDate();
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      summary[dateStr] = { office: 0, leave: 0, wfh: totalMembers, halfDayLeave: 0, total: totalMembers };
    }

    // Tally entries
    entries.forEach((e: any) => {
      if (!summary[e.date]) return;
      if (e.status === 'office') {
        summary[e.date].office++;
        summary[e.date].wfh--;
      } else if (e.status === 'leave') {
        if (e.leaveDuration === 'half') {
          // Half-day leave: count as partial leave, and working portion contributes
          summary[e.date].halfDayLeave++;
          summary[e.date].leave++;
          summary[e.date].wfh--;
          if (e.workingPortion === 'office') {
            summary[e.date].office++;
          }
        } else {
          summary[e.date].leave++;
          summary[e.date].wfh--;
        }
      }
    });

    res.json({ success: true, data: summary });
  } catch (error: any) {
    console.error('getTeamSummary error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve team summary' });
  }
};
