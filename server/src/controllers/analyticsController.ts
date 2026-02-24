import { Response, NextFunction } from 'express';
import User from '../models/User.js';
import Entry from '../models/Entry.js';
import Holiday from '../models/Holiday.js';
import Event from '../models/Event.js';
import { AuthRequest } from '../types/index.js';
import { getTodayString } from '../utils/date.js';

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

/** Parse YYYY-MM-DD to { year, month, day } numbers. */
function parseDateStr(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return { year: y, month: m, day };
}

/** Get working days (Mon-Fri, excluding holidays) within a date range. */
function getWorkingDays(
  startDate: string,
  endDate: string,
  holidaySet: Set<string>
): string[] {
  const days: string[] = [];
  const start = parseDateStr(startDate);
  const end = parseDateStr(endDate);
  const d = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const endD = new Date(Date.UTC(end.year, end.month - 1, end.day));

  while (d <= endD) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dow = d.getUTCDay();

    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) {
      days.push(dateStr);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/** Get start and end of a month as YYYY-MM-DD. */
function getMonthRange(year: number, month: number) {
  const mm = String(month).padStart(2, '0');
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`,
  };
}

/** Format date as a nice string like "Wednesday, Mar 4". */
function formatDateNice(dateStr: string): string {
  const { year, month, day } = parseDateStr(dateStr);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/* ================================================================== */
/*  Shared attendance computation                                     */
/* ================================================================== */

interface AttendanceStats {
  totalWorkingDays: number;
  officeDays: number;
  leaveDays: number;
  wfhDays: number;
  officePercent: number;
}

/**
 * Compute attendance statistics for a user over a date range.
 * Shared by getMyPercentage (API) and handlePersonalAttendance (chat).
 */
async function computeAttendanceStats(
  userId: string | any,
  startDate: string,
  endDate: string
): Promise<{ stats: AttendanceStats; workingDays: string[]; entryMap: Map<string, { status: string; leaveDuration?: string; workingPortion?: string }> }> {
  const [holidays, entries] = await Promise.all([
    Holiday.find({ date: { $gte: startDate, $lte: endDate } }),
    Entry.find({ userId, date: { $gte: startDate, $lte: endDate } }),
  ]);

  const holidaySet = new Set(holidays.map((h) => h.date));
  const workingDays = getWorkingDays(startDate, endDate, holidaySet);
  const totalWorkingDays = workingDays.length;

  const entryMap = new Map(entries.map((e) => [e.date, {
    status: e.status,
    leaveDuration: e.leaveDuration,
    workingPortion: e.workingPortion,
  }]));
  let officeDays = 0;
  let leaveDays = 0;
  for (const d of workingDays) {
    const entry = entryMap.get(d);
    if (!entry) continue;
    if (entry.status === 'office') {
      officeDays++;
    } else if (entry.status === 'leave') {
      if (entry.leaveDuration === 'half') {
        // Half-day leave = 0.5 leave day
        leaveDays += 0.5;
        // Working portion contributes to office or wfh
        if (entry.workingPortion === 'office') {
          officeDays += 0.5;
        }
      } else {
        leaveDays++;
      }
    }
  }
  const wfhDays = totalWorkingDays - officeDays - leaveDays;
  const officePercent = totalWorkingDays > 0
    ? Math.round((officeDays / totalWorkingDays) * 100)
    : 0;

  return {
    stats: { totalWorkingDays, officeDays, leaveDays, wfhDays, officePercent },
    workingDays,
    entryMap,
  };
}

/* ================================================================== */
/*  Personal Office Percentage (for My Calendar banner)               */
/*  GET /api/analytics/my-percentage?month=MM&year=YYYY               */
/* ================================================================== */

export const getMyPercentage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);

    if (!month || !year || month < 1 || month > 12 || year < 2000 || year > 2100) {
      res.status(400).json({ success: false, message: 'Valid month (1-12) and year (2000-2100) required' });
      return;
    }

    const userId = req.user!._id;
    const { startDate, endDate } = getMonthRange(year, month);
    const { stats } = await computeAttendanceStats(userId, startDate, endDate);

    res.json({
      success: true,
      data: {
        month,
        year,
        ...stats,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ================================================================== */
/*  Chat Analytics — unified handler for chatbot data queries         */
/*  POST /api/analytics/chat-query                                    */
/*  Body: { question: string }                                        */
/* ================================================================== */

/**
 * Intent classification and structured query resolution.
 * No text-to-SQL — all queries resolve to structured parameters.
 */

type Intent =
  | 'personal_attendance'
  | 'team_presence'
  | 'team_analytics'
  | 'event_query'
  | 'unknown';

interface DateRange {
  startDate: string;
  endDate: string;
  label: string;
}

/** Classify the user query intent. */
function classifyIntent(question: string): Intent {
  const q = question.toLowerCase();

  // Event queries
  if (
    /\b(event|party|town hall|offsite|mandatory office|highlighted|company event|deadline|office closed)\b/.test(q)
  ) {
    return 'event_query';
  }

  // Personal attendance
  if (
    /\b(my|i(?=\s|$)|i'm|am i|do i)\b/.test(q) &&
    /\b(office|leave|wfh|work from home|attendance|percentage|percent|days|schedule|coming|in office|mostly)\b/.test(q)
  ) {
    return 'personal_attendance';
  }

  // Team analytics (aggregated)
  if (
    /\b(most|least|highest|lowest|busiest|peak|which day|how many people|how many employees|maximum|minimum|everyone|all)\b/.test(q) &&
    /\b(office|attendance|presence|in office|coming)\b/.test(q)
  ) {
    return 'team_analytics';
  }

  // Team presence (specific person or "who is")
  if (
    /\b(who is|who's|is \w+(?=\s|$)|when is|when's|when will|where is|\w+ coming|list .* office|list .* leave)\b/.test(q) &&
    /\b(office|leave|wfh|tomorrow|today|monday|tuesday|wednesday|thursday|friday|next week|next month|this week|this month)\b/.test(q)
  ) {
    return 'team_presence';
  }

  // Broader team presence catch
  if (/\b(who|is \w+)\b/.test(q) && /\b(office|leave|wfh|in|on)\b/.test(q)) {
    return 'team_presence';
  }

  // Broader personal catch
  if (/\b(my|i(?=\s|$))\b/.test(q) && /\b(calendar|schedule|office|leave)\b/.test(q)) {
    return 'personal_attendance';
  }

  return 'unknown';
}

/** Resolve a time period from the question text. */
function resolveTimePeriod(question: string): DateRange {
  const q = question.toLowerCase();
  const todayStr = getTodayString();
  const today = new Date(todayStr + 'T00:00:00');
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-based

  // Tomorrow
  if (/\btomorrow\b/.test(q)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    const dateStr = formatAsISO(d);
    return { startDate: dateStr, endDate: dateStr, label: 'tomorrow' };
  }

  // Today
  if (/\btoday\b/.test(q)) {
    return { startDate: todayStr, endDate: todayStr, label: 'today' };
  }

  // Specific day of week (e.g., "on Monday", "on Friday")
  const dayMatch = q.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (dayMatch) {
    const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayMatch[1]);
    const isNextWeek = /\bnext week\b/.test(q);
    const isNextMonth = /\bnext month\b/.test(q);

    if (isNextMonth) {
      // Find the first occurrence of that day in next month
      const nm = new Date(currentYear, currentMonth + 1, 1);
      const firstDayOfMonth = nm.getDay();
      const offset = (targetDay - firstDayOfMonth + 7) % 7;
      nm.setDate(nm.getDate() + offset);
      const dateStr = formatAsISO(nm);
      return { startDate: dateStr, endDate: dateStr, label: `${dayMatch[1]} next month` };
    }

    // Find the next occurrence of that day
    const d = new Date(today);
    if (isNextWeek) {
      // Jump to next Monday first
      const currentDay = d.getDay();
      const daysUntilNextMonday = ((8 - currentDay) % 7) || 7;
      d.setDate(d.getDate() + daysUntilNextMonday);
      // Then find the target day within that week
      const mondayDay = d.getDay();
      const offset = (targetDay - mondayDay + 7) % 7;
      d.setDate(d.getDate() + offset);
    } else {
      // Just find next occurrence
      const currentDay = d.getDay();
      let daysAhead = targetDay - currentDay;
      if (daysAhead <= 0) daysAhead += 7;
      d.setDate(d.getDate() + daysAhead);
    }

    const dateStr = formatAsISO(d);
    return { startDate: dateStr, endDate: dateStr, label: `${dayMatch[1]}` };
  }

  // Next week
  if (/\bnext week\b/.test(q)) {
    const d = new Date(today);
    const currentDay = d.getDay();
    const daysUntilNextMonday = ((8 - currentDay) % 7) || 7;
    d.setDate(d.getDate() + daysUntilNextMonday);
    const monday = formatAsISO(d);
    d.setDate(d.getDate() + 4);
    const friday = formatAsISO(d);
    return { startDate: monday, endDate: friday, label: 'next week' };
  }

  // This week
  if (/\bthis week\b/.test(q)) {
    const d = new Date(today);
    const currentDay = d.getDay();
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    d.setDate(d.getDate() + mondayOffset);
    const monday = formatAsISO(d);
    d.setDate(d.getDate() + 4);
    const friday = formatAsISO(d);
    return { startDate: monday, endDate: friday, label: 'this week' };
  }

  // Next month
  if (/\bnext month\b/.test(q)) {
    const nm = new Date(currentYear, currentMonth + 1, 1);
    const range = getMonthRange(nm.getFullYear(), nm.getMonth() + 1);
    return { ...range, label: 'next month' };
  }

  // This month (default)
  const range = getMonthRange(currentYear, currentMonth + 1);
  return { ...range, label: 'this month' };
}

function formatAsISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Extract a person's name from the question for team presence queries. */
function extractPersonName(question: string): string | null {
  const q = question.toLowerCase();

  // Patterns like "is john on leave", "when is Ankit coming", "is Ankit in office"
  const patterns = [
    /\bis\s+(\w+)\s+(on|in|coming|going)/i,
    /\bwhen\s+is\s+(\w+)\s+(coming|going|in)/i,
    /\bwhen\s+will\s+(\w+)\s+(be|come)/i,
    /\bwhere\s+is\s+(\w+)/i,
    /\b(\w+)\s+coming\s+to\s+office/i,
    /\bis\s+(\w+)\s+on\s+leave/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match) {
      const name = match[1].toLowerCase();
      // Filter out common words
      const stopWords = ['there', 'anyone', 'everyone', 'the', 'any', 'most', 'many', 'that', 'this', 'next', 'all'];
      if (!stopWords.includes(name)) {
        return name;
      }
    }
  }

  return null;
}

/** Escape regex-special characters in a string for safe use in $regex / RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ================================================================== */
/*  Handlers per intent                                               */
/* ================================================================== */

async function handlePersonalAttendance(
  question: string,
  userId: string
): Promise<string> {
  const { startDate, endDate, label } = resolveTimePeriod(question);
  const { stats, workingDays, entryMap } = await computeAttendanceStats(userId, startDate, endDate);
  const { totalWorkingDays, officeDays, leaveDays, wfhDays, officePercent } = stats;

  const q = question.toLowerCase();

  // Single-day questions
  if (label === 'today' || label === 'tomorrow') {
    if (workingDays.length === 0) {
      return `${label === 'today' ? 'Today' : 'Tomorrow'} is not a working day (it may be a weekend or holiday).`;
    }
    const entry = entryMap.get(workingDays[0]);
    if (entry?.status === 'office') return `Yes, you are scheduled to be in the office ${label}.`;
    if (entry?.status === 'leave') {
      if (entry.leaveDuration === 'half') {
        const portion = entry.workingPortion === 'office' ? 'in the office' : 'working from home';
        return `You are on half-day leave ${label}. You'll be ${portion} for the remaining half.`;
      }
      return `You are on leave ${label}.`;
    }
    return `You are working from home (WFH) ${label} — no office or leave entry found.`;
  }

  // Percentage question
  if (/percent|%/.test(q)) {
    return `Your in-office percentage ${label} is ${officePercent}%.\n\nYou are scheduled to be in the office for ${officeDays} of ${totalWorkingDays} working days.`;
  }

  // "How many office days"
  if (/how many.*office/i.test(q)) {
    return `You have ${officeDays} office days ${label} (out of ${totalWorkingDays} working days, ${officePercent}%).`;
  }

  // "How many leave days"
  if (/how many.*leave/i.test(q)) {
    return `You have ${leaveDays} leave days ${label} (out of ${totalWorkingDays} working days).`;
  }

  // "Am I mostly WFH"
  if (/mostly.*wfh|mostly.*work from home/i.test(q)) {
    const isWfhDominant = wfhDays > officeDays && wfhDays > leaveDays;
    if (isWfhDominant) {
      return `Yes, you are mostly working from home ${label}. You have ${wfhDays} WFH days, ${officeDays} office days, and ${leaveDays} leave days out of ${totalWorkingDays} working days.`;
    }
    return `No, you are not mostly WFH ${label}. You have ${officeDays} office days, ${wfhDays} WFH days, and ${leaveDays} leave days out of ${totalWorkingDays} working days.`;
  }

  // General summary
  return `Here's your attendance summary for ${label}:\n\n• Office: ${officeDays} days (${officePercent}%)\n• WFH: ${wfhDays} days\n• Leave: ${leaveDays} days\n• Total working days: ${totalWorkingDays}\n\nNote: Half-day leave counts as 0.5 leave day, with the working portion contributing to office or WFH.`;
}

