/**
 * Get today's date as YYYY-MM-DD string (UTC).
 */
export const getTodayString = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Get date string N days from today.
 */
export const getFutureDateString = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

/**
 * Check if a date string is in the past (before today).
 */
export const isPastDate = (dateStr: string): boolean => {
  return dateStr < getTodayString();
};

/**
 * Get the first day of the current month as YYYY-MM-DD.
 */
export const getStartOfCurrentMonth = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
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
