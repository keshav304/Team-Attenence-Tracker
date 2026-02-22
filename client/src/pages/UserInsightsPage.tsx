import React, { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { insightsApi, adminApi } from '../api';
import type { UserInsightsResponse, UserDayBreakdown, User } from '../types';

/* ─── helpers ─────────────────────────────────── */
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();

const STATUS_CONFIG: Record<
  UserDayBreakdown['status'],
  { label: string; emoji: string; bg: string; text: string }
> = {
  office:          { label: 'Office',         emoji: '🏢', bg: 'bg-blue-50 dark:bg-blue-900/30',    text: 'text-blue-700 dark:text-blue-300' },
  leave:           { label: 'Leave',          emoji: '🏖️', bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
  'half-day-leave': { label: 'Half-Day Leave', emoji: '🌗', bg: 'bg-amber-50 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-300' },
  wfh:             { label: 'WFH',            emoji: '🏠', bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
  holiday:         { label: 'Holiday',        emoji: '📌', bg: 'bg-red-50 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300' },
  weekend:         { label: 'Weekend',        emoji: '😴', bg: 'bg-gray-100 dark:bg-gray-700/50',   text: 'text-gray-400 dark:text-gray-500' },
  'not-joined':    { label: 'Not Joined',     emoji: '⏳', bg: 'bg-gray-100 dark:bg-gray-700/50',   text: 'text-gray-400 dark:text-gray-500' },
};

const pctColor = (pct: number, good: boolean) => {
  if (good) return pct >= 60 ? 'text-green-600 dark:text-green-400' : pct >= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400';
  return pct <= 10 ? 'text-green-600 dark:text-green-400' : pct <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400';
};

/* ─── component ───────────────────────────────── */
const UserInsightsPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<UserInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  /* Load users list */
  useEffect(() => {
    (async () => {
      try {
        const res = await adminApi.getUsers();
        if (res.data.success && res.data.data) {
          setUsers(res.data.data);
        }
      } catch {
        toast.error('Failed to load users');
      } finally {
        setUsersLoading(false);
      }
    })();
  }, []);

  /* Filter users for search */
  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.toLowerCase();
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  /* Fetch insights when user + month changes */
  const load = async () => {
    if (!selectedUserId) return;
    setLoading(true);
    try {
      const res = await insightsApi.getUserInsights(selectedUserId, month, year);
      if (res.data.success && res.data.data) {
        setData(res.data.data);
      } else {
        toast.error(res.data.message || 'Failed to load user insights');
      }
    } catch {
      toast.error('Failed to load user insights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedUserId) load();
    else setData(null);
  }, [selectedUserId, month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Year options */
  const yearOpts = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  /* Navigation */
  const goPrev = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const goNext = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  /* Filtered daily breakdown */
  const filteredDays = useMemo(() => {
    if (!data) return [];
    if (filterStatus === 'all') return data.dailyBreakdown;
    return data.dailyBreakdown.filter((d) => d.status === filterStatus);
  }, [data, filterStatus]);

  /* Status distribution for mini-chart */
  const statusCounts = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    for (const d of data.dailyBreakdown) {
      counts[d.status] = (counts[d.status] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([status, count]) => ({ status: status as UserDayBreakdown['status'], count }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  /* Half-day leave count derived from daily breakdown */
  const halfDayLeaveCount = useMemo(() => {
    if (!data) return 0;
    return data.dailyBreakdown.filter((d) => d.status === 'half-day-leave').length;
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">👤 Employee Insights</h1>

        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="px-2.5 py-2 sm:py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm">◀</button>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {yearOpts.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={goNext} className="px-2.5 py-2 sm:py-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm">▶</button>
        </div>
      </div>

      {/* User Selector */}
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 transition-colors">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Employee</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search by name or email…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          />
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="">— Choose employee —</option>
            {usersLoading && <option disabled>Loading…</option>}
            {filteredUsers.map((u) => (
              <option key={u._id} value={u._id}>
                {u.name} ({u.email}){!u.isActive ? ' [inactive]' : ''}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      )}

      {/* No selection */}
      {!loading && !selectedUserId && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <span className="text-4xl block mb-2">👆</span>
          Select an employee above to view their monthly analytics
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <>
          {/* User header */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 flex items-center gap-3 sm:gap-4 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-primary-700 dark:text-primary-300 text-base sm:text-lg font-bold shrink-0">
              {data.user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                {data.user.name}
                {data.user.role === 'admin' && (
                  <span className="ml-2 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">Admin</span>
                )}
                {!data.user.isActive && (
                  <span className="ml-2 text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded">Inactive</span>
                )}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{data.user.email}</p>
            </div>
            <div className="ml-auto text-right hidden sm:block">
              <p className="text-xs text-gray-400 dark:text-gray-500">Period</p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {MONTH_NAMES[data.month - 1]} {data.year}
              </p>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <Card label="Working Days" value={data.totalWorkingDays} icon="📅" />
            <Card label="Office Days" value={data.summary.officeDays} icon="🏢" />
            <Card label="Leave Days" value={data.summary.leaveDays} icon="🏖️" />
            <Card label="WFH Days" value={data.summary.wfhDays} icon="🏠" />
            <Card
              label="Office %"
              value={`${data.summary.officePercent}%`}
              icon="📈"
              valueClass={pctColor(data.summary.officePercent, true)}
            />
            <Card
              label="Leave %"
              value={`${data.summary.leavePercent}%`}
              icon="📉"
              valueClass={pctColor(data.summary.leavePercent, false)}
            />
            <Card
              label="WFH %"
              value={`${data.summary.wfhPercent}%`}
              icon="🏠"
            />
            <Card label="Half-Day Leaves" value={halfDayLeaveCount} icon="🌗" />
          </div>

          {/* Status Distribution mini-chart */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 transition-colors">
            <h2 className="text-base sm:text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Day Distribution</h2>
            <div className="flex items-end gap-2 sm:gap-4 h-24 sm:h-28">
              {statusCounts.map(({ status, count }) => {
                const max = Math.max(...statusCounts.map((s) => s.count), 1);
                const pct = (count / max) * 100;
                const cfg = STATUS_CONFIG[status];
                return (
                  <div key={status} className="flex-1 flex flex-col items-center gap-1 max-w-[80px]">
                    <span className={`text-xs font-semibold ${cfg.text}`}>{count}</span>
                    <div className={`w-full rounded-t ${cfg.bg}`} style={{ height: `${pct}%`, minHeight: 4 }}>
                      <div className={`w-full h-full rounded-t ${cfg.bg}`} />
                    </div>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{cfg.emoji} {cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Holidays */}
          {data.holidays.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-4 transition-colors">
              <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">Holidays This Month</h2>
              <div className="flex flex-wrap gap-2">
                {data.holidays.map((h) => (
                  <span
                    key={h.date}
                    className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm px-3 py-1 rounded-full"
                  >
                    📌 {h.name} <span className="text-red-400 dark:text-red-500 text-xs">({h.date})</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Daily Breakdown Table */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 overflow-hidden transition-colors">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between p-3 sm:p-4 border-b dark:border-gray-700">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Daily Breakdown</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Filter:</span>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="border dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="all">All Days</option>
                  <option value="office">Office</option>
                  <option value="leave">Leave</option>
                  <option value="half-day-leave">Half-Day Leave</option>
                  <option value="wfh">WFH</option>
                  <option value="holiday">Holiday</option>
                  <option value="weekend">Weekend</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-left">
                  <tr>
                    <th className="px-2 sm:px-4 py-2 font-medium text-gray-700 dark:text-gray-300">Date</th>
                    <th className="px-2 sm:px-4 py-2 font-medium text-gray-700 dark:text-gray-300">Day</th>
                    <th className="px-2 sm:px-4 py-2 font-medium text-gray-700 dark:text-gray-300">Status</th>
                    <th className="px-2 sm:px-4 py-2 font-medium text-gray-700 dark:text-gray-300 hidden sm:table-cell">Time</th>
                    <th className="px-2 sm:px-4 py-2 font-medium text-gray-700 dark:text-gray-300 hidden sm:table-cell">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredDays.map((day) => {
                    const cfg = STATUS_CONFIG[day.status];
                    return (
                      <tr
                        key={day.date}
                        className={`${day.isWeekend || day.isHoliday || day.isBeforeJoin ? 'opacity-60' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/50`}
                      >
                        <td className="px-2 sm:px-4 py-2 text-gray-900 dark:text-gray-100 font-mono text-xs whitespace-nowrap">
                          {day.date}
                        </td>
                        <td className="px-2 sm:px-4 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                          {day.dayOfWeek.slice(0, 3)}
                        </td>
                        <td className="px-2 sm:px-4 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                            {cfg.emoji} <span className="hidden sm:inline">{cfg.label}</span>
                            {day.status === 'half-day-leave' && day.halfDayPortion && (
                              <span className="text-[10px] opacity-75 ml-1 hidden sm:inline">
                                ({day.halfDayPortion === 'first-half' ? 'AM' : 'PM'} leave,{' '}
                                {day.workingPortion === 'office' ? '🏢 Office' : day.workingPortion === 'wfh' ? '🏠 WFH' : '🏠 WFH'} other half)
                              </span>
                            )}
                            {day.holidayName && (
                              <span className="text-[10px] opacity-75 ml-1 hidden sm:inline">({day.holidayName})</span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 sm:px-4 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap hidden sm:table-cell">
                          {day.startTime && day.endTime ? `${day.startTime} – ${day.endTime}` : '—'}
                        </td>
                        <td className="px-2 sm:px-4 py-2 text-gray-500 dark:text-gray-400 text-xs max-w-[200px] truncate hidden sm:table-cell" title={day.note}>
                          {day.note || '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredDays.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400 dark:text-gray-500">
                        No days match the current filter
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

/* ─── Card sub-component ────────────────────── */
const Card: React.FC<{ label: string; value: string | number; icon: string; valueClass?: string }> = ({
  label,
  value,
  icon,
  valueClass,
}) => (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-3 sm:p-4 flex items-center gap-2 sm:gap-3 transition-colors">
    <span className="text-xl sm:text-2xl">{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">{label}</p>
      <p className={`text-base sm:text-xl font-bold truncate ${valueClass || 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
    </div>
  </div>
);

export default UserInsightsPage;
