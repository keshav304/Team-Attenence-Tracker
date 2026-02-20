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
} from '../types';

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

  upsertEntry: (date: string, status: 'office' | 'leave', opts?: { note?: string; startTime?: string; endTime?: string }) =>
    api.put<ApiResponse<Entry>>('/entries', { date, status, ...opts }),

  deleteEntry: (date: string) =>
    api.delete<ApiResponse>(`/entries/${date}`),

  adminUpsertEntry: (userId: string, date: string, status: 'office' | 'leave', opts?: { note?: string; startTime?: string; endTime?: string }) =>
    api.put<ApiResponse<Entry>>('/entries/admin', { userId, date, status, ...opts }),

  adminDeleteEntry: (userId: string, date: string) =>
    api.delete<ApiResponse>(`/entries/admin/${userId}/${date}`),

  // Bulk operations
  bulkSet: (dates: string[], status: 'office' | 'leave' | 'clear', opts?: { note?: string; startTime?: string; endTime?: string }) =>
    api.post<ApiResponse<BulkResult>>('/entries/bulk', { dates, status, ...opts }),

  copyFromDate: (sourceDate: string, targetDates: string[]) =>
    api.post<ApiResponse<CopyResult>>('/entries/copy', { sourceDate, targetDates }),

  repeatPattern: (data: {
    status: 'office' | 'leave' | 'clear';
    daysOfWeek: number[];
    startDate: string;
    endDate: string;
    note?: string;
    startTime?: string;
    endTime?: string;
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

  createTemplate: (data: { name: string; status: 'office' | 'leave'; startTime?: string; endTime?: string; note?: string }) =>
    api.post<ApiResponse<Template>>('/templates', data),

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
