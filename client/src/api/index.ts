import api from './client';
import type {
  ApiResponse,
  AuthResponse,
  Entry,
  Holiday,
  TeamViewResponse,
  User,
  Template,
  BulkResult,
  CopyResult,
  TeamSummary,
  InsightsResponse,
  UserInsightsResponse,
  TodayStatusResponse,
  WorkbotPlan,
  WorkbotAction,
  WorkbotResolveResponse,
  WorkbotApplyItem,
  WorkbotApplyResult,
  CalendarEvent,
  MyPercentageResponse,
  LeaveDuration,
  HalfDayPortion,
  WorkingPortion,
} from '../types';

/** Half-day leave fields shared across entry API methods */
export interface LeaveOptions {
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
}

/** Common optional fields for entry creation/update */
export interface EntryOptions extends LeaveOptions {
  note?: string;
  startTime?: string;
  endTime?: string;
}

// ─── Auth ────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiResponse<AuthResponse>>('/auth/login', { email, password }),

  register: (name: string, email: string, password: string) =>
    api.post<ApiResponse<AuthResponse>>('/auth/register', { name, email, password }),

  getMe: () => api.get<ApiResponse<User>>('/auth/me'),

  updateProfile: (name: string) =>
    api.put<ApiResponse<User>>('/auth/profile', { name }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put<ApiResponse>('/auth/change-password', { currentPassword, newPassword }),
};

// ─── Entries ─────────────────────────────────
export const entryApi = {
  getMyEntries: (startDate: string, endDate: string) =>
    api.get<ApiResponse<Entry[]>>('/entries', { params: { startDate, endDate } }),

  getTeamEntries: (month: string) =>
    api.get<ApiResponse<TeamViewResponse>>('/entries/team', { params: { month } }),

  getTeamSummary: (month: string) =>
    api.get<ApiResponse<TeamSummary>>('/entries/team-summary', { params: { month } }),

  upsertEntry: (date: string, status: 'office' | 'leave', opts?: EntryOptions) =>
    api.put<ApiResponse<Entry>>('/entries', { date, status, ...opts }),

  deleteEntry: (date: string) =>
    api.delete<ApiResponse>(`/entries/${date}`),

  adminUpsertEntry: (userId: string, date: string, status: 'office' | 'leave', opts?: EntryOptions) =>
    api.put<ApiResponse<Entry>>('/entries/admin', { userId, date, status, ...opts }),

  adminDeleteEntry: (userId: string, date: string) =>
    api.delete<ApiResponse>(`/entries/admin/${userId}/${date}`),

  // Bulk operations
  bulkSet: (dates: string[], status: 'office' | 'leave' | 'clear', opts?: EntryOptions) =>
    api.post<ApiResponse<BulkResult>>('/entries/bulk', { dates, status, ...opts }),

  copyFromDate: (sourceDate: string, targetDates: string[]) =>
    api.post<ApiResponse<CopyResult>>('/entries/copy', { sourceDate, targetDates }),

  repeatPattern: (data: EntryOptions & {
    status: 'office' | 'leave' | 'clear';
    daysOfWeek: number[];
    startDate: string;
    endDate: string;
  }) => api.post<ApiResponse<BulkResult>>('/entries/repeat', data),

  copyRange: (sourceStart: string, sourceEnd: string, targetStart: string) =>
    api.post<ApiResponse<BulkResult>>('/entries/copy-range', { sourceStart, sourceEnd, targetStart }),
};

// ─── Admin Users ─────────────────────────────
export const adminApi = {
  getUsers: () => api.get<ApiResponse<User[]>>('/admin/users'),

  createUser: (data: { name: string; email: string; password: string; role?: string }) =>
    api.post<ApiResponse<User>>('/admin/users', data),

  updateUser: (id: string, data: Partial<User>) =>
    api.put<ApiResponse<User>>(`/admin/users/${id}`, data),

  resetPassword: (id: string, password: string) =>
    api.put<ApiResponse>(`/admin/users/${id}/reset-password`, { password }),

  deleteUser: (id: string) =>
    api.delete<ApiResponse>(`/admin/users/${id}`),
};

