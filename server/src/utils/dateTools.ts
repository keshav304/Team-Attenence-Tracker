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
    // Bare day name → next occurrence
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

      case 'expand_week_period':
        validateToolParams('expand_week_period', p, {
          week: { type: 'string', enum: ['this_week', 'next_week'] },
        });
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
   Note: "calendar" = every 2nd calendar day (weekdays only). "working" = every 2nd weekday (Mon-Fri only).

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

12. expand_week_period
    Use for: "next week", "this week" (Mon-Fri)
    Returns weekdays (Mon–Fri) only.
    Params: { "week": "next_week" | "this_week" }

13. expand_rest_of_month
    Use for: "rest of this month", "remaining days this month"
    Returns remaining weekdays (Mon–Fri) only.
    Params: {} (no parameters needed)
`.trim();
}