async function handleTeamPresence(question: string): Promise<string> {
  const { startDate, endDate, label } = resolveTimePeriod(question);
  const q = question.toLowerCase();

  // Check if asking about a specific person
  const personName = extractPersonName(question);

  if (personName) {
    // Find user by name (case-insensitive partial match)
    const users = await User.find({
      isActive: true,
      name: { $regex: escapeRegExp(personName), $options: 'i' },
    }).select('name email');

    if (users.length === 0) {
      return `I couldn't find anyone named "${personName}" in the team. Please check the name and try again.`;
    }

    if (users.length > 1) {
      const names = users.map((u) => u.name).join(', ');
      return `I found multiple people matching "${personName}": ${names}. Could you be more specific?`;
    }

    const targetUser = users[0];
    const entries = await Entry.find({
      userId: targetUser._id,
      date: { $gte: startDate, $lte: endDate },
    });

    const holidays = await Holiday.find({ date: { $gte: startDate, $lte: endDate } });
    const holidaySet = new Set(holidays.map((h) => h.date));
    const workingDays = getWorkingDays(startDate, endDate, holidaySet);
    const entryMap = new Map(entries.map((e) => [e.date, e.status]));

    // Single day
    if (startDate === endDate && workingDays.length > 0) {
      const entry = entries.find((e) => e.date === startDate);
      const status = entry?.status;
      if (status === 'office') return `${targetUser.name} is scheduled to be in the office on ${formatDateNice(startDate)}.`;
      if (status === 'leave') {
        if (entry?.leaveDuration === 'half') {
          const wp = entry?.workingPortion === 'office' ? 'in the office' : 'working from home';
          return `${targetUser.name} is on half-day leave on ${formatDateNice(startDate)}, and ${wp} for the remaining half.`;
        }
        return `${targetUser.name} is on leave on ${formatDateNice(startDate)}.`;
      }
      return `${targetUser.name} is working from home (WFH) on ${formatDateNice(startDate)}.`;
    }

    // Multi-day: list office days
    const officeDates = workingDays.filter((d) => entryMap.get(d) === 'office');
    const leaveDates = workingDays.filter((d) => entryMap.get(d) === 'leave');

    if (/leave/.test(q)) {
      if (leaveDates.length === 0) {
        return `${targetUser.name} has no leave days ${label}.`;
      }
      const dateList = leaveDates.map((d) => `• ${formatDateNice(d)}`).join('\n');
      return `${targetUser.name}'s leave days ${label}:\n${dateList}`;
    }

    if (/office|coming/.test(q)) {
      if (officeDates.length === 0) {
        return `${targetUser.name} has no office days planned ${label}.`;
      }
      const dateList = officeDates.map((d) => `• ${formatDateNice(d)}`).join('\n');
      return `${targetUser.name}'s office days ${label} (${officeDates.length} days):\n${dateList}`;
    }

    // General
    return `${targetUser.name}'s schedule ${label}: ${officeDates.length} office, ${leaveDates.length} leave, ${workingDays.length - officeDates.length - leaveDates.length} WFH out of ${workingDays.length} working days.`;
  }

  // "Who is in office today/tomorrow/on <date>"
  if (/who/.test(q)) {
    const users = await User.find({ isActive: true }).select('name');
    const entries = await Entry.find({ date: { $gte: startDate, $lte: endDate } });
    const holidays = await Holiday.find({ date: { $gte: startDate, $lte: endDate } });
    const holidaySet = new Set(holidays.map((h) => h.date));
    const workingDays = getWorkingDays(startDate, endDate, holidaySet);

    if (workingDays.length === 0) {
      return `There are no working days in the requested period (${label}). It may be a weekend or holiday.`;
    }

    // For single-day queries
    if (workingDays.length === 1) {
      const date = workingDays[0];

      const officeUsers: string[] = [];
      const leaveUsers: string[] = [];
      const wfhUsers: string[] = [];

      users.forEach((u) => {
        const uid = u._id.toString();
        const entry = entries.find((e) => e.date === date && e.userId.toString() === uid);
        const status = entry?.status;
        if (status === 'office') {
          officeUsers.push(u.name);
        } else if (status === 'leave') {
          if (entry?.leaveDuration === 'half') {
            const wp = entry?.workingPortion === 'office' ? 'office' : 'WFH';
            leaveUsers.push(`${u.name} (½ leave, ${wp} other half)`);
          } else {
            leaveUsers.push(u.name);
          }
        } else {
          wfhUsers.push(u.name);
        }
      });

      if (/leave/.test(q)) {
        if (leaveUsers.length === 0) return `No one is on leave on ${formatDateNice(date)}.`;
        return `People on leave on ${formatDateNice(date)} (${leaveUsers.length}):\n${leaveUsers.map((n) => `• ${n}`).join('\n')}`;
      }

      if (officeUsers.length === 0) {
        return `No one is scheduled to be in the office on ${formatDateNice(date)}.`;
      }
      return `People in office on ${formatDateNice(date)} (${officeUsers.length}):\n${officeUsers.map((n) => `• ${n}`).join('\n')}`;
    }

    // Multi-day: list count per day
    const entryByDate = new Map<string, Map<string, string>>();
    entries.forEach((e) => {
      if (!entryByDate.has(e.date)) entryByDate.set(e.date, new Map());
      entryByDate.get(e.date)!.set(e.userId.toString(), e.status);
    });

    const lines = workingDays.map((d) => {
      const dateEntries = entryByDate.get(d) || new Map();
      let officeCount = 0;
      dateEntries.forEach((status) => {
        if (status === 'office') officeCount++;
      });
      return `• ${formatDateNice(d)}: ${officeCount} in office`;
    });

    return `Office attendance ${label}:\n${lines.join('\n')}`;
  }

  return `I understood you're asking about team presence ${label}, but I need a bit more detail. Try asking "Who is in office today?" or "Is [name] on leave tomorrow?"`;
}

