import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { entryApi, holidayApi, statusApi } from '../api';
import { useAuth } from '../context/AuthContext';
import type { TeamMemberData, Holiday, StatusType, EntryDetail, DaySummary, TodayStatusResponse } from '../types';
import {
  getCurrentMonth,
  offsetMonth,
  formatMonth,
  getDaysInMonth,
  isWeekend,
  isPast,
  isToday,
  getDayNumber,
  getShortDayName,
  canMemberEdit,
} from '../utils/date';
import toast from 'react-hot-toast';

const STATUS_STYLES: Record<string, { bg: string; label: string; emoji: string }> = {
  office: { bg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300', label: 'Office', emoji: '🏢' },
  leave: { bg: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300', label: 'Leave', emoji: '🌴' },
  wfh: { bg: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400', label: 'WFH', emoji: '🏠' },
  holiday: { bg: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300', label: 'Holiday', emoji: '🎉' },
  weekend: { bg: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500', label: '', emoji: '' },
};

interface EditCellState {
  userId: string;
  date: string;
  status: StatusType | 'wfh';
  note: string;
  startTime: string;
  endTime: string;
}

const TeamCalendarPage: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [month, setMonth] = useState(getCurrentMonth);
  const [team, setTeam] = useState<TeamMemberData[]>([]);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState<EditCellState | null>(null);
  const [saving, setSaving] = useState(false);

  // Availability summary per date
  const [summary, setSummary] = useState<Record<string, DaySummary>>({});

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'office' | 'leave' | 'wfh'>('all');
  const [filterDate, setFilterDate] = useState('');

  // Today's status widget
  const [todayStatus, setTodayStatus] = useState<TodayStatusResponse | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayExpanded, setTodayExpanded] = useState(true);

  const days = getDaysInMonth(month);

  // Derive filtered team list
  const filteredTeam = useMemo(() => {
    let result = team;

    // Name search (case-insensitive)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q)
      );
    }

    // Status filter on a specific date
    if (statusFilter !== 'all' && filterDate) {
      result = result.filter((m) => {
        const effective = getEffectiveStatusForFilter(m.entries, filterDate);
        return effective === statusFilter;
      });
    }

    return result;
  }, [team, searchQuery, statusFilter, filterDate, holidays]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, holidayRes, summaryRes] = await Promise.all([
        entryApi.getTeamEntries(month),
        holidayApi.getHolidays(days[0], days[days.length - 1]),
        entryApi.getTeamSummary(month),
      ]);
      setTeam(teamRes.data.data?.team || []);

      const hMap: Record<string, string> = {};
      (holidayRes.data.data || []).forEach((h: Holiday) => {
        hMap[h.date] = h.name;
      });
      setHolidays(hMap);
      setSummary(summaryRes.data.data || {});
    } catch {
      toast.error('Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, [month]);

  const fetchTodayStatus = useCallback(async () => {
    setTodayLoading(true);
    try {
      const res = await statusApi.getToday();
      if (res.data.success && res.data.data) {
        setTodayStatus(res.data.data);
      }
    } catch {
      // Silently fail — widget is non-critical
    } finally {
      setTodayLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchTodayStatus();
  }, [fetchTodayStatus]);

  const getEffectiveStatus = (
    memberEntries: Record<string, EntryDetail>,
    date: string
  ): string => {
    if (isWeekend(date)) return 'weekend';
    if (holidays[date]) return 'holiday';
    return memberEntries[date]?.status || 'wfh';
  };

  /** Same logic but returns only filterable statuses (no weekend/holiday). */
  const getEffectiveStatusForFilter = (
    memberEntries: Record<string, EntryDetail>,
    date: string
  ): 'office' | 'leave' | 'wfh' => {
    if (isWeekend(date) || holidays[date]) return 'wfh';
    return memberEntries[date]?.status || 'wfh';
  };

  const handleCellClick = (memberId: string, date: string, memberEntries: Record<string, EntryDetail>) => {
    if (isWeekend(date) || holidays[date]) return;

    const isSelf = memberId === user?._id;
    if (!isSelf && !isAdmin) return;
    if (!isAdmin && !canMemberEdit(date)) return;

    const existing = memberEntries[date];
    setEditCell({
      userId: memberId,
      date,
      status: existing?.status || 'wfh',
      note: existing?.note || '',
      startTime: existing?.startTime || '',
      endTime: existing?.endTime || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editCell) return;
    const { userId, date, status, note, startTime, endTime } = editCell;

    if ((startTime && !endTime) || (!startTime && endTime)) {
      toast.error('Provide both start and end time, or leave both empty');
      return;
    }
    if (startTime && endTime && endTime <= startTime) {
      toast.error('End time must be after start time');
      return;
    }

    // Conflict warnings
    if (status === 'leave' && holidays[date]) {
      toast('This date is already a holiday', { icon: '⚠️' });
    }

    setSaving(true);
    try {
      const isSelf = userId === user?._id;
      const opts = {
        note: note || '',
        startTime: startTime || '',
        endTime: endTime || '',
      };

      if (status === 'wfh') {
        if (isAdmin && !isSelf) {
          await entryApi.adminDeleteEntry(userId, date);
        } else {
          await entryApi.deleteEntry(date);
        }
      } else {
        if (isAdmin && !isSelf) {
          await entryApi.adminUpsertEntry(userId, date, status, opts);
        } else {
          await entryApi.upsertEntry(date, status, opts);
        }
      }

      // Update local state
      setTeam((prev) =>
        prev.map((m) => {
          if (m.user._id !== userId) return m;
          const newEntries = { ...m.entries };
          if (status === 'wfh') {
            delete newEntries[date];
          } else {
            newEntries[date] = {
              status,
              ...(note ? { note } : {}),
              ...(startTime ? { startTime } : {}),
              ...(endTime ? { endTime } : {}),
            };
          }
          return { ...m, entries: newEntries };
        })
      );

      // Update summary locally
      setSummary((prev) => {
        const copy = { ...prev };
        if (copy[date]) {
          // Recalculate — simpler to just refetch, but let's approximate
          const oldStatus = team.find((m) => m.user._id === userId)?.entries[date]?.status;
          if (oldStatus === 'office') copy[date] = { ...copy[date], office: copy[date].office - 1, wfh: copy[date].wfh + 1 };
          else if (oldStatus === 'leave') copy[date] = { ...copy[date], leave: copy[date].leave - 1, wfh: copy[date].wfh + 1 };

          if (status === 'office') copy[date] = { ...copy[date], office: copy[date].office + 1, wfh: copy[date].wfh - 1 };
          else if (status === 'leave') copy[date] = { ...copy[date], leave: copy[date].leave + 1, wfh: copy[date].wfh - 1 };
        }
        return copy;
      });

      setEditCell(null);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  /** Build tooltip text for a cell. */
  const buildTooltip = (entry: EntryDetail | undefined, date: string): string => {
    if (holidays[date]) return `🎉 ${holidays[date]}`;
    if (!entry) return 'WFH';
    const parts = [STATUS_STYLES[entry.status]?.label || entry.status];
    if (entry.startTime && entry.endTime) parts.push(`⏰ ${entry.startTime}–${entry.endTime}`);
    if (entry.note) parts.push(`📝 ${entry.note}`);
    return parts.join(' · ');
  };

  /** Build summary tooltip for a column header */
  const buildSummaryTooltip = (date: string): string => {
    const s = summary[date];
    if (!s) return '';
    return `🏢 ${s.office} in office · 🌴 ${s.leave} on leave · 🏠 ${s.wfh} WFH`;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Team Calendar</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMonth(offsetMonth(month, -1))}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            ◀
          </button>
          <span className="text-lg font-semibold min-w-[180px] text-center">
            {formatMonth(month)}
          </span>
          <button
            onClick={() => setMonth(offsetMonth(month, 1))}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            ▶
          </button>
          <button
            onClick={() => setMonth(getCurrentMonth())}
            className="ml-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        {Object.entries(STATUS_STYLES)
          .filter(([key]) => key !== 'weekend')
          .map(([key, val]) => (
            <span key={key} className="flex items-center gap-1">
              <span className={`inline-block w-4 h-4 rounded ${val.bg}`} />
              {val.emoji} {val.label}
            </span>
          ))}
        <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
          ⏰ = active hours · 📝 = note
        </span>
      </div>

      {/* ─── Today's Status Widget ─────────────── */}
      <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 transition-colors overflow-hidden">
        {/* Widget header */}
        <button
          onClick={() => setTodayExpanded((p) => !p)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📍</span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Today’s Status</span>
            {todayStatus && !todayStatus.isWeekend && !todayStatus.isHoliday && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                — {todayStatus.counts.office} in office · {todayStatus.counts.leave} on leave · {todayStatus.counts.wfh} WFH
              </span>
            )}
            {todayStatus?.isHoliday && (
              <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                🎉 {todayStatus.holidayName || 'Holiday'}
              </span>
            )}
            {todayStatus?.isWeekend && (
              <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                😴 Weekend
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); fetchTodayStatus(); }}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
              title="Refresh"
            >
              <svg className={`w-3.5 h-3.5 ${todayLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <span className={`text-xs text-gray-400 transition-transform ${todayExpanded ? 'rotate-180' : ''}`}>▼</span>
          </div>
        </button>

        {/* Widget body */}
        {todayExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">
            {todayLoading && !todayStatus && (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
              </div>
            )}

            {todayStatus && (todayStatus.isWeekend || todayStatus.isHoliday) && (
              <div className="text-center py-4 text-gray-400 dark:text-gray-500 text-sm">
                {todayStatus.isWeekend ? '😴 It\'s the weekend — enjoy your time off!' : `🎉 Today is a holiday: ${todayStatus.holidayName}`}
              </div>
            )}

            {todayStatus && !todayStatus.isWeekend && !todayStatus.isHoliday && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
                {/* Office column */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">🏢 In Office</span>
                    <span className="ml-auto text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                      {todayStatus.counts.office}
                    </span>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {todayStatus.office.length === 0 && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">No one</p>
                    )}
                    {todayStatus.office.map((p) => (
                      <div key={p._id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {p.name.charAt(0)}
                        </span>
                        <span className="truncate">{p.name}</span>
                        {p.startTime && p.endTime && (
                          <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">⏰ {p.startTime}–{p.endTime}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Leave column */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">🌴 On Leave</span>
                    <span className="ml-auto text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-1.5 py-0.5 rounded">
                      {todayStatus.counts.leave}
                    </span>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {todayStatus.leave.length === 0 && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">No one</p>
                    )}
                    {todayStatus.leave.map((p) => (
                      <div key={p._id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {p.name.charAt(0)}
                        </span>
                        <span className="truncate">{p.name}</span>
                        {p.note && (
                          <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[80px]" title={p.note}>📝 {p.note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* WFH column */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">🏠 WFH</span>
                    <span className="ml-auto text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">
                      {todayStatus.counts.wfh}
                    </span>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {todayStatus.wfh.length === 0 && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">No one</p>
                    )}
                    {todayStatus.wfh.map((p) => (
                      <div key={p._id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {p.name.charAt(0)}
                        </span>
                        <span className="truncate">{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Search & Filter Bar ───────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-4 py-3 transition-colors">
        {/* Name search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-8 pr-8 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-gray-700" />

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Status on</span>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            min={days[0]}
            max={days[days.length - 1]}
            className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
          />
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
            {([
              { value: 'all' as const, label: 'All' },
              { value: 'office' as const, label: '🏢' },
              { value: 'leave' as const, label: '🌴' },
              { value: 'wfh' as const, label: '🏠' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === opt.value
                    ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
                title={opt.value === 'all' ? 'Show all' : `Show ${opt.value} only`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results count & clear */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {filteredTeam.length}/{team.length}
          </span>
          {(searchQuery || statusFilter !== 'all') && (
            <button
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); setFilterDate(''); }}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 transition-colors">
          <table className="w-full text-sm">
            <thead>
              {/* ─── Availability summary row ──────── */}
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 min-w-[140px] border-r border-gray-200 dark:border-gray-700">
                  Availability
                </th>
                {days.map((date) => {
                  const weekend = isWeekend(date);
                  const isHoliday = !!holidays[date];
                  const s = summary[date];
                  return (
                    <th
                      key={`sum-${date}`}
                      className={`px-0.5 py-1 text-center ${weekend || isHoliday ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                      title={buildSummaryTooltip(date)}
                    >
                      {!weekend && !isHoliday && s && (
                        <div className="flex flex-col items-center gap-px">
                          <span className="text-[8px] font-bold text-blue-600" title={`${s.office} in office`}>
                            {s.office > 0 ? s.office : ''}
                          </span>
                          <span className="text-[8px] font-bold text-orange-500" title={`${s.leave} on leave`}>
                            {s.leave > 0 ? s.leave : ''}
                          </span>
                          <span className="text-[8px] text-green-500" title={`${s.wfh} WFH`}>
                            {s.wfh > 0 ? s.wfh : ''}
                          </span>
                        </div>
                      )}
                      {isHoliday && !weekend && (
                        <span className="text-[8px]">🎉</span>
                      )}
                    </th>
                  );
                })}
              </tr>

              {/* ─── Day headers ────────────────────── */}
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <th className="sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 min-w-[140px] border-r border-gray-200 dark:border-gray-700">
                  Team Member
                </th>
                {days.map((date) => {
                  const weekend = isWeekend(date);
                  const today = isToday(date);
                  return (
                    <th
                      key={date}
                      className={`px-1 py-2 text-center min-w-[36px] ${
                        weekend ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500' : ''
                      } ${today ? 'bg-primary-50 dark:bg-primary-900/30' : ''}`}
                    >
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">
                        {getShortDayName(date)}
                      </div>
                      <div className={`text-xs font-semibold ${today ? 'text-primary-600' : ''}`}>
                        {getDayNumber(date)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredTeam.length === 0 && (
                <tr>
                  <td
                    colSpan={days.length + 1}
                    className="text-center py-12 text-gray-400 dark:text-gray-500"
                  >
                    {team.length === 0
                      ? 'No team members found'
                      : 'No members match the current filters'}
                  </td>
                </tr>
              )}
              {filteredTeam.map((member) => {
                const isSelf = member.user._id === user?._id;
                return (
                  <tr
                    key={member.user._id}
                    className={`border-t border-gray-100 dark:border-gray-700 ${
                      isSelf ? 'bg-primary-50/30 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <td className="sticky left-0 bg-white dark:bg-gray-800 z-10 px-3 py-2 font-medium text-gray-800 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap">
                      {member.user.name}
                      {isSelf && (
                        <span className="ml-1 text-[10px] text-primary-500">(You)</span>
                      )}
                    </td>
                    {days.map((date) => {
                      const status = getEffectiveStatus(member.entries, date);
                      const style = STATUS_STYLES[status];
                      const weekend = isWeekend(date);
                      const today = isToday(date);
                      const past = isPast(date);
                      const canEdit =
                        !weekend &&
                        !holidays[date] &&
                        (isAdmin || (isSelf && canMemberEdit(date)));

                      const isEditing =
                        editCell?.userId === member.user._id &&
                        editCell?.date === date;

                      const entry = member.entries[date];
                      const hasTime = entry?.startTime && entry?.endTime;
                      const hasNote = !!entry?.note;

                      // Conflict indicators
                      const isLeaveOnHoliday = entry?.status === 'leave' && holidays[date];
                      const hasTimeOnLeave = entry?.status === 'leave' && hasTime;

                      return (
                        <td
                          key={date}
                          className={`relative px-0.5 py-1 text-center ${
                            weekend ? 'bg-gray-100 dark:bg-gray-800' : ''
                          } ${today ? 'bg-primary-50/60 dark:bg-primary-900/20' : ''} ${
                            past && !isAdmin ? 'opacity-60' : ''
                          } ${canEdit ? 'cursor-pointer' : ''}`}
                          onClick={() => canEdit && handleCellClick(member.user._id, date, member.entries)}
                          title={buildTooltip(entry, date)}
                        >
                          {!weekend && (
                            <div className="relative inline-block">
                              <span
                                className={`inline-block w-7 h-7 leading-7 rounded-md text-xs font-medium ${style.bg}`}
                              >
                                {status === 'holiday'
                                  ? '🎉'
                                  : status === 'office'
                                  ? '🏢'
                                  : status === 'leave'
                                  ? '🌴'
                                  : '·'}
                              </span>
                              {/* Indicators for time / note */}
                              {(hasTime || hasNote) && (
                                <span className="absolute -top-1 -right-1 flex gap-px">
                                  {hasTime && <span className="text-[7px]">⏰</span>}
                                  {hasNote && <span className="text-[7px]">📝</span>}
                                </span>
                              )}
                              {/* Conflict: leave on holiday */}
                              {isLeaveOnHoliday && (
                                <span className="absolute -bottom-1 -left-1 text-[7px] bg-amber-200 rounded-full px-0.5">⚠️</span>
                              )}
                              {/* Conflict: time on leave */}
                              {hasTimeOnLeave && (
                                <span className="absolute -bottom-1 -right-1 text-[7px] bg-amber-200 rounded-full px-0.5">⚠️</span>
                              )}
                            </div>
                          )}

                          {/* Inline edit popover */}
                          {isEditing && (
                            <div
                              className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[260px] text-left"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Conflict warnings in popover */}
                              {holidays[editCell.date] && (
                                <div className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                                  ⚠️ This is a holiday: {holidays[editCell.date]}
                                </div>
                              )}

                              {/* Status buttons */}
                              <div className="flex gap-1">
                                {([
                                  { value: 'office' as const, label: '🏢 Office', hover: 'hover:bg-blue-50' },
                                  { value: 'leave' as const, label: '🌴 Leave', hover: 'hover:bg-orange-50' },
                                  { value: 'wfh' as const, label: '🏠 WFH', hover: 'hover:bg-green-50' },
                                ] as const).map((opt) => (
                                  <button
                                    key={opt.value}
                                    className={`flex-1 px-2 py-1 text-xs rounded border transition-all ${
                                      editCell.status === opt.value
                                        ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 font-semibold'
                                        : `border-gray-200 dark:border-gray-600 ${opt.hover}`
                                    }`}
                                    onClick={() => setEditCell({ ...editCell, status: opt.value })}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>

                              {/* Leave + time warning */}
                              {editCell.status === 'leave' && (editCell.startTime || editCell.endTime) && (
                                <div className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                                  ⚠️ Time window on leave is unusual
                                </div>
                              )}

                              {/* Time inputs */}
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 w-6">⏰</span>
                                <input
                                  type="time"
                                  value={editCell.startTime}
                                  onChange={(e) => setEditCell({ ...editCell, startTime: e.target.value })}
                                  className="flex-1 px-1.5 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                />
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">–</span>
                                <input
                                  type="time"
                                  value={editCell.endTime}
                                  onChange={(e) => setEditCell({ ...editCell, endTime: e.target.value })}
                                  className="flex-1 px-1.5 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                />
                                {(editCell.startTime || editCell.endTime) && (
                                  <button
                                    className="text-[10px] text-red-400 hover:text-red-600"
                                    onClick={() => setEditCell({ ...editCell, startTime: '', endTime: '' })}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>

                              {/* Time validation warning */}
                              {editCell.startTime && editCell.endTime && editCell.endTime <= editCell.startTime && (
                                <div className="text-[10px] text-red-500">
                                  ⚠️ End time must be after start time
                                </div>
                              )}

                              {/* Note */}
                              <textarea
                                value={editCell.note}
                                onChange={(e) =>
                                  setEditCell({ ...editCell, note: e.target.value.slice(0, 500) })
                                }
                                rows={2}
                                className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                placeholder="Note (optional, max 500)"
                              />

                              {/* Overwrite warning */}
                              {member.entries[date] && (
                                <div className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded">
                                  ℹ️ Will overwrite existing: {member.entries[date].status}
                                </div>
                              )}

                              {/* Actions */}
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                  {editCell.note.length}/500
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                                    onClick={() => setEditCell(null)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
                                    onClick={handleSaveEdit}
                                    disabled={saving}
                                  >
                                    {saving ? '…' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {!loading && (
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Showing {filteredTeam.length} of {team.length} team members · {days.length} days ·
          Click a cell to change status, set hours &amp; add notes ·
          Top row shows daily office/leave/WFH counts
        </div>
      )}
    </div>
  );
};

export default TeamCalendarPage;
