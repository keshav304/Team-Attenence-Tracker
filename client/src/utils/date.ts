/**
 * Format YYYY-MM to a display string like "February 2026".
 */
export const formatMonth = (yearMonth: string): string => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
};

/**
 * Get today as YYYY-MM-DD.
 */
export const getTodayString = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Get current month as YYYY-MM.
 */
export const getCurrentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Navigate month: returns YYYY-MM offset by delta months.
 */
export const offsetMonth = (yearMonth: string, delta: number): string => {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Get all dates in a month as array of YYYY-MM-DD strings.
 */
export const getDaysInMonth = (yearMonth: string): string[] => {
  const [year, month] = yearMonth.split('-').map(Number);
  const daysCount = new Date(year, month, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= daysCount; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
};

/**
 * Get day of week (0=Sun, 6=Sat).
 */
export const getDayOfWeek = (dateStr: string): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

/**
 * Check if date is weekend.
 */
export const isWeekend = (dateStr: string): boolean => {
  const day = getDayOfWeek(dateStr);
  return day === 0 || day === 6;
};

/**
 * Check if date is in the past.
 */
export const isPast = (dateStr: string): boolean => {
  return dateStr < getTodayString();
};

/**
 * Check if date is today.
 */
export const isToday = (dateStr: string): boolean => {
  return dateStr === getTodayString();
};

/**
 * Get short day name for a date.
 */
export const getShortDayName = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' });
};

/**
 * Get day number from date string.
 */
export const getDayNumber = (dateStr: string): number => {
  return parseInt(dateStr.split('-')[2], 10);
};

/**
 * Get first day of current month as YYYY-MM-DD.
 */
export const getStartOfCurrentMonth = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
};

/**
 * Planning window max date (today + 90 days).
 */
export const getMaxPlanDate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().split('T')[0];
};

/**
 * Check if a date can be edited by a regular member.
 * Allowed range: start of current month → today + 90 days.
 */
export const canMemberEdit = (dateStr: string): boolean => {
  const minDate = getStartOfCurrentMonth();
  const maxDate = getMaxPlanDate();
  return dateStr >= minDate && dateStr <= maxDate;
};

/**
 * Get a human-readable reason why a date is locked for a member.
 * Returns null if the date is editable.
 */
export const getLockedReason = (dateStr: string): string | null => {
  const minDate = getStartOfCurrentMonth();
  const maxDate = getMaxPlanDate();
  if (dateStr < minDate) return 'Before current month — read only';
  if (dateStr > maxDate) return 'Beyond 90-day planning window';
  return null;
};
