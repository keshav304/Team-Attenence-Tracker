/**
 * Date Tools — Deterministic tool functions for the Workbot agent.
 *
 * Architecture:
 *   LLM interprets user intent → selects a tool + parameters (typed JSON)
 *   → tool executes deterministically → returns concrete YYYY-MM-DD dates.
 *
 * Each tool is a pure function: same inputs always produce the same output.
 * The LLM never touches date arithmetic — it only picks the right tool.
 *
 * Adding a new capability = adding one tool function + one schema entry.
 * No regex patterns to maintain.
 */

import { toISTDateString } from './date.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/**
 * All supported tool names. The LLM picks one of these.
 */
export type DateToolName =
  | 'resolve_dates'
  | 'expand_month'
  | 'expand_weeks'
  | 'expand_working_days'
  | 'expand_day_of_week'
  | 'expand_multiple_days_of_week'
  | 'expand_range'
  | 'expand_alternate'
  | 'expand_half_month'
  | 'expand_except'
  | 'expand_first_weekday_per_week'
  | 'expand_last_weekday_per_week'
  | 'expand_every_nth'
  | 'expand_week_period'
  | 'expand_rest_of_month'
  // ── New generators (v2) ──
  | 'expand_specific_weeks'
  | 'expand_weekends'
  | 'expand_all_days'
  | 'expand_anchor_range'
  // ── Composite generators (v3) ──
  | 'expand_half_except_day'
  | 'expand_range_except_days'
  | 'expand_range_days_of_week'
  | 'expand_n_working_days_except'
  | 'expand_ordinal_day_of_week'
  | 'expand_month_except_weeks'
  // ── Composite generators (v4) ──
  | 'expand_month_except_range'
  | 'expand_range_alternate'
  | 'expand_n_days_from_ordinal';

/**
 * A tool call from the LLM: tool name + typed parameters.
 */
export interface DateToolCall {
  tool: DateToolName;
  params: Record<string, unknown>;
}

/**
 * Tool execution result.
 */
export interface DateToolResult {
  success: boolean;
  dates: string[];
  description: string;
  error?: string;
}

/**
 * Period reference — "next_month" or "this_month".
 * Resolved deterministically from today's date.
 */
export type PeriodRef = 'next_month' | 'this_month';

/**
 * Position qualifier for slicing.
 */
export type PositionRef = 'first' | 'last';

/**
 * Tool schema for LLM consumption.
 */
export interface ToolSchema {
  name: DateToolName;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    required?: boolean;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Pipeline / Modifier types (v2)                                    */
/* ------------------------------------------------------------------ */

/**
 * Modifier operation types applied to a generated date set.
 * Two categories:
 *   - exclude_* : remove matching dates (set subtraction)
 *   - filter_*  : keep only matching dates (set intersection)
 */
export type DateModifierType =
  | 'exclude_dates'
  | 'exclude_days_of_week'
  | 'exclude_range'
  | 'exclude_weeks'
  | 'exclude_working_days_count'
  | 'exclude_holidays'
  | 'filter_days_of_week'
  | 'filter_range'
  | 'filter_weekday_slice';

/**
 * A single modifier operation to apply to a date set.
 */
export interface DateModifier {
  type: DateModifierType;
  params: Record<string, unknown>;
}

/**
 * Result from pipeline execution (generator + modifiers).
 */
export interface DatePipelineResult {
  success: boolean;
  dates: string[];
  description: string;
  generatorResult: DateToolResult;
  modifierErrors: string[];
}

/* ------------------------------------------------------------------ */
/*  Internal date helpers                                             */
/* ------------------------------------------------------------------ */

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function fmtDate(d: Date): string {
  return toISTDateString(d);
}

function parsePeriod(today: Date, period: PeriodRef): { year: number; month: number } {
  switch (period) {
    case 'next_month': {
      const year = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
      const month = (today.getMonth() + 1) % 12;
      return { year, month };
    }
    case 'this_month':
      return { year: today.getFullYear(), month: today.getMonth() };
    default:
      throw new Error(`parsePeriod: unknown period "${period as string}". Expected "this_month" or "next_month".`);
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isWeekday(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

function allWeekdaysInMonth(year: number, month: number): string[] {
  const total = daysInMonth(year, month);
  const dates: string[] = [];
  for (let i = 1; i <= total; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }
  return dates;
}

function dayNameToNum(name: string): number {
  return DAY_MAP[name.toLowerCase()] ?? -1;
}

function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/** Calendar week number within a month: day 1-7 → week 1, 8-14 → week 2, etc. */
function calendarWeekOfMonth(dayOfMonth: number): number {
  return Math.ceil(dayOfMonth / 7);
}

/** All calendar days (including weekends) in a month. */
function allDaysInMonth(year: number, month: number): string[] {
  const total = daysInMonth(year, month);
  const dates: string[] = [];
  for (let i = 1; i <= total; i++) {
    dates.push(fmtDate(new Date(year, month, i)));
  }
  return dates;
}

/** Weekend days (Sat + Sun) in a month. */
function allWeekendsInMonth(year: number, month: number): string[] {
  const total = daysInMonth(year, month);
  const dates: string[] = [];
  for (let i = 1; i <= total; i++) {
    const d = new Date(year, month, i);
    if (isWeekend(d)) dates.push(fmtDate(d));
  }
  return dates;
}

/**
 * Find the Nth occurrence of a specific weekday in a month.
 * @param occurrence  Positive = from start (1 = first), Negative = from end (-1 = last).
 * @returns Day-of-month number, or null if not found.
 */
function getNthOccurrence(year: number, month: number, dayName: string, occurrence: number): number | null {
  const dayNum = dayNameToNum(dayName);
  if (dayNum === -1) return null;
  const total = daysInMonth(year, month);

  if (occurrence > 0) {
    let count = 0;
    for (let i = 1; i <= total; i++) {
      if (new Date(year, month, i).getDay() === dayNum) {
        count++;
        if (count === occurrence) return i;
      }
    }
  } else if (occurrence < 0) {
    const hits: number[] = [];
    for (let i = 1; i <= total; i++) {
      if (new Date(year, month, i).getDay() === dayNum) hits.push(i);
    }
    const idx = hits.length + occurrence; // -1 → last element
    if (idx >= 0 && idx < hits.length) return hits[idx];
  }
  return null;
}

/**
 * Group a sorted array of date strings by calendar week (Mon-Sun).
 * Returns Map<weekKey, dates[]> where weekKey is the Monday date string.
 */
function groupByWeek(dates: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const d of dates) {
    const [y, m, day] = d.split('-').map(Number);
    const date = new Date(y, m - 1, day);
    const dow = date.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(date);
    monday.setDate(date.getDate() + mondayOffset);
    const key = fmtDate(monday);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/*  Tool implementations                                             */
/* ------------------------------------------------------------------ */

/**
 * resolve_dates — Pass-through for explicit YYYY-MM-DD dates, "today", "tomorrow",
 * "next Monday", bare day names, etc.
 */
function resolveExplicitDates(
  today: Date,
  todayStr: string,
  params: { dates: string[] },
): DateToolResult {
  const resolved: string[] = [];
  const unknowns: string[] = [];

  for (const raw of params.dates) {
    const lower = raw.toLowerCase().trim();

    // Explicit YYYY-MM-DD — validate calendar correctness so that
    // impossible dates like "2025-02-30" are rejected as unknowns.
    const isoMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, yStr, mStr, dStr] = isoMatch;
      const y = Number(yStr), m = Number(mStr), d = Number(dStr);
      const probe = new Date(y, m - 1, d);
      if (probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d) {
        resolved.push(fmtDate(probe));
      } else {
        unknowns.push(raw);
      }
      continue;
    }
    if (lower === 'today') {
      resolved.push(todayStr);
      continue;
    }
    if (lower === 'tomorrow') {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      resolved.push(fmtDate(d));
      continue;
    }
    // "next Monday" — intentionally resolves to the next occurrence of the
    // named day, always skipping today (uses DAY_MAP for name → number).
    const nextMatch = lower.match(/^next\s+(\w+)$/);
    if (nextMatch && DAY_MAP[nextMatch[1]] !== undefined) {
      const target = DAY_MAP[nextMatch[1]];
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== target) d.setDate(d.getDate() + 1);
      resolved.push(fmtDate(d));
      continue;
    }
    // "this Friday" — always resolve to the current or next occurrence (never past)
    const thisMatch = lower.match(/^this\s+(\w+)$/);
    if (thisMatch && DAY_MAP[thisMatch[1]] !== undefined) {
      const target = DAY_MAP[thisMatch[1]];
      const d = new Date(today);
      let diff = target - d.getDay();
      // If diff is negative the target day has already passed this week;
      // advance to the next occurrence so we never return a past date.
      if (diff < 0) diff += 7;
      d.setDate(d.getDate() + diff);
      resolved.push(fmtDate(d));
      continue;
    }
    // Bare day name (e.g. "friday") — like "next {day}", intentionally
    // resolves to the next occurrence after today (skips today) via DAY_MAP.
    if (DAY_MAP[lower] !== undefined) {
      const target = DAY_MAP[lower];
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== target) d.setDate(d.getDate() + 1);
      resolved.push(fmtDate(d));
      continue;
    }

    // Token did not match any known pattern
    unknowns.push(raw);
  }

  const hasUnknowns = unknowns.length > 0;
  return {
    success: resolved.length > 0 && !hasUnknowns,
    dates: resolved,
    description: `Resolved ${resolved.length} explicit date(s)`,
    ...(hasUnknowns ? { error: `Unrecognized date tokens: ${unknowns.join(', ')}` } : {}),
  };
}

/**
 * expand_month — All weekdays in a month period.
 */
function expandMonth(
  today: Date,
  params: { period: PeriodRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const dates = allWeekdaysInMonth(year, month);
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `All ${dates.length} weekdays in ${monthName} ${year}`,
  };
}

/**
 * expand_weeks — First or last N weeks (calendar days) of a month.
 */
function expandWeeks(
  today: Date,
  params: { period: PeriodRef; count: number; position: PositionRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const calendarDays = params.count * 7;
  const dates: string[] = [];

  if (params.position === 'first') {
    const limit = Math.min(calendarDays, totalDays);
    for (let i = 1; i <= limit; i++) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) dates.push(fmtDate(d));
    }
  } else {
    const startDay = Math.max(1, totalDays - calendarDays + 1);
    for (let i = startDay; i <= totalDays; i++) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) dates.push(fmtDate(d));
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${params.position === 'first' ? 'First' : 'Last'} ${params.count} week(s) of ${monthName} ${year}: ${dates.length} weekdays`,
  };
}

/**
 * expand_working_days — First or last N working days (Mon-Fri) of a month.
 */
function expandWorkingDays(
  today: Date,
  params: { period: PeriodRef; count: number; position: PositionRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);

  if (params.position === 'first') {
    const dates: string[] = [];
    for (let i = 1; i <= totalDays && dates.length < params.count; i++) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) dates.push(fmtDate(d));
    }
    const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
    return {
      success: true,
      dates,
      description: `First ${params.count} working days of ${monthName} ${year}`,
    };
  } else {
    const allWeekdays = allWeekdaysInMonth(year, month);
    const startIdx = Math.max(0, allWeekdays.length - params.count);
    const dates = allWeekdays.slice(startIdx);
    const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
    return {
      success: true,
      dates,
      description: `Last ${params.count} working days of ${monthName} ${year}`,
    };
  }
}

/**
 * expand_day_of_week — Every occurrence of a specific day in a month.
 */
function expandDayOfWeek(
  today: Date,
  params: { period: PeriodRef; day: string },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const targetDay = dayNameToNum(params.day);
  if (targetDay === -1) {
    return { success: false, dates: [], description: '', error: `Unknown day name: ${params.day}` };
  }
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];
  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month, i);
    if (d.getDay() === targetDay) dates.push(fmtDate(d));
  }
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Every ${params.day} in ${monthName} ${year}: ${dates.length} dates`,
  };
}

