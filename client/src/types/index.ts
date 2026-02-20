export interface User {
  _id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StatusType = 'office' | 'leave';

export interface Entry {
  _id: string;
  userId: string;
  date: string;
  status: StatusType;
  note?: string;
  startTime?: string; // HH:mm 24h IST
  endTime?: string;   // HH:mm 24h IST
}

export interface Holiday {
  _id: string;
  date: string;
  name: string;
}

// Effective status: includes implicit WFH
export type EffectiveStatus = 'office' | 'leave' | 'wfh' | 'holiday';

export interface EntryDetail {
  status: StatusType;
  note?: string;
  startTime?: string;
  endTime?: string;
}

export interface TeamMemberData {
  user: Pick<User, '_id' | 'name' | 'email' | 'role'>;
  entries: Record<string, EntryDetail>; // { "2026-02-19": { status: "office", ... } }
}

export interface TeamViewResponse {
  month: string;
  startDate: string;
  endDate: string;
  today: string;
  team: TeamMemberData[];
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ─── Templates ───────────────────────────────
export interface Template {
  _id: string;
  userId: string;
  name: string;
  status: StatusType;
  startTime?: string;
  endTime?: string;
  note?: string;
}

// ─── Bulk Operation Results ──────────────────
export interface BulkResultItem {
  date: string;
  success: boolean;
  message?: string;
}

export interface BulkResult {
  processed: number;
  skipped: number;
  results: BulkResultItem[];
}

export interface CopyResult extends BulkResult {
  sourceDate: string;
  sourceStatus: string;
}

// ─── Team Summary ────────────────────────────
export interface DaySummary {
  office: number;
  leave: number;
  wfh: number;
  total: number;
}

export type TeamSummary = Record<string, DaySummary>;

// ─── Insights / Analytics ────────────────────
export interface EmployeeInsight {
  userId: string;
  name: string;
  email: string;
  role: string;
  totalWorkingDays: number;
  officeDays: number;
  leaveDays: number;
  wfhDays: number;
  partialDays: number;
  notesCount: number;
  officePercent: number;
  leavePercent: number;
  wfhPercent: number;
}

export interface TeamAggregate {
  totalEmployees: number;
  totalOfficeDays: number;
  totalLeaveDays: number;
  totalWfhDays: number;
  avgOfficePerDay: number;
  mostPopularDay: string;
  leastPopularDay: string;
  officeDayDistribution: { day: string; count: number }[];
}

export interface InsightsResponse {
  month: number;
  year: number;
  totalWorkingDays: number;
  holidays: { date: string; name: string }[];
  team: TeamAggregate;
  employees: EmployeeInsight[];
  dailyOfficeTrend: { date: string; count: number }[];
}

// ─── Single User Insights ────────────────────
export interface UserDayBreakdown {
  date: string;
  dayOfWeek: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isBeforeJoin: boolean;
  status: 'office' | 'leave' | 'wfh' | 'holiday' | 'weekend' | 'not-joined';
  startTime?: string;
  endTime?: string;
  note?: string;
}

export interface UserInsightsSummary {
  officeDays: number;
  leaveDays: number;
  wfhDays: number;
  partialDays: number;
  notesCount: number;
  officePercent: number;
  leavePercent: number;
  wfhPercent: number;
}

export interface UserInsightsResponse {
  month: number;
  year: number;
  user: Pick<User, '_id' | 'name' | 'email' | 'role'> & { isActive: boolean };
  totalWorkingDays: number;
  holidays: { date: string; name: string }[];
  summary: UserInsightsSummary;
  dailyBreakdown: UserDayBreakdown[];
}

// ─── Today Status ────────────────────────────
export interface TodayStatusPerson {
  _id: string;
  name: string;
  email: string;
  startTime?: string;
  endTime?: string;
  note?: string;
}

export interface TodayStatusResponse {
  date: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  counts: {
    office: number;
    leave: number;
    wfh: number;
    total: number;
  };
  office: TodayStatusPerson[];
  leave: TodayStatusPerson[];
  wfh: TodayStatusPerson[];
}
