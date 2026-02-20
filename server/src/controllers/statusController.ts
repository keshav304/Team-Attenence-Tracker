import { Response } from 'express';
import User from '../models/User';
import Entry from '../models/Entry';
import Holiday from '../models/Holiday';
import { AuthRequest } from '../types';

/**
 * Get today's attendance status for all active employees.
 * GET /api/status/today
 * Any authenticated user.
 */
export const getTodayStatus = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // Check if today is a weekend
    const dayOfWeek = today.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Fetch in parallel
    const [users, entries, holidays] = await Promise.all([
      User.find({ isActive: true }).select('name email role').sort({ name: 1 }),
      Entry.find({ date: todayStr }),
      Holiday.find({ date: todayStr }),
    ]);

    const isHoliday = holidays.length > 0;
    const holidayName = isHoliday ? holidays[0].name : undefined;

    // Build entry map: userId → status
    const entryMap: Record<string, { status: string; note?: string; startTime?: string; endTime?: string }> = {};
    entries.forEach((e) => {
      entryMap[e.userId.toString()] = {
        status: e.status,
        note: e.note,
        startTime: e.startTime,
        endTime: e.endTime,
      };
    });

    // Categorise users
    const office: { _id: string; name: string; email: string; startTime?: string; endTime?: string; note?: string }[] = [];
    const leave: { _id: string; name: string; email: string; note?: string }[] = [];
    const wfh: { _id: string; name: string; email: string }[] = [];

    for (const u of users) {
      const uid = u._id.toString();
      const entry = entryMap[uid];

      if (entry?.status === 'office') {
        office.push({
          _id: uid,
          name: u.name,
          email: u.email,
          startTime: entry.startTime,
          endTime: entry.endTime,
          note: entry.note,
        });
      } else if (entry?.status === 'leave') {
        leave.push({
          _id: uid,
          name: u.name,
          email: u.email,
          note: entry.note,
        });
      } else {
        wfh.push({
          _id: uid,
          name: u.name,
          email: u.email,
        });
      }
    }

    res.json({
      success: true,
      data: {
        date: todayStr,
        isWeekend,
        isHoliday,
        holidayName,
        counts: {
          office: office.length,
          leave: leave.length,
          wfh: wfh.length,
          total: users.length,
        },
        office,
        leave,
        wfh,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