/**
 * expand_multiple_days_of_week — Every occurrence of multiple day names in a month.
 */
function expandMultipleDaysOfWeek(
  today: Date,
  params: { period: PeriodRef; days: string[] },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const invalidNames = params.days.filter(d => dayNameToNum(d) === -1);
  const targetDays = params.days.map(d => dayNameToNum(d)).filter(n => n !== -1);
  if (targetDays.length === 0) {
    return { success: false, dates: [], description: '', error: `No valid day names in: ${params.days.join(', ')}` };
  }
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];
  const targetSet = new Set(targetDays);
  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month, i);
    if (targetSet.has(d.getDay())) dates.push(fmtDate(d));
  }
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  const errorMsg = invalidNames.length > 0 ? `Dropped invalid day names: ${invalidNames.join(', ')}` : undefined;
  return {
    success: true,
    dates,
    description: `Every ${params.days.join(', ')} in ${monthName} ${year}: ${dates.length} dates`,
    ...(errorMsg ? { error: errorMsg } : {}),
  };
}

/**
 * expand_range — Date range within a month (e.g., 5th to 20th).
 */
function expandRange(
  today: Date,
  params: { period: PeriodRef; start_day: number; end_day: number },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const clampedStart = Math.max(params.start_day, 1);
  const clampedEnd = Math.min(params.end_day, totalDays);
  const dates: string[] = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${monthName} ${clampedStart}–${clampedEnd}: ${dates.length} weekdays`,
  };
}

/**
 * expand_alternate — Every alternate (2nd) day or working day in a month.
 */
function expandAlternate(
  today: Date,
  params: { period: PeriodRef; type: 'calendar' | 'working' },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];

  if (params.type === 'calendar') {
    // Every other calendar day (1st, 3rd, 5th, ...) that is a weekday
    for (let i = 1; i <= totalDays; i += 2) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) dates.push(fmtDate(d));
    }
  } else {
    // Every other working day
    let toggle = true;
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) {
        if (toggle) dates.push(fmtDate(d));
        toggle = !toggle;
      }
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Every alternate ${params.type === 'working' ? 'working ' : ''}day in ${monthName}: ${dates.length} dates (starting from the 1st)`,
  };
}

/**
 * expand_half_month — First half (1st-15th) or second half (16th-end) of a month.
 */
function expandHalfMonth(
  today: Date,
  params: { period: PeriodRef; half: 'first' | 'second' },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];

  const start = params.half === 'first' ? 1 : 16;
  const end = params.half === 'first' ? 15 : totalDays;

  for (let i = start; i <= end; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${params.half === 'first' ? 'First' : 'Second'} half of ${monthName} ${year}: ${dates.length} weekdays`,
  };
}

/**
 * expand_except — All weekdays in a month except a specific day of week.
 */
function expandExcept(
  today: Date,
  params: { period: PeriodRef; exclude_day: string },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const excludeNum = dayNameToNum(params.exclude_day);
  if (excludeNum === -1) {
    return { success: false, dates: [], description: '', error: `Unknown day name: ${params.exclude_day}` };
  }
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];
  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d) && d.getDay() !== excludeNum) dates.push(fmtDate(d));
  }
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `All weekdays in ${monthName} except ${params.exclude_day}s: ${dates.length} dates`,
  };
}

/**
 * expand_first_weekday_per_week — The first weekday of each calendar week in a month.
 */
function expandFirstWeekdayPerWeek(
  today: Date,
  params: { period: PeriodRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];
  let currentWeekHasDate = false;

  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month, i);
    const dow = d.getDay();
    // New week starts on Monday or first day of month
    if (dow === 1 || i === 1) currentWeekHasDate = false;
    if (!currentWeekHasDate && isWeekday(d)) {
      dates.push(fmtDate(d));
      currentWeekHasDate = true;
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `First weekday of each week in ${monthName}: ${dates.length} dates`,
  };
}

/**
 * expand_week_period — Mon-Fri of "this week" or "next week".
 */
function expandWeekPeriod(
  today: Date,
  params: { week: 'this_week' | 'next_week' },
): DateToolResult {
  const d = new Date(today);
  const currentDay = d.getDay();
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const offset = params.week === 'next_week' ? 7 : 0;
  d.setDate(d.getDate() + diffToMonday + offset);

  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    dates.push(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }

  return {
    success: true,
    dates,
    description: `${params.week === 'next_week' ? 'Next' : 'This'} week (Mon-Fri): ${dates.length} days`,
  };
}

/**
 * expand_every_nth — Every Nth day of a month (weekdays only).
 * E.g. every 3rd day starting from 1 → days 1,4,7,10,...
 * E.g. every 2nd day starting from 2 → days 2,4,6,8,... (even-numbered dates)
 */
function expandEveryNth(
  today: Date,
  params: { period: PeriodRef; n: number; start_day?: number },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const startDay = params.start_day ?? 1;
  const n = params.n;
  const dates: string[] = [];

  for (let i = startDay; i <= totalDays; i += n) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Every ${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} day of ${monthName} starting from day ${startDay}: ${dates.length} weekday dates`,
  };
}

/**
 * expand_last_weekday_per_week — Last weekday (Mon-Fri) of each calendar week in a month.
 * Complements expand_first_weekday_per_week.
 */
