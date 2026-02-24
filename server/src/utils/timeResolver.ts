/**
 * Stage 2 — Time Resolver
 *
 * Extracts and resolves time expressions from chat queries into
 * { startDate, endDate, label } date ranges.
 *
 * Extended from the original resolveTimePeriod() in analyticsController.
 */

import { getTodayString } from './date.js';
import { formatAsISO, parseDateStr, getMonthRange } from './workingDays.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface DateRange {
  startDate: string;
  endDate: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Month name lookup                                                 */
/* ------------------------------------------------------------------ */

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function todayDate(): { todayStr: string; today: Date; currentYear: number; currentMonth: number } {
  const todayStr = getTodayString();
  const today = new Date(todayStr + 'T00:00:00');
  return {
    todayStr,
    today,
    currentYear: today.getFullYear(),
    currentMonth: today.getMonth(), // 0-based
  };
}

function getQuarterRange(year: number, quarter: number): DateRange {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const { startDate } = getMonthRange(year, startMonth);
  const { endDate } = getMonthRange(year, endMonth);
  return { startDate, endDate, label: `Q${quarter} ${year}` };
}

/* ------------------------------------------------------------------ */
/*  Main resolver                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve a time expression from the question text.
 * Supports all original expressions + many new ones from the plan.
 */