// ─── Holidays ────────────────────────────────
export const holidayApi = {
  getHolidays: (startDate?: string, endDate?: string) =>
    api.get<ApiResponse<Holiday[]>>('/holidays', { params: { startDate, endDate } }),

  createHoliday: (date: string, name: string) =>
    api.post<ApiResponse<Holiday>>('/holidays', { date, name }),

  updateHoliday: (id: string, date: string, name: string) =>
    api.put<ApiResponse<Holiday>>(`/holidays/${id}`, { date, name }),

  deleteHoliday: (id: string) =>
    api.delete<ApiResponse>(`/holidays/${id}`),
};

// ─── Templates ───────────────────────────────
export const templateApi = {
  getTemplates: () =>
    api.get<ApiResponse<Template[]>>('/templates'),

  createTemplate: (data: EntryOptions & { name: string; status: 'office' | 'leave' }) =>
    api.post<ApiResponse<Template>>('/templates', data),

  updateTemplate: (id: string, data: EntryOptions & { name?: string; status?: 'office' | 'leave' }) =>
    api.put<ApiResponse<Template>>(`/templates/${id}`, data),

  deleteTemplate: (id: string) =>
    api.delete<ApiResponse>(`/templates/${id}`),
};

// ─── Insights ────────────────────────────────
export const insightsApi = {
  getInsights: (month: number, year: number) =>
    api.get<ApiResponse<InsightsResponse>>('/insights', { params: { month, year } }),

  getUserInsights: (userId: string, month: number, year: number) =>
    api.get<ApiResponse<UserInsightsResponse>>(`/insights/user/${userId}`, { params: { month, year } }),

  exportCsv: (month: number, year: number) =>
    api.get<Blob>('/insights/export', {
      params: { month, year },
      responseType: 'blob',
    }),
};

// ─── Status ──────────────────────────────────
export const statusApi = {
  getToday: () =>
    api.get<ApiResponse<TodayStatusResponse>>('/status/today'),
};

// ─── Chat ────────────────────────────────────
export interface ChatResponse {
  answer: string;
  sources: { page: number; source: string }[];
}

export const chatApi = {
  ask: (question: string) =>
    api.post<ChatResponse>('/chat', { question }),
};

// ─── Workbot ─────────────────────────────────
export const workbotApi = {
  /** Step 1: Parse natural-language command into structured plan */
  parse: (command: string) =>
    api.post<ApiResponse<WorkbotPlan>>('/workbot/parse', { command }),

  /** Step 2: Resolve plan actions into concrete dated changes */
  resolve: (actions: WorkbotAction[]) =>
    api.post<ApiResponse<WorkbotResolveResponse>>('/workbot/resolve', { actions }),

  /** Step 3: Apply confirmed changes */
  apply: (changes: WorkbotApplyItem[]) =>
    api.post<ApiResponse<WorkbotApplyResult>>('/workbot/apply', { changes }),
};

// ─── Events (Admin Event Tagging) ────────────
export const eventApi = {
  getEvents: (startDate?: string, endDate?: string, signal?: AbortSignal) =>
    api.get<ApiResponse<CalendarEvent[]>>('/events', { params: { startDate, endDate }, signal }),

  createEvent: (data: { date: string; title: string; description?: string; eventType?: string }) =>
    api.post<ApiResponse<CalendarEvent>>('/events', data),

  updateEvent: (id: string, data: { date?: string; title?: string; description?: string; eventType?: string }) =>
    api.put<ApiResponse<CalendarEvent>>(`/events/${id}`, data),

  deleteEvent: (id: string) =>
    api.delete<ApiResponse>(`/events/${id}`),
};

// ─── Analytics ───────────────────────────────
export const analyticsApi = {
  getMyPercentage: (month: number, year: number) =>
    api.get<ApiResponse<MyPercentageResponse>>('/analytics/my-percentage', { params: { month, year } }),
};