async function handleTeamAnalytics(question: string): Promise<string> {
  const { startDate, endDate, label } = resolveTimePeriod(question);
  const q = question.toLowerCase();

  const [users, holidays, entries] = await Promise.all([
    User.find({ isActive: true }).select('name'),
    Holiday.find({ date: { $gte: startDate, $lte: endDate } }).select('date'),
    Entry.find({ date: { $gte: startDate, $lte: endDate } }).select('userId date status'),
  ]);

  const holidaySet = new Set(holidays.map((h) => h.date));
  const workingDays = getWorkingDays(startDate, endDate, holidaySet);
  const totalWorkingDays = workingDays.length;

  if (totalWorkingDays === 0) {
    return `There are no working days in the requested period (${label}).`;
  }

  // Count office attendance per day
  const dailyCounts: { date: string; count: number }[] = [];
  const entryByDate = new Map<string, Set<string>>();
  entries.forEach((e) => {
    if (e.status === 'office') {
      if (!entryByDate.has(e.date)) entryByDate.set(e.date, new Set());
      entryByDate.get(e.date)!.add(e.userId.toString());
    }
  });

  for (const d of workingDays) {
    const count = entryByDate.get(d)?.size || 0;
    dailyCounts.push({ date: d, count });
  }

  // Single-day "how many people on Friday"
  if (workingDays.length === 1) {
    const c = dailyCounts[0];
    return `${c.count} ${c.count === 1 ? 'person' : 'people'} ${c.count === 1 ? 'is' : 'are'} scheduled to be in the office on ${formatDateNice(c.date)} (out of ${users.length} team members).`;
  }

  // Multi-day "how many people" question
  if (/how many people|how many employees/.test(q)) {
    const total = dailyCounts.reduce((sum, d) => sum + d.count, 0);
    const avg = totalWorkingDays > 0 ? (total / totalWorkingDays).toFixed(1) : '0';
    const sorted = [...dailyCounts].sort((a, b) => b.count - a.count);
    const peak = sorted[0];
    const lines = dailyCounts.map((d) => `• ${formatDateNice(d.date)}: ${d.count} ${d.count === 1 ? 'person' : 'people'}`);
    return `Office attendance ${label} (${totalWorkingDays} working days, avg ${avg}/day, peak ${peak.count} on ${formatDateNice(peak.date)}):\n${lines.join('\n')}`;
  }

  // Least attendance
  if (/least|lowest|minimum|fewest/.test(q)) {
    dailyCounts.sort((a, b) => a.count - b.count);
    const minCount = dailyCounts[0].count;
    const minDays = dailyCounts.filter((d) => d.count === minCount);
    const daysList = minDays.map((d) => `• ${formatDateNice(d.date)} — ${d.count} ${d.count === 1 ? 'employee' : 'employees'}`).join('\n');
    return `The lowest office attendance ${label} is on:\n${daysList}`;
  }

  // Most/highest/busiest/peak attendance
  dailyCounts.sort((a, b) => b.count - a.count);
  const maxCount = dailyCounts[0].count;
  const maxDays = dailyCounts.filter((d) => d.count === maxCount);
  const daysList = maxDays.map((d) => `• ${formatDateNice(d.date)} — ${d.count} ${d.count === 1 ? 'employee' : 'employees'}`).join('\n');
  return `The highest office attendance ${label} is on:\n${daysList}`;
}

