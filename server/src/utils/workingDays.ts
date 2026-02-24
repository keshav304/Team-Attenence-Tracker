/**
 * Shared working-day utilities.
 * Extracted from analyticsController so they can be reused across the chat pipeline.
 */

import Holiday from '../models/Holiday.js';

/* ------------------------------------------------------------------ */
/*  Date helpers                                                      */
/* ------------------------------------------------------------------ */

/** Parse YYYY-MM-DD to { year, month, day } numbers. */
export function parseDateStr(d: string): { year: number; month: number; day: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { year: y, month: m, day };
}

/** Format a JS Date as YYYY-MM-DD (UTC-safe). */
export function formatAsISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Format date as a nice string like "Wednesday, Mar 4". */
export function formatDateNice(dateStr: string): string {
  const { year, month, day } = parseDateStr(dateStr);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** Get start and end of a month as YYYY-MM-DD. */
export function getMonthRange(year: number, month: number) {
  const mm = String(month).padStart(2, '0');
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`,
  };
}

/* ------------------------------------------------------------------ */
/*  Working days                                                       */
/* ------------------------------------------------------------------ */

/** Get working days (Mon-Fri, excluding holidays) within a date range. */
export function getWorkingDays(
  startDate: string,
  endDate: string,
  holidaySet: Set<string>,
): string[] {
  const days: string[] = [];
  const start = parseDateStr(startDate);
  const end = parseDateStr(endDate);
  const d = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const endD = new Date(Date.UTC(end.year, end.month - 1, end.day));

  while (d <= endD) {
    const dateStr = formatAsISO(d);
    const dow = d.getUTCDay();

    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) {
      days.push(dateStr);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/**
 * Fetch holiday dates in a range and build a Set<string>.
 * Convenience wrapper used by multiple pipeline stages.
 */
export async function getHolidaySet(
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  const holidays = await Holiday.find({ date: { $gte: startDate, $lte: endDate } });
  return new Set(holidays.map((h) => h.date));
}

/**
 * Get the day-of-week name (e.g. "Monday") for a YYYY-MM-DD string.
 */
export function getDayOfWeek(dateStr: string): string {
  const { year, month, day } = parseDateStr(dateStr);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}
