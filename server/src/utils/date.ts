/**
 * Format a Date as YYYY-MM-DD in IST (Asia/Kolkata, UTC+5:30).
 * Works correctly regardless of the server's local timezone.
 */
export const toISTDateString = (d: Date): string => {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + IST_OFFSET_MS);
  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, '0');
  const dd = String(ist.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Get today's date as YYYY-MM-DD string in IST.
 */
export const getTodayString = (): string => {
  return toISTDateString(new Date());
};

/**
 * Get date string N days from today (IST).
 */
export const getFutureDateString = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISTDateString(d);
};

/**
 * Check if a date string is in the past (before today).
 */
export const isPastDate = (dateStr: string): boolean => {
  return dateStr < getTodayString();
};

/**
 * Get the first day of the current month as YYYY-MM-DD in IST.
 */
export const getStartOfCurrentMonth = (): string => {
  const today = getTodayString(); // IST-based YYYY-MM-DD
  return today.slice(0, 8) + '01';
};

/**
 * Check if a date is within the allowed editing window for members.
 * Members can edit: start of current month → today + 90 days.
 */
export const isMemberAllowedDate = (dateStr: string): boolean => {
  const minDate = getStartOfCurrentMonth();
  const maxDate = getFutureDateString(90);
  return dateStr >= minDate && dateStr <= maxDate;
};

/**
 * Check if a date is within the allowed planning window (today to today+90).
 * @deprecated Use isMemberAllowedDate instead.
 */
export const isWithinPlanningWindow = (dateStr: string): boolean => {
  return isMemberAllowedDate(dateStr);
};

/**
 * Get first and last day of a month given YYYY-MM format.
 */
export const getMonthRange = (
  yearMonth: string
): { startDate: string; endDate: string } => {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
};