async function handleEventQuery(question: string): Promise<string> {
  const { startDate, endDate, label } = resolveTimePeriod(question);

  const events = await Event.find({
    date: { $gte: startDate, $lte: endDate },
  }).sort({ date: 1 });

  if (events.length === 0) {
    return `There are no events scheduled ${label}.`;
  }

  // Specific event type query
  const q = question.toLowerCase();
  if (/mandatory office|must be in office/.test(q)) {
    const mandatory = events.filter(
      (e) => e.eventType?.toLowerCase() === 'mandatory-office' || /mandatory/i.test(e.title)
    );
    if (mandatory.length === 0) {
      return `There are no mandatory office days ${label}.`;
    }
    const list = mandatory.map((e) => `• ${formatDateNice(e.date)}: ${e.title}${e.description ? ` — ${e.description}` : ''}`).join('\n');
    return `Mandatory office days ${label}:\n${list}`;
  }

  if (/team party|party/.test(q)) {
    const parties = events.filter(
      (e) => /party/i.test(e.title) || e.eventType?.toLowerCase() === 'team-party'
    );
    if (parties.length === 0) return `No team party events found ${label}.`;
    const list = parties.map((e) => `• ${formatDateNice(e.date)}: ${e.title}${e.description ? ` — ${e.description}` : ''}`).join('\n');
    return `Team party events ${label}:\n${list}`;
  }

  // General event listing
  const list = events.map(
    (e) => `• ${formatDateNice(e.date)}: ${e.title}${e.description ? ` — ${e.description}` : ''}${e.eventType ? ` [${e.eventType}]` : ''}`
  ).join('\n');

  return `Events ${label} (${events.length}):\n${list}`;
}

