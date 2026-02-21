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
 * Format a Date as YYYY-MM-DD in IST (Asia/Kolkata, UTC+5:30).
 * Works correctly regardless of the browser's local timezone.
 */
const istFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const toISTDateString = (d: Date): string => {
  // en-CA locale produces YYYY-MM-DD natively
  return istFormatter.format(d);
};

/**
 * Get today as YYYY-MM-DD (IST).
 */
export const getTodayString = (): string => {
  return toISTDateString(new Date());
};

/**
 * Get current month as YYYY-MM in IST.
 */
export const getCurrentMonth = (): string => {
  return getTodayString().slice(0, 7);
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
 * Get first day of current month as YYYY-MM-DD in IST.
 */
export const getStartOfCurrentMonth = (): string => {
  const today = getTodayString(); // IST-based YYYY-MM-DD
  return today.slice(0, 8) + '01';
};

/**
 * Planning window max date (today + 90 days, IST).
 */
export const getMaxPlanDate = (): string => {
  // Anchor to the current IST date to avoid 1-day drift for users behind IST
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  nowIST.setDate(nowIST.getDate() + 90);
  return toISTDateString(nowIST);
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