export function resolveTimePeriod(question: string): DateRange {
  const q = question.toLowerCase();
  const { todayStr, today, currentYear, currentMonth } = todayDate();

  // ── "from X to Y" range ───────────────────────────────────────
  const rangeMatch = q.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) {
    return { startDate: rangeMatch[1], endDate: rangeMatch[2], label: `${rangeMatch[1]} to ${rangeMatch[2]}` };
  }

  // ── Explicit date literal YYYY-MM-DD ──────────────────────────
  const isoMatch = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return { startDate: isoMatch[1], endDate: isoMatch[1], label: isoMatch[1] };
  }

  // ── Yesterday ─────────────────────────────────────────────────
  if (/\byesterday\b/.test(q)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    const dateStr = formatAsISO(d);
    return { startDate: dateStr, endDate: dateStr, label: 'yesterday' };
  }

  // ── Tomorrow ──────────────────────────────────────────────────
  if (/\btomorrow\b/.test(q)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    const dateStr = formatAsISO(d);
    return { startDate: dateStr, endDate: dateStr, label: 'tomorrow' };
  }

  // ── Today ─────────────────────────────────────────────────────
  if (/\btoday\b/.test(q)) {
    return { startDate: todayStr, endDate: todayStr, label: 'today' };
  }

  // ── "past N days" / "last N days" (inclusive of today: N days total) ──
  const pastNMatch = q.match(/(?:past|last)\s+(\d+)\s+days/);
  if (pastNMatch) {
    const n = parseInt(pastNMatch[1], 10);
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1));
    return { startDate: formatAsISO(d), endDate: todayStr, label: `last ${n} days` };
  }

  // ── "next N days" (inclusive of today: N days total) ───────────
  const nextNMatch = q.match(/next\s+(\d+)\s+days/);
  if (nextNMatch) {
    const n = parseInt(nextNMatch[1], 10);
    const d = new Date(today);
    d.setDate(d.getDate() + (n - 1));
    return { startDate: todayStr, endDate: formatAsISO(d), label: `next ${n} days` };
  }

  // ── Specific day of week (e.g., "on Monday", "on Friday") ────
  const dayMatch = q.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (dayMatch) {
    const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayMatch[1]);
    const isNextWeek = /\bnext week\b/.test(q);
    const isLastWeek = /\blast week\b/.test(q);
    const isNextMonth = /\bnext month\b/.test(q);

    if (isNextMonth) {
      const nm = new Date(currentYear, currentMonth + 1, 1);
      const firstDayOfMonth = nm.getDay();
      const offset = (targetDay - firstDayOfMonth + 7) % 7;
      nm.setDate(nm.getDate() + offset);
      const dateStr = formatAsISO(nm);
      return { startDate: dateStr, endDate: dateStr, label: `${dayMatch[1]} next month` };
    }

    if (isLastWeek) {
      const d = new Date(today);
      const currentDay = d.getDay();
      const daysBack = ((currentDay - targetDay + 7) % 7) + 7;
      d.setDate(d.getDate() - daysBack);
      const dateStr = formatAsISO(d);
      return { startDate: dateStr, endDate: dateStr, label: `${dayMatch[1]} last week` };
    }

    const d = new Date(today);
    if (isNextWeek) {
      const currentDay = d.getDay();
      const daysUntilNextMonday = ((8 - currentDay) % 7) || 7;
      d.setDate(d.getDate() + daysUntilNextMonday);
      const mondayDay = d.getDay();
      const offset = (targetDay - mondayDay + 7) % 7;
      d.setDate(d.getDate() + offset);
    } else {
      const currentDay = d.getDay();
      let daysAhead = targetDay - currentDay;
      if (daysAhead < 0) daysAhead += 7;
      d.setDate(d.getDate() + daysAhead);
    }

    const dateStr = formatAsISO(d);
    return { startDate: dateStr, endDate: dateStr, label: `${dayMatch[1]}` };
  }

  // ── "last week" ───────────────────────────────────────────────
  if (/\blast week\b/.test(q)) {
    const d = new Date(today);
    const currentDay = d.getDay();
    // Go back to last Monday
    const daysBack = currentDay === 0 ? 6 : currentDay - 1;
    d.setDate(d.getDate() - daysBack - 7);
    const monday = formatAsISO(d);
    d.setDate(d.getDate() + 4);
    const friday = formatAsISO(d);
    return { startDate: monday, endDate: friday, label: 'last week' };
  }

  // ── Next week ─────────────────────────────────────────────────
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

  // ── This week ─────────────────────────────────────────────────
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

  // ── "last month" ──────────────────────────────────────────────
  if (/\blast month\b/.test(q)) {
    const pm = new Date(currentYear, currentMonth - 1, 1);
    const range = getMonthRange(pm.getFullYear(), pm.getMonth() + 1);
    return { ...range, label: 'last month' };
  }

  // ── Next month ────────────────────────────────────────────────
  if (/\bnext month\b/.test(q)) {
    const nm = new Date(currentYear, currentMonth + 1, 1);
    const range = getMonthRange(nm.getFullYear(), nm.getMonth() + 1);
    return { ...range, label: 'next month' };
  }

  // ── "this quarter" ────────────────────────────────────────────
  if (/\bthis quarter\b/.test(q)) {
    const quarter = Math.floor(currentMonth / 3) + 1;
    return getQuarterRange(currentYear, quarter);
  }

  // ── "last quarter" ────────────────────────────────────────────
  if (/\blast quarter\b/.test(q)) {
    let quarter = Math.floor(currentMonth / 3);
    let year = currentYear;
    if (quarter === 0) { quarter = 4; year--; }
    return getQuarterRange(year, quarter);
  }

  // ── "this year" ───────────────────────────────────────────────
  if (/\bthis year\b/.test(q)) {
    return { startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31`, label: 'this year' };
  }

  // ── "last year" ───────────────────────────────────────────────
  if (/\blast year\b/.test(q)) {
    const ly = currentYear - 1;
    return { startDate: `${ly}-01-01`, endDate: `${ly}-12-31`, label: 'last year' };
  }

  // ── Month name with optional date e.g. "March 10", "10th March" ──
  const monthDateMatch = q.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  );
  if (monthDateMatch) {
    const month = MONTH_NAMES[monthDateMatch[1].toLowerCase()];
    const day = parseInt(monthDateMatch[2], 10);
    let year = currentYear;
    // Validate date is real
    const dateObj = new Date(year, month - 1, day);
    if (
      dateObj.getFullYear() !== year ||
      dateObj.getMonth() !== month - 1 ||
      dateObj.getDate() !== day
    ) {
      // Invalid date (e.g., Feb 31) — fall through to other matchers
    } else {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { startDate: dateStr, endDate: dateStr, label: `${monthDateMatch[1]} ${day}` };
    }
  }

  // ── Reverse: "10th March" ────────────────────────────────────
  const reverseDateMatch = q.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i
  );
  if (reverseDateMatch) {
    const day = parseInt(reverseDateMatch[1], 10);
    const month = MONTH_NAMES[reverseDateMatch[2].toLowerCase()];
    const dateStr = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { startDate: dateStr, endDate: dateStr, label: `${reverseDateMatch[2]} ${day}` };
  }

  // ── Month name alone e.g. "in February" / "for March" ────────
  // Require contextual prefix for "may" to avoid false positives with the verb
  const monthOnlyMatch = q.match(
    /(?:(?:in|for|during|month of)\s+)(may)\b/i
  ) || q.match(
    /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i
  );
  if (monthOnlyMatch) {
    const month = MONTH_NAMES[monthOnlyMatch[1].toLowerCase()];
    // Default to current year
    const range = getMonthRange(currentYear, month);
    return { ...range, label: monthOnlyMatch[1] };
  }

  // ── Default: this month ───────────────────────────────────────
  const range = getMonthRange(currentYear, currentMonth + 1);
  return { ...range, label: 'this month' };
}

/**
 * Resolve time from LLM-extracted structured data, falling back to question text.
 */
export function resolveTimeFromExtracted(
  extracted: { timeRange?: string },
  questionText: string,
): DateRange {
  if (extracted.timeRange) {
    // If the LLM gives us an explicit range like "2026-03-01 to 2026-03-31"
    const rangeMatch = extracted.timeRange.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2})/);
    if (rangeMatch) {
      return { startDate: rangeMatch[1], endDate: rangeMatch[2], label: extracted.timeRange };
    }
    // Otherwise treat it as natural language
    return resolveTimePeriod(extracted.timeRange);
  }
  return resolveTimePeriod(questionText);
}