/* ================================================================== */
/*  Exported helper for chat integration                              */
/* ================================================================== */

/**
 * Classify the question and answer it if data-related.
 * Returns answer string, or null if the query should fall through to RAG.
 */
export async function classifyAndAnswer(
  question: string,
  user: { _id: any; name: string },
  precomputedIntent?: Intent
): Promise<string | null> {
  let intent: Intent = 'unknown';
  try {
    const q = question.trim();
    intent = precomputedIntent ?? classifyIntent(q);

    switch (intent) {
      case 'personal_attendance':
        return await handlePersonalAttendance(q, user._id.toString());
      case 'team_presence':
        return await handleTeamPresence(q);
      case 'team_analytics':
        return await handleTeamAnalytics(q);
      case 'event_query':
        return await handleEventQuery(q);
      default:
        return null;
    }
  } catch (err: any) {
    console.error('classifyAndAnswer error:', {
      question,
      intent,
      userId: user._id,
      userName: user.name,
      error: err.message,
      stack: err.stack,
    });
    return null;
  }
}

/* ================================================================== */
/*  Main chat query handler                                           */
/* ================================================================== */

export const chatQuery = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Question is required' });
      return;
    }

    const q = question.trim();
    const intent = classifyIntent(q);
    const answer = await classifyAndAnswer(q, {
      _id: req.user!._id,
      name: req.user!.name,
    }, intent);

    res.json({
      success: true,
      data: {
        intent,
        answer,
      },
    });
  } catch (error) {
    next(error);
  }
};
