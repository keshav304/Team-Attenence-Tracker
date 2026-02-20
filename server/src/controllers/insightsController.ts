import { Response } from 'express';
import User from '../models/User';
import Entry from '../models/Entry';
import Holiday from '../models/Holiday';
import { AuthRequest } from '../types';

/**
 * Get insights / analytics for a given month.
 * GET /api/insights?month=MM&year=YYYY
 * Admin only.
 */
export const getInsights = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const monthStr = req.query.month as string;
    const yearStr = req.query.year as string;

    if (!monthStr || !yearStr) {
      res.status(400).json({ success: false, message: 'month and year query params are required' });
      return;
    }

    const month = parseInt(monthStr, 10);
    const year = parseInt(yearStr, 10);

    if (isNaN(month) || month < 1 || month > 12 || isNaN(year) || year < 2000) {
      res.status(400).json({ success: false, message: 'Invalid month or year' });
      return;
    }

    const mm = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${mm}-01`;
    const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

    // ─── Fetch data in parallel ─────────────────
    const [users, holidays, entries] = await Promise.all([
      User.find({ isActive: true }).select('name email role createdAt').sort({ name: 1 }),
      Holiday.find({ date: { $gte: startDate, $lte: endDate } }),
      Entry.find({ date: { $gte: startDate, $lte: endDate } }),
    ]);

    // ─── Build holiday set ──────────────────────
    const holidaySet = new Set(holidays.map((h) => h.date));
    const holidayList = holidays.map((h) => ({ date: h.date, name: h.name }));

    // ─── Compute working days ───────────────────
    const workingDays: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      // Exclude weekends (Sat=6, Sun=0) and holidays
      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateStr)) {
        workingDays.push(dateStr);
      }
    }
    const totalWorkingDays = workingDays.length;

    // ─── Build entry lookup: userId → date → entry ─
    const entryMap: Record<string, Record<string, { status: string; startTime?: string; endTime?: string; note?: string }>> = {};
    entries.forEach((e) => {
      const uid = e.userId.toString();
      if (!entryMap[uid]) entryMap[uid] = {};
      entryMap[uid][e.date] = {
        status: e.status,
        startTime: e.startTime,
        endTime: e.endTime,
        note: e.note,
      };
    });

    // ─── Day-of-week counters for team aggregates ─
    const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const officeDayOfWeekCount: Record<string, number> = {};
    dayOfWeekNames.forEach((n) => { officeDayOfWeekCount[n] = 0; });

    // ─── Per-employee metrics ───────────────────
    interface EmployeeMetric {
      userId: string;
      name: string;
      email: string;
      role: string;
      totalWorkingDays: number;
      officeDays: number;
      leaveDays: number;
      wfhDays: number;
      partialDays: number;
      notesCount: number;
      officePercent: number;
      leavePercent: number;
      wfhPercent: number;
    }

    const employeeMetrics: EmployeeMetric[] = [];
    let teamOfficeDays = 0;
    let teamLeaveDays = 0;
    let teamWfhDays = 0;

    for (const user of users) {
      const uid = user._id.toString();
      const userEntries = entryMap[uid] || {};

      // Determine if user joined mid-month
      const userCreated = user.createdAt ? new Date(user.createdAt).toISOString().split('T')[0] : '2000-01-01';
      const effectiveWorkingDays = workingDays.filter((d) => d >= userCreated);
      const effectiveTotal = effectiveWorkingDays.length;

      let officeDays = 0;
      let leaveDays = 0;
      let partialDays = 0;
      let notesCount = 0;

      for (const date of effectiveWorkingDays) {
        const entry = userEntries[date];
        if (entry) {
          if (entry.status === 'office') {
            officeDays++;
            // Count for day-of-week popularity
            const dow = new Date(date + 'T00:00:00').getDay();
            officeDayOfWeekCount[dayOfWeekNames[dow]]++;
          } else if (entry.status === 'leave') {
            leaveDays++;
          }
          if (entry.startTime && entry.endTime) {
            partialDays++;
          }
          if (entry.note) {
            notesCount++;
          }
        }
      }

      const wfhDays = Math.max(0, effectiveTotal - officeDays - leaveDays);

      teamOfficeDays += officeDays;
      teamLeaveDays += leaveDays;
      teamWfhDays += wfhDays;

      employeeMetrics.push({
        userId: uid,
        name: user.name,
        email: user.email,
        role: user.role,
        totalWorkingDays: effectiveTotal,
        officeDays,
        leaveDays,
        wfhDays,
        partialDays,
        notesCount,
        officePercent: effectiveTotal > 0 ? Math.round((officeDays / effectiveTotal) * 100) : 0,
        leavePercent: effectiveTotal > 0 ? Math.round((leaveDays / effectiveTotal) * 100) : 0,
        wfhPercent: effectiveTotal > 0 ? Math.round((wfhDays / effectiveTotal) * 100) : 0,
      });
    }

    // ─── Team aggregates ────────────────────────
    const totalEmployees = users.length;
    const avgOfficePerDay = totalWorkingDays > 0
      ? Math.round((teamOfficeDays / totalWorkingDays) * 10) / 10
      : 0;

    // Most/least popular office day (only weekdays)
    const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekdayOffice = weekdayNames.map((name) => ({
      day: name,
      count: officeDayOfWeekCount[name] || 0,
    }));
    weekdayOffice.sort((a, b) => b.count - a.count);
    const mostPopularDay = weekdayOffice[0]?.day || 'N/A';
    const leastPopularDay = weekdayOffice[weekdayOffice.length - 1]?.day || 'N/A';

    // ─── Per-day office count for trend ─────────
    const dailyOfficeCount: { date: string; count: number }[] = [];
    for (const date of workingDays) {
      let count = 0;
      for (const user of users) {
        const uid = user._id.toString();
        const entry = entryMap[uid]?.[date];
        if (entry?.status === 'office') count++;
      }
      dailyOfficeCount.push({ date, count });
    }

    res.json({
      success: true,
      data: {
        month,
        year,
        totalWorkingDays,
        holidays: holidayList,
        team: {
          totalEmployees,
          totalOfficeDays: teamOfficeDays,
          totalLeaveDays: teamLeaveDays,
          totalWfhDays: teamWfhDays,
          avgOfficePerDay,
          mostPopularDay,
          leastPopularDay,
          officeDayDistribution: weekdayOffice,
        },
        employees: employeeMetrics,
        dailyOfficeTrend: dailyOfficeCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get detailed monthly analytics for a single employee.
 * GET /api/insights/user/:userId?month=MM&year=YYYY
 * Admin only.
 */
export const getUserInsights = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { userId } = req.params;
    const monthStr = req.query.month as string;
    const yearStr = req.query.year as string;

    if (!monthStr || !yearStr) {
      res.status(400).json({ success: false, message: 'month and year query params are required' });
      return;
    }

    const month = parseInt(monthStr, 10);
    const year = parseInt(yearStr, 10);

    if (isNaN(month) || month < 1 || month > 12 || isNaN(year) || year < 2000) {
      res.status(400).json({ success: false, message: 'Invalid month or year' });
      return;
    }

    // Validate user exists
    const user = await User.findById(userId).select('name email role isActive createdAt');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const mm = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${mm}-01`;
    const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

    // Fetch holidays and user entries in parallel
    const [holidays, entries] = await Promise.all([
      Holiday.find({ date: { $gte: startDate, $lte: endDate } }),
      Entry.find({ userId, date: { $gte: startDate, $lte: endDate } }),
    ]);

    // Build holiday set
    const holidaySet = new Set(holidays.map((h) => h.date));
    const holidayList = holidays.map((h) => ({ date: h.date, name: h.name }));

    // Build entry lookup: date → entry
    const entryMap: Record<string, { status: string; startTime?: string; endTime?: string; note?: string }> = {};
    entries.forEach((e) => {
      entryMap[e.date] = {
        status: e.status,
        startTime: e.startTime,
        endTime: e.endTime,
        note: e.note,
      };
    });

    // Determine user's effective start (in case they joined mid-month)
    const userCreated = user.createdAt
      ? new Date(user.createdAt).toISOString().split('T')[0]
      : '2000-01-01';

    // Compute working days and daily breakdown
    let officeDays = 0;
    let leaveDays = 0;
    let wfhDays = 0;
    let partialDays = 0;
    let notesCount = 0;
    const dailyBreakdown: {
      date: string;
      dayOfWeek: string;
      isWeekend: boolean;
      isHoliday: boolean;
      holidayName?: string;
      isBeforeJoin: boolean;
      status: 'office' | 'leave' | 'wfh' | 'holiday' | 'weekend' | 'not-joined';
      startTime?: string;
      endTime?: string;
      note?: string;
    }[] = [];

    const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let totalWorkingDays = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = holidaySet.has(dateStr);
      const isBeforeJoin = dateStr < userCreated;
      const holiday = isHoliday ? holidays.find((h) => h.date === dateStr) : undefined;

      const entry = entryMap[dateStr];

      let effectiveStatus: 'office' | 'leave' | 'wfh' | 'holiday' | 'weekend' | 'not-joined';
      if (isWeekend) {
        effectiveStatus = 'weekend';
      } else if (isHoliday) {
        effectiveStatus = 'holiday';
      } else if (isBeforeJoin) {
        effectiveStatus = 'not-joined';
      } else {
        // Working day
        totalWorkingDays++;
        if (entry) {
          if (entry.status === 'office') {
            officeDays++;
            effectiveStatus = 'office';
          } else if (entry.status === 'leave') {
            leaveDays++;
            effectiveStatus = 'leave';
          } else {
            // fallback
            wfhDays++;
            effectiveStatus = 'wfh';
          }
          if (entry.startTime && entry.endTime) partialDays++;
          if (entry.note) notesCount++;
        } else {
          wfhDays++;
          effectiveStatus = 'wfh';
        }
      }

      dailyBreakdown.push({
        date: dateStr,
        dayOfWeek: dayOfWeekNames[dayOfWeek],
        isWeekend,
        isHoliday,
        holidayName: holiday?.name,
        isBeforeJoin,
        status: effectiveStatus,
        startTime: entry?.startTime,
        endTime: entry?.endTime,
        note: entry?.note,
      });
    }

    res.json({
      success: true,
      data: {
        month,
        year,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        },
        totalWorkingDays,
        holidays: holidayList,
        summary: {
          officeDays,
          leaveDays,
          wfhDays,
          partialDays,
          notesCount,
          officePercent: totalWorkingDays > 0 ? Math.round((officeDays / totalWorkingDays) * 100) : 0,
          leavePercent: totalWorkingDays > 0 ? Math.round((leaveDays / totalWorkingDays) * 100) : 0,
          wfhPercent: totalWorkingDays > 0 ? Math.round((wfhDays / totalWorkingDays) * 100) : 0,
        },
        dailyBreakdown,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Export monthly attendance metrics as a CSV download.
 * GET /api/insights/export?month=MM&year=YYYY
 * Admin only.
 */
export const exportInsightsCsv = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const monthStr = req.query.month as string;
    const yearStr = req.query.year as string;

    if (!monthStr || !yearStr) {
      res.status(400).json({ success: false, message: 'month and year query params are required' });
      return;
    }

    const month = parseInt(monthStr, 10);
    const year = parseInt(yearStr, 10);

    if (isNaN(month) || month < 1 || month > 12 || isNaN(year) || year < 2000) {
      res.status(400).json({ success: false, message: 'Invalid month or year' });
      return;
    }

    const mm = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${mm}-01`;
    const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

    const [users, holidays, entries] = await Promise.all([
      User.find({ isActive: true }).select('name email role createdAt').sort({ name: 1 }),
      Holiday.find({ date: { $gte: startDate, $lte: endDate } }),
      Entry.find({ date: { $gte: startDate, $lte: endDate } }),
    ]);

    const holidaySet = new Set(holidays.map((h) => h.date));

    // Compute working days
    const workingDays: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateStr)) {
        workingDays.push(dateStr);
      }
    }

    // Build entry lookup
    const entryMap: Record<string, Record<string, string>> = {};
    entries.forEach((e) => {
      const uid = e.userId.toString();
      if (!entryMap[uid]) entryMap[uid] = {};
      entryMap[uid][e.date] = e.status;
    });

    // CSV header
    const csvRows: string[] = [
      'Name,Email,Working Days,Office Days,Leave Days,WFH Days,Office %,Leave %,WFH %',
    ];

    for (const user of users) {
      const uid = user._id.toString();
      const userEntries = entryMap[uid] || {};
      const userCreated = user.createdAt
        ? new Date(user.createdAt).toISOString().split('T')[0]
        : '2000-01-01';
      const effectiveWorkingDays = workingDays.filter((d) => d >= userCreated);
      const effectiveTotal = effectiveWorkingDays.length;

      let officeDays = 0;
      let leaveDays = 0;
      for (const date of effectiveWorkingDays) {
        const status = userEntries[date];
        if (status === 'office') officeDays++;
        else if (status === 'leave') leaveDays++;
      }
      const wfhDays = Math.max(0, effectiveTotal - officeDays - leaveDays);
      const officePercent = effectiveTotal > 0 ? Math.round((officeDays / effectiveTotal) * 100) : 0;
      const leavePercent = effectiveTotal > 0 ? Math.round((leaveDays / effectiveTotal) * 100) : 0;
      const wfhPercent = effectiveTotal > 0 ? Math.round((wfhDays / effectiveTotal) * 100) : 0;

      // Escape name/email for CSV (wrap in quotes if they contain commas)
      const escapeCsv = (val: string) => (val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val);

      csvRows.push(
        `${escapeCsv(user.name)},${escapeCsv(user.email)},${effectiveTotal},${officeDays},${leaveDays},${wfhDays},${officePercent}%,${leavePercent}%,${wfhPercent}%`
      );
    }

    const csvContent = csvRows.join('\n');
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const filename = `attendance-${monthNames[month - 1]}-${year}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
