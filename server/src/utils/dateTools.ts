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
  | 'expand_week_period'
  | 'expand_rest_of_month';

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
  if (period === 'next_month') {
    const year = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
    const month = (today.getMonth() + 1) % 12;
    return { year, month };
  }
  return { year: today.getFullYear(), month: today.getMonth() };
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
  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const resolved: string[] = [];

  for (const raw of params.dates) {
    const lower = raw.toLowerCase().trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
      resolved.push(lower);
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
    // "next Monday"
    const nextMatch = lower.match(/^next\s+(\w+)$/);
    if (nextMatch && DAY_MAP[nextMatch[1]] !== undefined) {
      const target = DAY_MAP[nextMatch[1]];
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== target) d.setDate(d.getDate() + 1);
      resolved.push(fmtDate(d));
      continue;
    }
    // "this Friday"
    const thisMatch = lower.match(/^this\s+(\w+)$/);
    if (thisMatch && DAY_MAP[thisMatch[1]] !== undefined) {
      const target = DAY_MAP[thisMatch[1]];
      const d = new Date(today);
      const diff = target - d.getDay();
      d.setDate(d.getDate() + diff);
      resolved.push(fmtDate(d));
      continue;
    }
    // Bare day name → next occurrence
    if (DAY_MAP[lower] !== undefined) {
      const target = DAY_MAP[lower];
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== target) d.setDate(d.getDate() + 1);
      resolved.push(fmtDate(d));
      continue;
    }
  }

  return {
    success: resolved.length > 0,
    dates: resolved,
    description: `Resolved ${resolved.length} explicit date(s)`,
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
  return {
    success: true,
    dates,
    description: `Every ${params.days.join(', ')} in ${monthName} ${year}: ${dates.length} dates`,
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
  const clampedEnd = Math.min(params.end_day, totalDays);
  const dates: string[] = [];
  for (let i = params.start_day; i <= clampedEnd; i++) {
    const d = new Date(year, month, i);
    if (isWeekday(d)) dates.push(fmtDate(d));
  }
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });
  return {
    success: true,
    dates,
    description: `${monthName} ${params.start_day}–${clampedEnd}: ${dates.length} weekdays`,
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
  const today = new Date(todayStr + 'T00:00:00');
  const p = toolCall.params;

  try {
    switch (toolCall.tool) {
      case 'resolve_dates':
        return resolveExplicitDates(today, todayStr, p as { dates: string[] });

      case 'expand_month':
        return expandMonth(today, p as { period: PeriodRef });

      case 'expand_weeks':
        return expandWeeks(today, p as { period: PeriodRef; count: number; position: PositionRef });

      case 'expand_working_days':
        return expandWorkingDays(today, p as { period: PeriodRef; count: number; position: PositionRef });

      case 'expand_day_of_week':
        return expandDayOfWeek(today, p as { period: PeriodRef; day: string });

      case 'expand_multiple_days_of_week':
        return expandMultipleDaysOfWeek(today, p as { period: PeriodRef; days: string[] });

      case 'expand_range':
        return expandRange(today, p as { period: PeriodRef; start_day: number; end_day: number });

      case 'expand_alternate':
        return expandAlternate(today, p as { period: PeriodRef; type: 'calendar' | 'working' });

      case 'expand_half_month':
        return expandHalfMonth(today, p as { period: PeriodRef; half: 'first' | 'second' });

      case 'expand_except':
        return expandExcept(today, p as { period: PeriodRef; exclude_day: string });

      case 'expand_first_weekday_per_week':
        return expandFirstWeekdayPerWeek(today, p as { period: PeriodRef });

      case 'expand_week_period':
        return expandWeekPeriod(today, p as { week: 'this_week' | 'next_week' });

      case 'expand_rest_of_month':
        return expandRestOfMonth(today);

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
/*  Tool schemas for LLM prompt                                      */
/* ------------------------------------------------------------------ */

/**
 * Generate the tool schema documentation for inclusion in the LLM system prompt.
 * This is the contract between LLM and deterministic tools.
 */
export function getToolSchemaPrompt(): string {
  return `
AVAILABLE DATE TOOLS:
You MUST select one tool from this list and provide its parameters as a JSON object.
Each action MUST include a "toolCall" field instead of "dateExpressions".

1. resolve_dates
   Use for: Individual specific dates like "2026-03-05", "today", "tomorrow", "next Monday", "this Friday"
   Params: { "dates": ["2026-03-05", "next Monday", ...] }

2. expand_month
   Use for: "every day next month", "all days this month", "next month", "this month"
   Params: { "period": "next_month" | "this_month" }

3. expand_weeks
   Use for: "first 2 weeks of next month", "last week of next month", "last 3 weeks of this month"
   Params: { "period": "next_month" | "this_month", "count": <number>, "position": "first" | "last" }

4. expand_working_days
   Use for: "first 10 working days of next month", "last 5 business days of this month"
   Params: { "period": "next_month" | "this_month", "count": <number>, "position": "first" | "last" }

5. expand_day_of_week
   Use for: "every Monday next month", "every Friday this month"
   Params: { "period": "next_month" | "this_month", "day": "monday" | "tuesday" | ... | "sunday" }

6. expand_multiple_days_of_week
   Use for: "every Monday and Wednesday next month", "Tuesday Thursday Friday of next month"
   Params: { "period": "next_month" | "this_month", "days": ["monday", "wednesday", ...] }

7. expand_range
   Use for: "5th to 20th of next month", "1st to 14th of this month", "days 10 to 25 of next month"
   Params: { "period": "next_month" | "this_month", "start_day": <number>, "end_day": <number> }

8. expand_alternate
   Use for: "every alternate day next month", "every other working day this month"
   Params: { "period": "next_month" | "this_month", "type": "calendar" | "working" }
   Note: "calendar" = every 2nd calendar day. "working" = every 2nd weekday (Mon-Fri only).

9. expand_half_month
   Use for: "first half of next month", "second half of this month"
   Params: { "period": "next_month" | "this_month", "half": "first" | "second" }
   Note: First half = days 1-15. Second half = days 16-end.

10. expand_except
    Use for: "every day next month except Fridays", "all days this month except Mondays"
    Params: { "period": "next_month" | "this_month", "exclude_day": "friday" | "monday" | ... }

11. expand_first_weekday_per_week
    Use for: "first weekday of each week next month", "first working day of every week this month"
    Params: { "period": "next_month" | "this_month" }

12. expand_week_period
    Use for: "next week", "this week" (Mon-Fri)
    Params: { "week": "next_week" | "this_week" }

13. expand_rest_of_month
    Use for: "rest of this month", "remaining days this month"
    Params: {} (no parameters needed)
`.trim();
}
