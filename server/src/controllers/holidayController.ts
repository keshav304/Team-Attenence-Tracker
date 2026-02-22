import { Request, Response } from 'express';
import Holiday from '../models/Holiday.js';
import { notifyAdminAnnouncement } from '../utils/pushNotifications.js';

/**
 * Get holidays for a date range.
 * GET /api/holidays?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const getHolidays = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    const query: Record<string, unknown> = {};
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }

    const holidays = await Holiday.find(query).sort({ date: 1 });
    res.json({ success: true, data: holidays });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a holiday (admin only).
 * POST /api/holidays
 */
export const createHoliday = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { date, name } = req.body;
    const holiday = await Holiday.create({ date, name });

    // Push notification to all subscribers
    notifyAdminAnnouncement(
      '🎉 New Holiday Added',
      `${name} on ${date}`,
      '/'
    );

    res.status(201).json({ success: true, data: holiday });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'Holiday already exists for this date' });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Update a holiday (admin only).
 * PUT /api/holidays/:id
 */
export const updateHoliday = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { date, name } = req.body;

    const holiday = await Holiday.findByIdAndUpdate(
      id,
      { date, name },
      { new: true, runValidators: true }
    );

    if (!holiday) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }

    res.json({ success: true, data: holiday });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Delete a holiday (admin only).
 * DELETE /api/holidays/:id
 */
export const deleteHoliday = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const holiday = await Holiday.findByIdAndDelete(id);

    if (!holiday) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }

    res.json({ success: true, message: 'Holiday deleted' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
