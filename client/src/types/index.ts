export interface User {
  _id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  isActive: boolean;
  favorites?: string[];
  createdAt: string;
  updatedAt: string;
}

export type StatusType = 'office' | 'leave';
export type LeaveDuration = 'full' | 'half';
export type HalfDayPortion = 'first-half' | 'second-half';
export type WorkingPortion = 'wfh' | 'office';

export interface Entry {
  _id: string;
  userId: string;
  date: string;
  status: StatusType;
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
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
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
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
  code?: string;
  data?: T;
}

// ─── Templates ───────────────────────────────
export interface Template {
  _id: string;
  userId: string;
  name: string;
  status: StatusType;
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
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
  halfDayLeave: number;
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
  status: 'office' | 'leave' | 'wfh' | 'holiday' | 'weekend' | 'not-joined' | 'half-day-leave';
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
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

// ─── Workbot / Schedule Assistant ────────────
export type WorkbotStatus = StatusType | 'clear';

export type WorkbotAction =
  | { type: 'set'; status: WorkbotStatus; dateExpressions: string[]; note?: string }
  | { type: 'clear'; dateExpressions: string[]; note?: string };

export interface WorkbotPlan {
  actions: WorkbotAction[];
  summary: string;
}

export interface WorkbotResolvedChange {
  date: string;
  day: string;
  status: WorkbotStatus;
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
  note?: string;
  valid: boolean;
  validationMessage?: string;
  /** Client-side: whether user has selected this row (default: valid rows) */
  selected?: boolean;
}

export interface WorkbotResolveResponse {
  changes: WorkbotResolvedChange[];
  validCount: number;
  invalidCount: number;
}

export interface WorkbotApplyItem {
  date: string;
  status: WorkbotStatus;
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
  note?: string;
}

export interface WorkbotApplyResult {
  processed: number;
  failed: number;
  results: BulkResultItem[];
}

// ─── Events (Admin Event Tagging) ────────────
export type RsvpStatus = 'going' | 'not_going' | 'maybe';

export interface EventRsvp {
  userId: Pick<User, '_id' | 'name' | 'email'>;
  status: RsvpStatus;
  respondedAt: string;
}

export interface RsvpCounts {
  going: number;
  maybe: number;
  not_going: number;
}

export interface CalendarEvent {
  _id: string;
  date: string;
  title: string;
  description?: string;
  eventType?: string;
  createdBy: Pick<User, '_id' | 'name' | 'email'>;
  rsvps?: EventRsvp[];
  rsvpCounts?: RsvpCounts;
  myRsvpStatus?: RsvpStatus | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Analytics ───────────────────────────────
export interface MyPercentageResponse {
  month: number;
  year: number;
  totalWorkingDays: number;
  officeDays: number;
  leaveDays: number;
  wfhDays: number;
  officePercent: number;
}

// ─── My Insights (Member) ────────────────────
export interface MyInsightsPersonal {
  totalWorkingDays: number;
  officeDays: number;
  wfhDays: number;
  leaveDays: number;
  officePercent: number;
  longestOfficeStreak: number;
}

export interface MyInsightsTeamSnapshot {
  teamAvgOfficePercent: number;
  mostPopularOfficeDay: string;
  totalTeamOfficeDays: number;
  teamSize: number;
}

export interface MyInsightsHighlights {
  longestStreak: {
    days: number;
    users: string[];
  };
  mostConsistentPlanner: string | null;
  mostPopularOfficeDay: string;
  collaborationMagnet: string | null;
}

export interface MyInsightsResponse {
  personal: MyInsightsPersonal;
  teamSnapshot: MyInsightsTeamSnapshot;
  highlights: MyInsightsHighlights;
}

// ─── Favorites & Notifications ───────────────
export type FavoriteUser = Pick<User, '_id' | 'name' | 'email'>;

export interface FavoriteNotification {
  _id: string;
  userId: string;
  type: 'favorite_schedule_update' | 'event_created' | 'event_updated';
  sourceUser: FavoriteUser;
  eventId?: string;
  affectedDates: string[];
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MatchDateClassification =
  | 'will_be_added'
  | 'conflict_leave'
  | 'locked'
  | 'already_matching'
  | 'holiday'
  | 'weekend';

export interface MatchPreviewDate {
  date: string;
  classification: MatchDateClassification;
  favoriteStatus: EffectiveStatus;
  userStatus: EffectiveStatus;
  canOverride: boolean;
  reason?: string;
}

export interface MatchPreviewResponse {
  favoriteUser: FavoriteUser;
  preview: MatchPreviewDate[];
  lastUpdated: string | null;
}

export type MatchApplyResult = BulkResult;