function expandLastWeekdayPerWeek(
  today: Date,
  params: { period: PeriodRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];

  // Group days by ISO week, find last weekday in each
  const weekMap = new Map<number, Date>();
  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) {
      // Use ISO week number to group
      const weekStart = new Date(d);
      const dayOfWeek = d.getDay();
      // Calculate Monday of this week
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      weekStart.setDate(d.getDate() + mondayOffset);
      const weekKey = weekStart.getTime();
      // Always overwrite — last weekday wins
      weekMap.set(weekKey, new Date(d));
    }
  }

  // Sort by week key and collect dates
  const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) => a[0] - b[0]);
  for (const [, lastDay] of sortedWeeks) {
    dates.push(fmtDate(lastDay));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Last weekday of each week in ${monthName}: ${dates.length} dates`,
  };
}

/**
 * expand_rest_of_month — Remaining weekdays from tomorrow to end of current month.
 */
function expandRestOfMonth(
  today: Date,
): DateToolResult {
  const d = new Date(today);
  d.setDate(d.getDate() + 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const dates: string[] = [];

  while (d <= endOfMonth) {
    if (isWeekday(d)) dates.push(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }

  return {
    success: true,
    dates,
    description: `Rest of this month: ${dates.length} remaining weekdays`,
  };
}

/* ------------------------------------------------------------------ */
/*  New generator tools (v2)                                         */
/* ------------------------------------------------------------------ */

/**
 * expand_specific_weeks — Select specific calendar weeks of a month by number.
 * Week 1 = days 1-7, Week 2 = days 8-14, Week 3 = days 15-21, Week 4 = days 22-28, Week 5 = days 29-end.
 */
function expandSpecificWeeks(
  today: Date,
  params: { period: PeriodRef; weeks: number[] },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const total = daysInMonth(year, month);

  // Separate positive and negative week indices.
  // Positive: calendar weeks (1=days 1-7, 2=days 8-14, etc.)
  // Negative: counted from end (-1 = last 7 days, -2 = second-to-last 7 days)
  const positiveWeeks = new Set<number>();
  const negativeDays = new Set<number>(); // day-of-month numbers from negative weeks

  for (const w of params.weeks) {
    if (w > 0) {
      positiveWeeks.add(w);
    } else if (w < 0) {
      // -1 = last 7 calendar days, -2 = days (total-13) to (total-7), etc.
      const blockEnd = total + (w + 1) * 7; // -1 → total, -2 → total-7
      const blockStart = blockEnd - 6;       // 7 days in a week
      for (let i = Math.max(1, blockStart); i <= Math.min(total, blockEnd); i++) {
        negativeDays.add(i);
      }
    }
  }

  const dates: string[] = [];

  for (let i = 1; i <= total; i++) {
    const wk = calendarWeekOfMonth(i);
    if (positiveWeeks.has(wk) || negativeDays.has(i)) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) dates.push(fmtDate(d));
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Week(s) ${params.weeks.join(', ')} of ${monthName} ${year}: ${dates.length} weekdays`,
  };
}

/**
 * expand_weekends — All weekend days (Sat + Sun) in a month.
 */
function expandWeekends(
  today: Date,
  params: { period: PeriodRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const dates = allWeekendsInMonth(year, month);
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `All ${dates.length} weekend days in ${monthName} ${year}`,
  };
}

/**
 * expand_all_days — All calendar days (Mon-Sun, including weekends) in a month.
 */
function expandAllDays(
  today: Date,
  params: { period: PeriodRef },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const dates = allDaysInMonth(year, month);
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `All ${dates.length} calendar days in ${monthName} ${year}`,
  };
}

/**
 * expand_anchor_range — Date range anchored to the Nth occurrence of a weekday.
 *
 * Modes:
 *   - "on_and_after"  : from anchor to end of month (inclusive)
 *   - "on_and_before"  : from start of month to anchor (inclusive)
 *   - "after"          : from day after anchor to end of month
 *   - "before"         : from start of month to day before anchor
 *   - "between"        : from anchor to end anchor (inclusive) — requires end_day + end_occurrence
 *
 * Returns weekdays only by default.
 */
function expandAnchorRange(
  today: Date,
  params: {
    period: PeriodRef;
    anchor_day: string;
    anchor_occurrence: number;
    direction: 'on_and_after' | 'on_and_before' | 'after' | 'before' | 'between';
    end_day?: string;
    end_occurrence?: number;
  },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const total = daysInMonth(year, month);

  const anchorDayNum = getNthOccurrence(year, month, params.anchor_day, params.anchor_occurrence);
  if (anchorDayNum === null) {
    return {
      success: false, dates: [], description: '',
      error: `Could not find occurrence ${params.anchor_occurrence} of ${params.anchor_day} in the month`,
    };
  }

  let startDay: number;
  let endDay: number;

  if (params.direction === 'between') {
    if (!params.end_day || params.end_occurrence === undefined) {
      return { success: false, dates: [], description: '', error: 'direction "between" requires end_day and end_occurrence' };
    }
    const endDayNum = getNthOccurrence(year, month, params.end_day, params.end_occurrence);
    if (endDayNum === null) {
      return {
        success: false, dates: [], description: '',
        error: `Could not find occurrence ${params.end_occurrence} of ${params.end_day} in the month`,
      };
    }
    startDay = Math.min(anchorDayNum, endDayNum);
    endDay = Math.max(anchorDayNum, endDayNum);
  } else {
    switch (params.direction) {
      case 'on_and_after':
        startDay = anchorDayNum; endDay = total; break;
      case 'on_and_before':
        startDay = 1; endDay = anchorDayNum; break;
      case 'after':
        startDay = anchorDayNum + 1; endDay = total; break;
      case 'before':
        startDay = 1; endDay = anchorDayNum - 1; break;
      default:
        return { success: false, dates: [], description: '', error: `Unknown direction: ${params.direction}` };
    }
  }

  const dates: string[] = [];
  for (let i = Math.max(1, startDay); i <= Math.min(total, endDay); i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Anchor range (${params.direction}) in ${monthName} ${year}: ${dates.length} weekdays`,
  };
}

/* ------------------------------------------------------------------ */
/*  Composite generator tools (v3)                                    */
/* ------------------------------------------------------------------ */

/**
 * expand_half_except_day — First/second half of a month, excluding a specific day of week.
 * E.g. "first half except Fridays" → days 1-15 weekdays minus Fridays.
 */
function expandHalfExceptDay(
  today: Date,
  params: { period: PeriodRef; half: 'first' | 'second'; exclude_day: string },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const excludeNum = dayNameToNum(params.exclude_day);
  if (excludeNum === -1) {
    return { success: false, dates: [], description: '', error: `Unknown day name: ${params.exclude_day}` };
  }

  const start = params.half === 'first' ? 1 : 16;
  const end = params.half === 'first' ? 15 : totalDays;
  const dates: string[] = [];

  for (let i = start; i <= end; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d) && d.getDay() !== excludeNum) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${params.half === 'first' ? 'First' : 'Second'} half of ${monthName} ${year} except ${params.exclude_day}s: ${dates.length} weekdays`,
  };
}

/**
 * expand_range_except_days — Date range within a month, excluding specific days of week.
 * E.g. "days 1-21 except Mondays" or "first 3 weeks except Fridays".
 */
function expandRangeExceptDays(
  today: Date,
  params: { period: PeriodRef; start_day: number; end_day: number; exclude_days: string[] },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const clampedStart = Math.max(params.start_day, 1);
  const clampedEnd = Math.min(params.end_day, totalDays);
  const excludeNums = new Set(params.exclude_days.map(d => dayNameToNum(d)).filter(n => n !== -1));
  if (excludeNums.size === 0) {
    return { success: false, dates: [], description: '', error: `No valid day names in: ${params.exclude_days.join(', ')}` };
  }

  const dates: string[] = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d) && !excludeNums.has(d.getDay())) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${monthName} ${clampedStart}–${clampedEnd} except ${params.exclude_days.join(', ')}: ${dates.length} weekdays`,
  };
}

/**
 * expand_range_days_of_week — Only specific days of week within a date range.
 * E.g. "Mon-Wed in first 3 weeks" → days 1-21 filtered to Mon+Tue+Wed.
 */
function expandRangeDaysOfWeek(
  today: Date,
  params: { period: PeriodRef; start_day: number; end_day: number; days: string[] },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const clampedStart = Math.max(params.start_day, 1);
  const clampedEnd = Math.min(params.end_day, totalDays);
  const targetDays = new Set(params.days.map(d => dayNameToNum(d)).filter(n => n !== -1));
  if (targetDays.size === 0) {
    return { success: false, dates: [], description: '', error: `No valid day names in: ${params.days.join(', ')}` };
  }

  const dates: string[] = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    const d = new Date(year, month, i);
    if (targetDays.has(d.getDay())) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${params.days.join(', ')} in ${monthName} days ${clampedStart}–${clampedEnd}: ${dates.length} dates`,
  };
}

