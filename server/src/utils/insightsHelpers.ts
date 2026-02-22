/**
 * Shared pure-logic helpers used by insightsController.
 *
 * Extracting these keeps the controllers focused on data-fetching / response
 * formatting and makes the core calculations independently testable.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface EntryFields {
  status: string;
  startTime?: string;
  endTime?: string;
  note?: string;
  leaveDuration?: string;
  halfDayPortion?: string;
  workingPortion?: string;
}

export interface DateRange {
  mm: string;
  daysInMonth: number;
  startDate: string;
  endDate: string;
}

/** Minimal shape expected from Mongoose Entry documents. */
export interface EntryLike {
  userId: { toString(): string };
  date: string;
  status: string;
  startTime?: string;
  endTime?: string;
  note?: string;
  leaveDuration?: string;
  halfDayPortion?: string;
  workingPortion?: string;
}

/* ------------------------------------------------------------------ */
/*  computeDateRange                                                  */
/* ------------------------------------------------------------------ */

/**
 * Derive the formatted month string, days-in-month count, and
 * ISO start/end date strings for a given month and year.
 */
export function computeDateRange(month: number, year: number): DateRange {
  const mm = String(month).padStart(2, '0');
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate = `${year}-${mm}-01`;
  const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;
  return { mm, daysInMonth, startDate, endDate };
}

/* ------------------------------------------------------------------ */
/*  computeWorkingDays                                                */
/* ------------------------------------------------------------------ */

/**
 * Return an ordered list of YYYY-MM-DD date strings that are
 * weekdays (Mon–Fri) and not in `holidaySet`.
 */
export function computeWorkingDays(
  year: number,
  month: number,
  mm: string,
  daysInMonth: number,
  holidaySet: Set<string>,
): string[] {
  const workingDays: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateStr)) {
      workingDays.push(dateStr);
    }
  }
  return workingDays;
}

/* ------------------------------------------------------------------ */
/*  buildEntryMap                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a two-level lookup: `userId → date → EntryFields`.
 *
 * For single-user queries the caller can simply access
 * `buildEntryMap(entries)[userId] || {}`.
 */
export function buildEntryMap(
  entries: EntryLike[],
): Record<string, Record<string, EntryFields>> {
  const map: Record<string, Record<string, EntryFields>> = {};
  for (const e of entries) {
    const uid = e.userId.toString();
    if (!map[uid]) map[uid] = {};
    map[uid][e.date] = {
      status: e.status,
      startTime: e.startTime,
      endTime: e.endTime,
      note: e.note,
      leaveDuration: e.leaveDuration,
      halfDayPortion: e.halfDayPortion,
      workingPortion: e.workingPortion,
    };
  }
  return map;
}