/**
 * expand_n_working_days_except — First/last N working days, excluding specific days of week.
 * E.g. "first 10 working days except Mondays".
 */
function expandNWorkingDaysExcept(
  today: Date,
  params: { period: PeriodRef; count: number; position: PositionRef; exclude_days: string[] },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const excludeNums = new Set(params.exclude_days.map(d => dayNameToNum(d)).filter(n => n !== -1));

  // First collect all working days, then filter, then take first/last N
  const allWorkingDays: string[] = [];
  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) allWorkingDays.push(fmtDate(d));
  }

  // Take first/last N working days
  const sliced = params.position === 'first'
    ? allWorkingDays.slice(0, params.count)
    : allWorkingDays.slice(-params.count);

  // Remove excluded days from the sliced set
  const dates = sliced.filter(dateStr => {
    const [y, m, day] = dateStr.split('-').map(Number);
    return !excludeNums.has(new Date(y, m - 1, day).getDay());
  });

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${params.position === 'first' ? 'First' : 'Last'} ${params.count} working days of ${monthName} except ${params.exclude_days.join(', ')}: ${dates.length} dates`,
  };
}

/**
 * expand_ordinal_day_of_week — The Nth occurrence of a weekday in a month.
 * E.g. "first Wednesday", "third Monday", "last Thursday".
 * Supports multiple ordinal+day pairs for commands like "first Wednesday and last Thursday".
 */
function expandOrdinalDayOfWeek(
  today: Date,
  params: { period: PeriodRef; ordinals: Array<{ ordinal: number; day: string }> },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const dates: string[] = [];
  const errors: string[] = [];

  for (const entry of params.ordinals) {
    const dayNum = getNthOccurrence(year, month, entry.day, entry.ordinal);
    if (dayNum !== null) {
      dates.push(fmtDate(new Date(year, month, dayNum)));
    } else {
      errors.push(`Could not find ordinal ${entry.ordinal} of ${entry.day}`);
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: dates.length > 0,
    dates: dates.sort(),
    description: `Ordinal day(s) of week in ${monthName} ${year}: ${dates.length} dates`,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  };
}

/**
 * expand_month_except_weeks — All weekdays in a month except specific calendar weeks.
 * E.g. "entire month except the second week".
 * Week numbering: week 1 = days 1-7, week 2 = days 8-14, etc.
 */
function expandMonthExceptWeeks(
  today: Date,
  params: { period: PeriodRef; exclude_weeks: number[] },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const total = daysInMonth(year, month);

  // Resolve negative week indices: -1 = last week, -2 = second-to-last, etc.
  const maxWeek = calendarWeekOfMonth(total);
  const resolvedExclude = new Set(
    params.exclude_weeks.map(w => (w < 0 ? maxWeek + 1 + w : w)),
  );

  // For negative indices, also exclude the last N*7 calendar days (same logic as expandSpecificWeeks)
  const negativeDays = new Set<number>();
  for (const w of params.exclude_weeks) {
    if (w < 0) {
      const absW = Math.abs(w);
      const startDay = Math.max(1, total - absW * 7 + 1);
      for (let d = startDay; d <= total; d++) negativeDays.add(d);
    }
  }

  const dates: string[] = [];
  for (let i = 1; i <= total; i++) {
    const wk = calendarWeekOfMonth(i);
    if (resolvedExclude.has(wk) || negativeDays.has(i)) continue;
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `All weekdays in ${monthName} ${year} except week(s) ${params.exclude_weeks.join(', ')}: ${dates.length} dates`,
  };
}

/**
 * expand_month_except_range — All weekdays in a month except those within a day range.
 * E.g. "all days except the 10th to 15th".
 */
function expandMonthExceptRange(
  today: Date,
  params: { period: PeriodRef; exclude_start: number; exclude_end: number },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const total = daysInMonth(year, month);
  const dates: string[] = [];

  for (let i = 1; i <= total; i++) {
    if (i >= params.exclude_start && i <= params.exclude_end) continue;
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `All weekdays in ${monthName} ${year} except days ${params.exclude_start}–${params.exclude_end}: ${dates.length} dates`,
  };
}

/**
 * expand_range_alternate — Alternate days within a specific day range.
 * E.g. "alternate days in the first half".
 * type: 'calendar' = every other calendar day, 'working' = every other working day.
 */
function expandRangeAlternate(
  today: Date,
  params: { period: PeriodRef; start_day: number; end_day: number; type: 'calendar' | 'working' },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const totalDays = daysInMonth(year, month);
  const clampedStart = Math.max(params.start_day, 1);
  const clampedEnd = Math.min(params.end_day, totalDays);
  const dates: string[] = [];

  if (params.type === 'calendar') {
    for (let i = clampedStart; i <= clampedEnd; i += 2) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) dates.push(fmtDate(d));
    }
  } else {
    let toggle = true;
    for (let i = clampedStart; i <= clampedEnd; i++) {
      const d = new Date(year, month, i);
      if (isWeekday(d)) {
        if (toggle) dates.push(fmtDate(d));
        toggle = !toggle;
      }
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `Every alternate ${params.type === 'working' ? 'working ' : ''}day in ${monthName} days ${clampedStart}–${clampedEnd}: ${dates.length} dates`,
  };
}

/**
 * expand_n_days_from_ordinal — N consecutive working days starting from an ordinal weekday.
 * E.g. "5 days starting from the first Wednesday".
 */
function expandNDaysFromOrdinal(
  today: Date,
  params: { period: PeriodRef; ordinal: number; day: string; count: number },
): DateToolResult {
  const { year, month } = parsePeriod(today, params.period);
  const anchorDay = getNthOccurrence(year, month, params.day, params.ordinal);
  if (anchorDay === null) {
    return {
      success: false,
      dates: [],
      description: '',
      error: `Could not find ordinal ${params.ordinal} of ${params.day}`,
    };
  }

  const totalDays = daysInMonth(year, month);
  const dates: string[] = [];
  let count = 0;
  for (let i = anchorDay; i <= totalDays && count < params.count; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) {
      dates.push(fmtDate(d));
      count++;
    }
  }

  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${params.count} working days from ordinal ${params.ordinal} ${params.day} in ${monthName}: ${dates.length} dates`,
  };
}

/* ------------------------------------------------------------------ */
/*  Tool parameter validation helper                                  */
/* ------------------------------------------------------------------ */

/** Param spec entry — either a simple type string or an object with type and optional enum. */
interface ParamSpec {
  type: string;
  enum?: readonly string[];
  /** When type is 'array', optionally enforce element type (e.g. 'string'). */
  elementType?: string;
}

/** Shorthand: plain string → ParamSpec with that type. */
function normalizeSpec(entry: string | ParamSpec): ParamSpec {
  return typeof entry === 'string' ? { type: entry } : entry;
}

/** Lightweight runtime type + enum check for tool params to avoid unsafe `as` casts. */
function validateToolParams(
  tool: string,
  p: Record<string, unknown>,
  spec: Record<string, string | ParamSpec>,
): void {
  for (const [key, rawEntry] of Object.entries(spec)) {
    const entry = normalizeSpec(rawEntry);
    const val = p[key];
    if (val === undefined || val === null) {
      throw new Error(`${tool}: missing required param "${key}"`);
    }
    if (entry.type === 'array') {
      if (!Array.isArray(val)) {
        throw new Error(`${tool}: param "${key}" must be an array, got ${typeof val}`);
      }
      // Validate element types if specified
      if (entry.elementType) {
        for (let i = 0; i < val.length; i++) {
          if (typeof val[i] !== entry.elementType) {
            throw new Error(
              `${tool}: param "${key}"[${i}] must be ${entry.elementType}, got ${typeof val[i]}`,
            );
          }
        }
      }
    } else if (typeof val !== entry.type) {
      throw new Error(`${tool}: param "${key}" must be ${entry.type}, got ${typeof val}`);
    }
    // Enum validation
    if (entry.enum && typeof val === 'string') {
      if (!entry.enum.includes(val)) {
        throw new Error(
          `${tool}: param "${key}" must be one of [${entry.enum.join(', ')}], got "${val}"`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Modifier system (v2)                                              */
/* ------------------------------------------------------------------ */

/**
 * Apply a single modifier to a date set, returning the transformed dates.
 * All modifiers are pure functions operating on string arrays.
 */
function applySingleModifier(
  dates: string[],
  modifier: DateModifier,
  context?: { holidays?: string[] },
): { dates: string[]; error?: string } {
  const p = modifier.params;

  try {
    switch (modifier.type) {

      /* ── Exclusions (set subtraction) ────────────────────────────── */

      case 'exclude_dates': {
        if (!Array.isArray(p.dates)) return { dates, error: 'exclude_dates: "dates" must be an array' };
        const excludeSet = new Set(p.dates as string[]);
        return { dates: dates.filter(d => !excludeSet.has(d)) };
      }

      case 'exclude_days_of_week': {
        if (!Array.isArray(p.days)) return { dates, error: 'exclude_days_of_week: "days" must be an array' };
        const dayNums = new Set((p.days as string[]).map(d => dayNameToNum(d)).filter(n => n !== -1));
        return {
          dates: dates.filter(d => {
            const [y, m, day] = d.split('-').map(Number);
            return !dayNums.has(new Date(y, m - 1, day).getDay());
          }),
        };
      }

      case 'exclude_range': {
        const startDay = p.start_day as number;
        const endDay = p.end_day as number;
        if (typeof startDay !== 'number' || typeof endDay !== 'number') {
          return { dates, error: 'exclude_range: "start_day" and "end_day" must be numbers' };
        }
        return {
          dates: dates.filter(d => {
            const day = parseInt(d.split('-')[2], 10);
            return day < startDay || day > endDay;
          }),
        };
      }

      case 'exclude_weeks': {
        if (!Array.isArray(p.weeks)) return { dates, error: 'exclude_weeks: "weeks" must be an array of numbers' };
        const weekSet = new Set(p.weeks as number[]);
        return {
          dates: dates.filter(d => {
            const day = parseInt(d.split('-')[2], 10);
            return !weekSet.has(calendarWeekOfMonth(day));
          }),
        };
      }

      case 'exclude_working_days_count': {
        const count = p.count as number;
        const position = p.position as string;
        if (typeof count !== 'number' || (position !== 'first' && position !== 'last')) {
          return { dates, error: 'exclude_working_days_count: "count" (number) and "position" (first|last) required' };
        }
        // Identify working days (Mon-Fri) within the dates
        const workingDays = dates.filter(d => {
          const [y, m, day] = d.split('-').map(Number);
          return isWeekday(new Date(y, m - 1, day));
        }).sort();
        const toExclude = new Set(
          position === 'first' ? workingDays.slice(0, count) : workingDays.slice(-count),
        );
        return { dates: dates.filter(d => !toExclude.has(d)) };
      }

      case 'exclude_holidays': {
        const holidays = (p.dates as string[] | undefined) ?? context?.holidays ?? [];
        const holidaySet = new Set(holidays);
        return { dates: dates.filter(d => !holidaySet.has(d)) };
      }

      /* ── Filters (set intersection — keep only matching) ─────────── */

      case 'filter_days_of_week': {
        if (!Array.isArray(p.days)) return { dates, error: 'filter_days_of_week: "days" must be an array' };
        const dayNums = new Set((p.days as string[]).map(d => dayNameToNum(d)).filter(n => n !== -1));
        if (dayNums.size === 0) return { dates, error: 'filter_days_of_week: no valid day names provided' };
        return {
          dates: dates.filter(d => {
            const [y, m, day] = d.split('-').map(Number);
            return dayNums.has(new Date(y, m - 1, day).getDay());
          }),
        };
      }

      case 'filter_range': {
        const startDay = p.start_day as number;
        const endDay = p.end_day as number;
        if (typeof startDay !== 'number' || typeof endDay !== 'number') {
          return { dates, error: 'filter_range: "start_day" and "end_day" must be numbers' };
        }
        return {
          dates: dates.filter(d => {
            const day = parseInt(d.split('-')[2], 10);
            return day >= startDay && day <= endDay;
          }),
        };
      }

      case 'filter_weekday_slice': {
        const count = p.count as number;
        const position = p.position as string;
        if (typeof count !== 'number' || (position !== 'first' && position !== 'last')) {
          return { dates, error: 'filter_weekday_slice: "count" (number) and "position" (first|last) required' };
        }
        // Group by week, keep first/last N from each group
        const weeks = groupByWeek(dates);
        const result: string[] = [];
        const sortedKeys = Array.from(weeks.keys()).sort();
        for (const key of sortedKeys) {
          const weekDates = weeks.get(key)!.sort();
          if (position === 'first') {
            result.push(...weekDates.slice(0, count));
          } else {
            result.push(...weekDates.slice(-count));
          }
        }
        return { dates: result.sort() };
      }

      default:
        return { dates, error: `Unknown modifier type: ${modifier.type}` };
    }
  } catch (err) {
    return { dates, error: `Modifier error (${modifier.type}): ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Apply an ordered list of modifiers to a date set.
 * Returns the final date set and any errors encountered.
 */
export function applyModifiers(
  dates: string[],
  modifiers: DateModifier[],
  context?: { holidays?: string[] },
): { dates: string[]; errors: string[] } {
  let current = dates;
  const errors: string[] = [];
  for (const mod of modifiers) {
    const result = applySingleModifier(current, mod, context);
    current = result.dates;
    if (result.error) errors.push(result.error);
  }
  return { dates: current.sort(), errors };
}

/* ------------------------------------------------------------------ */
/*  Tool dispatcher                                                   */
/* ------------------------------------------------------------------ */

/**
 * Execute a single tool call and return resolved dates.
 * Pure function — no side effects, no database access.
 */
export function executeDateTool(
  toolCall: DateToolCall,
  todayStr: string,
): DateToolResult {
  // Construct today's date from components so local getters reflect the
  // correct calendar date regardless of server timezone.
  const [yearStr, monthStr, dayStr] = todayStr.split('-');
  const today = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  const p = toolCall.params;

  try {
    switch (toolCall.tool) {
      case 'resolve_dates':
        validateToolParams('resolve_dates', p, { dates: { type: 'array', elementType: 'string' } });
        return resolveExplicitDates(today, todayStr, p as { dates: string[] });

      case 'expand_month':
      case 'expand_all_days': // alias — LLM sometimes hallucinates this name
        validateToolParams('expand_month', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
        });
        return expandMonth(today, p as { period: PeriodRef });

      case 'expand_weeks':
        validateToolParams('expand_weeks', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          count: 'number',
          position: { type: 'string', enum: ['first', 'last'] },
        });
        return expandWeeks(today, p as { period: PeriodRef; count: number; position: PositionRef });

      case 'expand_working_days':
        validateToolParams('expand_working_days', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          count: 'number',
          position: { type: 'string', enum: ['first', 'last'] },
        });
        return expandWorkingDays(today, p as { period: PeriodRef; count: number; position: PositionRef });

      case 'expand_day_of_week':
        validateToolParams('expand_day_of_week', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
        });
        return expandDayOfWeek(today, p as { period: PeriodRef; day: string });

      case 'expand_multiple_days_of_week':
        validateToolParams('expand_multiple_days_of_week', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          days: { type: 'array', elementType: 'string' },
        });
        return expandMultipleDaysOfWeek(today, p as { period: PeriodRef; days: string[] });

      case 'expand_range':
        validateToolParams('expand_range', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          start_day: 'number',
          end_day: 'number',
        });
        return expandRange(today, p as { period: PeriodRef; start_day: number; end_day: number });

      case 'expand_alternate':
        validateToolParams('expand_alternate', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          type: { type: 'string', enum: ['calendar', 'working'] },
        });
        return expandAlternate(today, p as { period: PeriodRef; type: 'calendar' | 'working' });

      case 'expand_half_month':
        validateToolParams('expand_half_month', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          half: { type: 'string', enum: ['first', 'second'] },
        });
        return expandHalfMonth(today, p as { period: PeriodRef; half: 'first' | 'second' });

      case 'expand_except':
        validateToolParams('expand_except', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          exclude_day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
        });
        return expandExcept(today, p as { period: PeriodRef; exclude_day: string });

      case 'expand_first_weekday_per_week':
        validateToolParams('expand_first_weekday_per_week', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
        });
        return expandFirstWeekdayPerWeek(today, p as { period: PeriodRef });

      case 'expand_last_weekday_per_week':
        validateToolParams('expand_last_weekday_per_week', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
        });
        return expandLastWeekdayPerWeek(today, p as { period: PeriodRef });

      case 'expand_every_nth':
        validateToolParams('expand_every_nth', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          n: 'number',
        });
        return expandEveryNth(today, p as { period: PeriodRef; n: number; start_day?: number });

      case 'expand_week_period':
        validateToolParams('expand_week_period', p, {
          week: { type: 'string', enum: ['this_week', 'next_week'] },
        });
        return expandWeekPeriod(today, p as { week: 'this_week' | 'next_week' });

      case 'expand_rest_of_month':
        return expandRestOfMonth(today);

      /* ── New generators (v2) ─────────────────────────────────────── */

      case 'expand_specific_weeks':
        validateToolParams('expand_specific_weeks', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          weeks: { type: 'array', elementType: 'number' },
        });
        return expandSpecificWeeks(today, p as { period: PeriodRef; weeks: number[] });

      case 'expand_weekends':
        validateToolParams('expand_weekends', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
        });
        return expandWeekends(today, p as { period: PeriodRef });

      case 'expand_all_days':
        validateToolParams('expand_all_days', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
        });
        return expandAllDays(today, p as { period: PeriodRef });

      case 'expand_anchor_range': {
        validateToolParams('expand_anchor_range', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          anchor_day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          anchor_occurrence: 'number',
          direction: { type: 'string', enum: ['on_and_after', 'on_and_before', 'after', 'before', 'between'] },
        });
        return expandAnchorRange(today, p as {
          period: PeriodRef;
          anchor_day: string;
          anchor_occurrence: number;
          direction: 'on_and_after' | 'on_and_before' | 'after' | 'before' | 'between';
          end_day?: string;
          end_occurrence?: number;
        });
      }

      /* ── Composite generators (v3) ────────────────────────────────── */

      case 'expand_half_except_day':
        validateToolParams('expand_half_except_day', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          half: { type: 'string', enum: ['first', 'second'] },
          exclude_day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
        });
        return expandHalfExceptDay(today, p as { period: PeriodRef; half: 'first' | 'second'; exclude_day: string });

      case 'expand_range_except_days':
        validateToolParams('expand_range_except_days', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          start_day: 'number',
          end_day: 'number',
          exclude_days: { type: 'array', elementType: 'string' },
        });
        return expandRangeExceptDays(today, p as { period: PeriodRef; start_day: number; end_day: number; exclude_days: string[] });

      case 'expand_range_days_of_week':
        validateToolParams('expand_range_days_of_week', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          start_day: 'number',
          end_day: 'number',
          days: { type: 'array', elementType: 'string' },
        });
        return expandRangeDaysOfWeek(today, p as { period: PeriodRef; start_day: number; end_day: number; days: string[] });

      case 'expand_n_working_days_except':
        validateToolParams('expand_n_working_days_except', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          count: 'number',
          position: { type: 'string', enum: ['first', 'last'] },
          exclude_days: { type: 'array', elementType: 'string' },
        });
        return expandNWorkingDaysExcept(today, p as { period: PeriodRef; count: number; position: PositionRef; exclude_days: string[] });

      case 'expand_ordinal_day_of_week': {
        validateToolParams('expand_ordinal_day_of_week', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          ordinals: { type: 'array' },
        });
        return expandOrdinalDayOfWeek(today, p as { period: PeriodRef; ordinals: Array<{ ordinal: number; day: string }> });
      }

      case 'expand_month_except_weeks':
        validateToolParams('expand_month_except_weeks', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          exclude_weeks: { type: 'array', elementType: 'number' },
        });
        return expandMonthExceptWeeks(today, p as { period: PeriodRef; exclude_weeks: number[] });

      /* ── Composite generators (v4) ────────────────────────────────── */

      case 'expand_month_except_range':
        validateToolParams('expand_month_except_range', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          exclude_start: 'number',
          exclude_end: 'number',
        });
        return expandMonthExceptRange(today, p as { period: PeriodRef; exclude_start: number; exclude_end: number });

      case 'expand_range_alternate':
        validateToolParams('expand_range_alternate', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          start_day: 'number',
          end_day: 'number',
          type: { type: 'string', enum: ['calendar', 'working'] },
        });
        return expandRangeAlternate(today, p as { period: PeriodRef; start_day: number; end_day: number; type: 'calendar' | 'working' });

      case 'expand_n_days_from_ordinal':
        validateToolParams('expand_n_days_from_ordinal', p, {
          period: { type: 'string', enum: ['next_month', 'this_month'] },
          ordinal: 'number',
          day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          count: 'number',
        });
        return expandNDaysFromOrdinal(today, p as { period: PeriodRef; ordinal: number; day: string; count: number });

      default:
        return {
          success: false,
          dates: [],
          description: '',
          error: `Unknown tool: ${toolCall.tool}`,
        };
    }
  } catch (err) {
    return {
      success: false,
      dates: [],
      description: '',
      error: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute multiple tool calls and merge all dates (deduped, sorted).
 */
export function executeDateTools(
  toolCalls: DateToolCall[],
  todayStr: string,
): { dates: string[]; results: DateToolResult[] } {
  const allDates = new Set<string>();
  const results: DateToolResult[] = [];

  for (const tc of toolCalls) {
    const result = executeDateTool(tc, todayStr);
    results.push(result);
    if (result.success) {
      for (const d of result.dates) allDates.add(d);
    }
  }

  return {
    dates: Array.from(allDates).sort(),
    results,
  };
}

/* ------------------------------------------------------------------ */
/*  Pipeline executor (v2)                                            */
/* ------------------------------------------------------------------ */

/**
 * Execute a generator tool call, then apply an ordered list of modifiers.
 *
 * Flow: generator → modifiers[0] → modifiers[1] → … → deduplicated sorted dates
 *
 * This is the primary entry point for complex multi-constraint instructions
 * where a single tool call is insufficient.
 *
 * @param toolCall    Generator tool call (produces the base date set)
 * @param modifiers   Optional modifier operations (filter/exclude)
 * @param todayStr    Today's date as YYYY-MM-DD
 * @param context     Optional context (e.g. holiday dates for exclude_holidays)
 */
export function executeDatePipeline(
  toolCall: DateToolCall,
  modifiers: DateModifier[],
  todayStr: string,
  context?: { holidays?: string[] },
): DatePipelineResult {
  // Step 1: Execute the generator
  const genResult = executeDateTool(toolCall, todayStr);
  if (!genResult.success) {
    return {
      success: false,
      dates: [],
      description: genResult.description,
      generatorResult: genResult,
      modifierErrors: [],
    };
  }

  // Step 2: Apply modifiers in order
  if (!modifiers || modifiers.length === 0) {
    return {
      success: true,
      dates: genResult.dates,
      description: genResult.description,
      generatorResult: genResult,
      modifierErrors: [],
    };
  }

  const { dates, errors } = applyModifiers(genResult.dates, modifiers, context);

  return {
    success: true,
    dates,
    description: `${genResult.description} → ${modifiers.length} modifier(s) applied → ${dates.length} dates`,
    generatorResult: genResult,
    modifierErrors: errors,
  };
}

/* ------------------------------------------------------------------ */
/*  Tool schemas for LLM prompt                                      */
/* ------------------------------------------------------------------ */

/**
 * Generate the tool schema documentation for inclusion in the LLM system prompt.
 * This is the contract between LLM and deterministic tools.
 */
export function getToolSchemaPrompt(): string {
  return `
AVAILABLE DATE TOOLS (GENERATORS):
Select one tool to generate the base date set. Each action MUST include a "toolCall" field.

1. resolve_dates
   Use for: Individual specific dates like "2026-03-05", "today", "tomorrow", "next Monday", "this Friday"
   Params: { "dates": ["2026-03-05", "next Monday", ...] }

2. expand_month
   Use for: "every weekday next month", "all weekdays this month", "next month", "this month"
   Returns weekdays (Mon–Fri) only.
   Params: { "period": "next_month" | "this_month" }

3. expand_weeks
   Use for: "first 2 weeks of next month", "last week of next month", "last 3 weeks of this month"
   Returns weekdays (Mon–Fri) only.
   Params: { "period": "next_month" | "this_month", "count": <number>, "position": "first" | "last" }

4. expand_working_days
   Use for: "first 10 working days of next month", "last 5 business days of this month"
   Returns weekdays (Mon–Fri) only.
   Params: { "period": "next_month" | "this_month", "count": <number>, "position": "first" | "last" }

5. expand_day_of_week
   Use for: "every Monday next month", "every Friday this month"
   Params: { "period": "next_month" | "this_month", "day": "monday" | "tuesday" | ... | "sunday" }

6. expand_multiple_days_of_week
   Use for: "every Monday and Wednesday next month", "Tuesday Thursday Friday of next month"
   Params: { "period": "next_month" | "this_month", "days": ["monday", "wednesday", ...] }

7. expand_range
   Use for: "5th to 20th of next month", "1st to 14th of this month", "days 10 to 25 of next month"
   Returns weekdays (Mon–Fri) only within the range.
   Params: { "period": "next_month" | "this_month", "start_day": <number>, "end_day": <number> }

8. expand_alternate
   Use for: "every alternate day next month", "every other working day this month"
   Params: { "period": "next_month" | "this_month", "type": "calendar" | "working" }
   Note: "calendar" = every 2nd calendar date (1st, 3rd, 5th, ...), keeping only weekdays. Use for: "alternate days", "every other day", "odd-numbered dates".
         "working" = every 2nd working day (skip one weekday, keep the next). Use for: "alternate weekdays", "every other weekday", "every other working day".

9. expand_half_month
   Use for: "first half of next month", "second half of this month"
   Returns weekdays (Mon–Fri) only.
   Params: { "period": "next_month" | "this_month", "half": "first" | "second" }
   Note: First half = days 1-15. Second half = days 16-end.

10. expand_except
    Use for: "every weekday next month except Fridays", "all weekdays this month except Mondays"
    Returns weekdays (Mon–Fri) only, excluding the specified day.
    Params: { "period": "next_month" | "this_month", "exclude_day": "friday" | "monday" | ... }

11. expand_first_weekday_per_week
    Use for: "first weekday of each week next month", "first working day of every week this month"
    Params: { "period": "next_month" | "this_month" }

12. expand_last_weekday_per_week
    Use for: "last weekday of each week next month", "last working day of every week this month", "last business day each week"
    Params: { "period": "next_month" | "this_month" }

13. expand_every_nth
    Use for: "every 3rd day next month", "every 5th day", "even-numbered dates" (n=2, start_day=2), "every Nth day starting from day X"
    Returns weekdays (Mon–Fri) only among the Nth-day sequence.
    Params: { "period": "next_month" | "this_month", "n": <number>, "start_day": <number, optional, default 1> }
    Note: Generates days start_day, start_day+n, start_day+2n, ... and keeps only weekdays.
    Example: "every 3rd day" → n=3, start_day=1 → days 1,4,7,10,13,...
    Example: "even-numbered dates" → n=2, start_day=2 → days 2,4,6,8,10,...

14. expand_week_period
    Use for: "next week", "this week" (Mon-Fri)
    Returns weekdays (Mon–Fri) only.
    Params: { "week": "next_week" | "this_week" }

15. expand_rest_of_month
    Use for: "rest of this month", "remaining days this month"
    Returns remaining weekdays (Mon–Fri) only.
    Params: {} (no parameters needed)

16. expand_specific_weeks
    Use for: "second week of next month", "week 3 of next month", "weeks 2 and 4 of next month", "first and last week"
    Week numbering: week 1 = days 1-7, week 2 = days 8-14, week 3 = days 15-21, week 4 = days 22-28, week 5 = days 29-end.
    Returns weekdays (Mon–Fri) only.
    Params: { "period": "next_month" | "this_month", "weeks": [2] or [2, 4] or [1, 5] etc. }

17. expand_weekends
    Use for: "every weekend next month", "all weekends this month", "only weekends", "Saturdays and Sundays"
    Returns ONLY Saturday + Sunday dates.
    Params: { "period": "next_month" | "this_month" }

18. expand_all_days
    Use for: "every single day next month including weekends", "all 7 days a week", "all calendar days"
    Returns ALL days (Mon-Sun) including weekends.
    Params: { "period": "next_month" | "this_month" }

19. expand_anchor_range
    Use for date ranges defined relative to occurrences of a weekday:
    - "after the first Monday of next month" → direction: "after"
    - "before the last Friday of next month" → direction: "before"
    - "starting from the second Wednesday" → direction: "on_and_after"
    - "until the first Friday" → direction: "on_and_before"
    - "between first Monday and last Friday" → direction: "between", end_day + end_occurrence required
    Returns weekdays (Mon–Fri) only.
    Params: {
      "period": "next_month" | "this_month",
      "anchor_day": "monday" | ... | "sunday",
      "anchor_occurrence": <number> (1 = first, 2 = second, -1 = last, -2 = second-last),
      "direction": "on_and_after" | "on_and_before" | "after" | "before" | "between",
      "end_day": "friday" (only for "between"),
      "end_occurrence": -1 (only for "between")
    }

──────────────────────────────────────────────────────────────────────────
MODIFIERS (optional — for complex multi-constraint commands):
Add a "modifiers" array to the action to transform the generator output.
Modifiers are applied in order. Use them for exclusions and filters.
Only add modifiers when the command includes exclusions, filters, or constraints beyond what a single tool provides.

EXCLUSION modifiers (remove matching dates):

M1. exclude_dates — Remove specific dates
    Params: { "dates": ["2026-03-10", "2026-03-15"] }
    Use for: "except March 10 and 15", "not on the 10th"

M2. exclude_days_of_week — Remove all occurrences of specific weekdays
    Params: { "days": ["wednesday", "friday"] }
    Use for: "except Wednesdays and Fridays", "no Mondays"

M3. exclude_range — Remove a day-number range
    Params: { "start_day": 1, "end_day": 7 }
    Use for: "except the first week" (days 1-7), "except days 10-15"

M4. exclude_weeks — Remove specific calendar weeks
    Params: { "weeks": [1] or [2, 4] }
    Week numbering: week 1 = days 1-7, week 2 = days 8-14, etc.
    Use for: "except the first week", "except weeks 2 and 4", "except the second week"

M5. exclude_working_days_count — Remove first/last N working days
    Params: { "count": 5, "position": "first" | "last" }
    Use for: "except the first 5 working days", "except the last 3 business days"

M6. exclude_holidays — Remove holiday dates (system provides the dates automatically)
    Params: {} (no params needed — holidays are injected by the system)
    Use for: "except holidays", "excluding public holidays"

FILTER modifiers (keep only matching dates):

M7. filter_days_of_week — Keep only specific weekdays
    Params: { "days": ["monday", "tuesday", "wednesday"] }
    Use for: "Monday to Wednesday each week", "only Tue-Thu"

M8. filter_range — Keep only dates in a day-number range
    Params: { "start_day": 1, "end_day": 15 }
    Use for: used internally to slice a generated set to a range

M9. filter_weekday_slice — Keep first/last N weekdays per calendar week
    Params: { "count": 2, "position": "first" | "last" }
    Use for: "first two weekdays of every week", "last 3 days of each week"

──────────────────────────────────────────────────────────────────────────
COMPOSITION EXAMPLES:

"All days next month except the first week":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [{ "type": "exclude_range", "params": { "start_day": 1, "end_day": 7 } }]

"All weekdays next month except Wednesdays and Fridays":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [{ "type": "exclude_days_of_week", "params": { "days": ["wednesday", "friday"] } }]

"First 10 working days except Mondays":
  toolCall: { "tool": "expand_working_days", "params": { "period": "next_month", "count": 10, "position": "first" } }
  modifiers: [{ "type": "exclude_days_of_week", "params": { "days": ["monday"] } }]

"All days next month except the last 10 days":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [{ "type": "exclude_range", "params": { "start_day": 22, "end_day": 31 } }]

"Alternate days in the first half except Fridays":
  toolCall: { "tool": "expand_alternate", "params": { "period": "next_month", "type": "calendar" } }
  modifiers: [
    { "type": "filter_range", "params": { "start_day": 1, "end_day": 15 } },
    { "type": "exclude_days_of_week", "params": { "days": ["friday"] } }
  ]

"Monday to Wednesday of each week next month":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [{ "type": "filter_days_of_week", "params": { "days": ["monday", "tuesday", "wednesday"] } }]

"First two weekdays of every week next month":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [{ "type": "filter_weekday_slice", "params": { "count": 2, "position": "first" } }]

"Entire month except the second week and Fridays":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [
    { "type": "exclude_weeks", "params": { "weeks": [2] } },
    { "type": "exclude_days_of_week", "params": { "days": ["friday"] } }
  ]

"All working days except public holidays":
  toolCall: { "tool": "expand_month", "params": { "period": "next_month" } }
  modifiers: [{ "type": "exclude_holidays", "params": {} }]

"Weeks 2 and 3 but only Mon-Wed":
  toolCall: { "tool": "expand_specific_weeks", "params": { "period": "next_month", "weeks": [2, 3] } }
  modifiers: [{ "type": "filter_days_of_week", "params": { "days": ["monday", "tuesday", "wednesday"] } }]

"After the second Friday of next month":
  toolCall: { "tool": "expand_anchor_range", "params": { "period": "next_month", "anchor_day": "friday", "anchor_occurrence": 2, "direction": "after" } }
  (no modifiers needed)

"Between first Monday and last Friday, except holidays":
  toolCall: { "tool": "expand_anchor_range", "params": { "period": "next_month", "anchor_day": "monday", "anchor_occurrence": 1, "direction": "between", "end_day": "friday", "end_occurrence": -1 } }
  modifiers: [{ "type": "exclude_holidays", "params": {} }]

IMPORTANT: Only use modifiers when the command has constraints beyond a single tool's capability.
Simple commands like "mark next month" need only a toolCall with NO modifiers.
PREFER composite tools (20-25) over generator+modifier when they match the command exactly.

──────────────────────────────────────────────────────────────────────────
COMPOSITE TOOLS (v3 — for commands with built-in exclusions/filters):
These tools handle multi-constraint commands in a single call.
ALWAYS prefer these over generator+modifier when they match the semantic intent.

20. expand_half_except_day
    Use for: "first half except Fridays", "second half except Mondays"
    Combines half-month selection with day-of-week exclusion in one tool.
    Params: { "period": "next_month" | "this_month", "half": "first" | "second", "exclude_day": "friday" | "monday" | ... }

21. expand_range_except_days
    Use for: "days 1-21 except Mondays", "first 3 weeks except Fridays", range + exclusion
    Combines date range with day-of-week exclusion.
    Params: { "period": "next_month" | "this_month", "start_day": <number>, "end_day": <number>, "exclude_days": ["monday", ...] }

22. expand_range_days_of_week
    Use for: "Mon-Wed in first 3 weeks", "Tue-Thu in days 1-14", specific days within a range
    Combines date range with day-of-week filtering.
    Params: { "period": "next_month" | "this_month", "start_day": <number>, "end_day": <number>, "days": ["monday", "tuesday", "wednesday"] }

23. expand_n_working_days_except
    Use for: "first 10 working days except Mondays", "last 15 working days except Fridays"
    Combines working-day count with day-of-week exclusion.
    Params: { "period": "next_month" | "this_month", "count": <number>, "position": "first" | "last", "exclude_days": ["monday", ...] }

24. expand_ordinal_day_of_week
    Use for: "first Wednesday", "third Monday", "last Thursday", "first Wednesday and last Thursday"
    Resolves Nth occurrence(s) of specific weekdays in a month.
    Params: { "period": "next_month" | "this_month", "ordinals": [{ "ordinal": 1, "day": "wednesday" }, { "ordinal": -1, "day": "thursday" }] }
    Note: ordinal 1 = first, 2 = second, 3 = third, -1 = last, -2 = second-to-last

25. expand_month_except_weeks
    Use for: "entire month except the second week", "all weekdays except weeks 1 and 3"
    All weekdays in a month minus specific calendar weeks.
    Params: { "period": "next_month" | "this_month", "exclude_weeks": [2] or [1, 3] }
    Week numbering: week 1 = days 1-7, week 2 = days 8-14, week 3 = days 15-21, week 4 = days 22-28, week 5 = days 29-end

──────────────────────────────────────────────────────────────────────────
COMPOSITE TOOLS (v4 — additional composite tools):

26. expand_month_except_range
    Use for: "all days except the 10th to 15th", "entire month except days 5-10"
    All weekdays in a month minus a specific day range.
    Params: { "period": "next_month" | "this_month", "exclude_start": <number>, "exclude_end": <number> }

27. expand_range_alternate
    Use for: "alternate days in the first half", "every other day from 1st to 15th"
    Alternate days within a specific day range.
    Params: { "period": "next_month" | "this_month", "start_day": <number>, "end_day": <number>, "type": "calendar" | "working" }
    type "calendar" = every other calendar day (1,3,5,...), "working" = every other working day

28. expand_n_days_from_ordinal
    Use for: "5 days starting from the first Wednesday", "3 working days from the second Monday"
    N consecutive working days starting from an ordinal weekday occurrence.
    Params: { "period": "next_month" | "this_month", "ordinal": <number>, "day": "wednesday" | ..., "count": <number> }
    ordinal: 1 = first, 2 = second, -1 = last

NOTE ON expand_specific_weeks:
    Supports NEGATIVE week indices: -1 = last week, -2 = second-to-last week.
    Use for: "first and last week" → weeks: [1, -1]

──────────────────────────────────────────────────────────────────────────
COMPOSITE TOOL EXAMPLES:

"First half except Fridays":
  toolCall: { "tool": "expand_half_except_day", "params": { "period": "next_month", "half": "first", "exclude_day": "friday" } }

"Mon-Wed in first 3 weeks":
  toolCall: { "tool": "expand_range_days_of_week", "params": { "period": "next_month", "start_day": 1, "end_day": 21, "days": ["monday", "tuesday", "wednesday"] } }

"First 10 working days except Mondays":
  toolCall: { "tool": "expand_n_working_days_except", "params": { "period": "next_month", "count": 10, "position": "first", "exclude_days": ["monday"] } }

"First Wednesday and last Thursday":
  toolCall: { "tool": "expand_ordinal_day_of_week", "params": { "period": "next_month", "ordinals": [{ "ordinal": 1, "day": "wednesday" }, { "ordinal": -1, "day": "thursday" }] } }

"Entire month except the second week":
  toolCall: { "tool": "expand_month_except_weeks", "params": { "period": "next_month", "exclude_weeks": [2] } }

"Days 1-21 except Fridays":
  toolCall: { "tool": "expand_range_except_days", "params": { "period": "next_month", "start_day": 1, "end_day": 21, "exclude_days": ["friday"] } }

"All days except the 10th to 15th":
  toolCall: { "tool": "expand_month_except_range", "params": { "period": "next_month", "exclude_start": 10, "exclude_end": 15 } }

"Alternate days in the first half":
  toolCall: { "tool": "expand_range_alternate", "params": { "period": "next_month", "start_day": 1, "end_day": 15, "type": "calendar" } }

"5 days starting from the first Wednesday":
  toolCall: { "tool": "expand_n_days_from_ordinal", "params": { "period": "next_month", "ordinal": 1, "day": "wednesday", "count": 5 } }

"First and last week":
  toolCall: { "tool": "expand_specific_weeks", "params": { "period": "next_month", "weeks": [1, -1] } }

──────────────────────────────────────────────────────────────────────────
TOOL SELECTION RULES (CRITICAL):

RULE 1: If the command contains BOTH a range/half/count concept AND an exclusion concept,
you MUST choose a composite tool (20-25) that handles both natively.
Do NOT use a simpler tool that ignores the exclusion.
INCORRECT: "first half except Fridays" → expand_half_month (WRONG — ignores "except Fridays")
CORRECT:   "first half except Fridays" → expand_half_except_day

RULE 2: Never use expand_month when the command specifies:
- specific days of week → use expand_day_of_week or expand_multiple_days_of_week
- specific date ranges → use expand_range
- specific counts → use expand_working_days
- specific halves → use expand_half_month
- ordinal days → use expand_ordinal_day_of_week

RULE 3: For "the Nth <dayname>" (ordinal references like "first Wednesday", "last Thursday"),
ALWAYS use expand_ordinal_day_of_week. Never try to compute the date yourself.

RULE 4: For "entire month except week N", ALWAYS use expand_month_except_weeks.
Do NOT use expand_month with modifiers for this pattern.

RULE 5: For "all days except days X to Y" or "month except the 10th to 15th",
ALWAYS use expand_month_except_range. Do NOT try multi-action composition.

RULE 6: For "alternate days in the first half" or "every other day from X to Y",
ALWAYS use expand_range_alternate. Do NOT use expand_alternate (that's for full month only).

RULE 7: For "N days starting from the first/last <dayname>",
ALWAYS use expand_n_days_from_ordinal.

RULE 8: For "first and last week", use expand_specific_weeks with weeks: [1, -1].
Negative indices: -1 = last week, -2 = second-to-last.

NEGATIVE EXAMPLES (DO NOT DO THIS):
✗ "first half except Fridays" → expand_half_month only (WRONG — ignores exclusion)
✗ "Mon-Wed first 3 weeks" → expand_multiple_days_of_week for full month (WRONG — ignores range)
✗ "first 10 working days except Mondays" → expand_working_days only (WRONG — ignores exclusion)
✗ "entire month except second week" → expand_month only (WRONG — ignores exclusion)
✗ "first Wednesday" → expand_day_of_week (WRONG — returns ALL Wednesdays)
`;
}