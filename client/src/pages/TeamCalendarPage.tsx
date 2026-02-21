import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { entryApi, holidayApi, statusApi, eventApi } from '../api';
import { useAuth } from '../context/AuthContext';
import type { TeamMemberData, Holiday, StatusType, EntryDetail, DaySummary, TodayStatusResponse, CalendarEvent } from '../types';
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
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Building2,
  Palmtree,
  Home,
  PartyPopper,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

const STATUS_CONFIG: Record<string, {
  color: string;
  icon: LucideIcon;
  label: string;
  fullColor: string;
  emoji: string;
}> = {
  office: { color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30', icon: Building2, label: 'Office', fullColor: 'bg-blue-600', emoji: '🏢' },
  leave: { color: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30', icon: Palmtree, label: 'Leave', fullColor: 'bg-green-600', emoji: '🌴' },
  wfh: { color: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30', icon: Home, label: 'WFH', fullColor: 'bg-amber-600', emoji: '🏠' },
  holiday: { color: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30', icon: PartyPopper, label: 'Holiday', fullColor: 'bg-red-600', emoji: '🎉' },
  weekend: { color: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-300/30', icon: Home, label: '', fullColor: 'bg-gray-400', emoji: '' },
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

  const [summary, setSummary] = useState<Record<string, DaySummary>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'office' | 'leave' | 'wfh'>('all');
  const [filterDate, setFilterDate] = useState('');

  const [todayStatus, setTodayStatus] = useState<TodayStatusResponse | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventDetailList, setEventDetailList] = useState<CalendarEvent[]>([]);
  const [eventDetailIdx, setEventDetailIdx] = useState(0);

  const days = getDaysInMonth(month);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollWeek = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const colWidth = 100; // min-w-[100px] per day column
    const offset = colWidth * 7; // one week
    scrollRef.current.scrollBy({
      left: direction === 'right' ? offset : -offset,
      behavior: 'smooth',
    });
  };

  const filteredTeam = useMemo(() => {
    let result = team;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      if (filterDate) {
        // Filter by status on the specific chosen date
        result = result.filter((m) => {
          const effective = getEffectiveStatusForFilter(m.entries, filterDate);
          return effective === statusFilter;
        });
      } else {
        // No date chosen — show members who have this status on ANY weekday in the month
        result = result.filter((m) =>
          days.some((d) => {
            if (isWeekend(d) || holidays[d]) return false;
            return getEffectiveStatusForFilter(m.entries, d) === statusFilter;
          })
        );
      }
    }
    return result;
  }, [team, searchQuery, statusFilter, filterDate, holidays, days]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, holidayRes, summaryRes, eventRes] = await Promise.all([
        entryApi.getTeamEntries(month),
        holidayApi.getHolidays(days[0], days[days.length - 1]),
        entryApi.getTeamSummary(month),
        eventApi.getEvents(days[0], days[days.length - 1]).catch(() => null),
      ]);
      setTeam(teamRes.data.data?.team || []);

      const hMap: Record<string, string> = {};
      (holidayRes.data.data || []).forEach((h: Holiday) => {
        hMap[h.date] = h.name;
      });
      setHolidays(hMap);
      setSummary(summaryRes.data.data || {});
      setEvents(eventRes?.data.data || []);
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
      // Silently fail
    } finally {
      setTodayLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchTodayStatus(); }, [fetchTodayStatus]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editCell) setEditCell(null);
        else if (eventDetailList.length > 0) setEventDetailList([]);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editCell, eventDetailList]);

  const getEffectiveStatus = (
    memberEntries: Record<string, EntryDetail>,
    date: string
  ): string => {
    if (isWeekend(date)) return 'weekend';
    if (holidays[date]) return 'holiday';
    return memberEntries[date]?.status || 'wfh';
  };

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
    if (status === 'leave' && holidays[date]) {
      toast('This date is already a holiday', { icon: '⚠️' });
    }

    setSaving(true);
    try {
      const isSelf = userId === user?._id;
      const opts = { note: note || '', startTime: startTime || '', endTime: endTime || '' };

      if (status === 'wfh') {
        if (isAdmin && !isSelf) await entryApi.adminDeleteEntry(userId, date);
        else await entryApi.deleteEntry(date);
      } else {
        if (isAdmin && !isSelf) await entryApi.adminUpsertEntry(userId, date, status, opts);
        else await entryApi.upsertEntry(date, status, opts);
      }

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

      setSummary((prev) => {
        const copy = { ...prev };
        if (copy[date]) {
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

  const buildTooltip = (entry: EntryDetail | undefined, date: string): string => {
    if (holidays[date]) return `🎉 ${holidays[date]}`;
    if (!entry) return 'WFH';
    const parts = [STATUS_CONFIG[entry.status]?.label || entry.status];
    if (entry.startTime && entry.endTime) parts.push(`⏰ ${entry.startTime}–${entry.endTime}`);
    if (entry.note) parts.push(`📝 ${entry.note}`);
    return parts.join(' · ');
  };

  const buildSummaryTooltip = (date: string): string => {
    const s = summary[date];
    if (!s) return '';
    return `🏢 ${s.office} in office · 🌴 ${s.leave} on leave · 🏠 ${s.wfh} WFH`;
  };

  const eventsMap = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((ev) => {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }, [events]);

  return (
    <div className="space-y-6">
      {/* ─── Header Section (glass panel) ─────────────── */}
      <div className="glass-panel p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">Team Calendar</h1>
            <div className="flex items-center gap-2">
              {Object.entries(STATUS_CONFIG)
                .filter(([key]) => key !== 'weekend')
                .map(([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <span
                      key={key}
                      className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium ${config.fullColor} text-white`}
                    >
                      <Icon size={14} />
                      {config.label}
                    </span>
                  );
                })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setMonth(offsetMonth(month, -1))}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-700 dark:text-gray-300"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="px-4 font-medium min-w-[160px] text-center text-gray-900 dark:text-gray-100">
                {formatMonth(month)}
              </span>
              <button
                onClick={() => setMonth(offsetMonth(month, 1))}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-700 dark:text-gray-300"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              onClick={() => setMonth(getCurrentMonth())}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors text-gray-700 dark:text-gray-300"
            >
              Today
            </button>
          </div>
        </div>

        {/* Today's Status Banner */}
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-3 flex items-center gap-3 text-blue-700 dark:text-blue-400">
          <span className="text-base">📌</span>
          <span className="text-sm font-medium">
            {todayLoading && !todayStatus && "Loading today's status…"}
            {!todayLoading && !todayStatus && "Today's status unavailable"}
            {todayStatus?.isWeekend && "Today's Status: Weekend 🥳 It's the weekend — enjoy your time off!"}
            {todayStatus?.isHoliday && `Today's Status: Holiday 🎉 Today is ${todayStatus.holidayName || 'a holiday'}!`}
            {todayStatus && !todayStatus.isWeekend && !todayStatus.isHoliday && (
              <>Today&apos;s Status: {todayStatus.counts.office} in office · {todayStatus.counts.leave} on leave · {todayStatus.counts.wfh} WFH</>
            )}
          </span>
        </div>
      </div>

      {/* ─── Filters & Grid Section (glass panel) ─────────────── */}
      <div className="glass-panel overflow-hidden">
        {/* Search & Filter Bar */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search by name or email..."
              className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Status on</span>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              min={days[0]}
              max={days[days.length - 1]}
              className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm w-40 text-gray-700 dark:text-gray-300 focus:outline-none"
            />

            <div className="flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-1">
              {([
                { value: 'all' as const, label: 'All', icon: null },
                { value: 'office' as const, label: null, icon: Building2 },
                { value: 'leave' as const, label: null, icon: Palmtree },
                { value: 'wfh' as const, label: null, icon: Home },
              ] as const).map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      statusFilter === opt.value
                        ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                        : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    title={opt.value === 'all' ? 'Show all' : `Show ${opt.value} only`}
                  >
                    {opt.label ? opt.label : Icon && <Icon size={14} />}
                  </button>
                );
              })}
            </div>

            <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
              {filteredTeam.length}/{team.length}
            </span>
            {(searchQuery || statusFilter !== 'all') && (
              <button
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); setFilterDate(''); }}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          </div>
        ) : (
          <div className="relative flex items-stretch">
            {/* Left scroll arrow */}
            <button
              type="button"
              onClick={() => scrollWeek('left')}
              className="sticky left-0 z-20 flex items-center justify-center px-1 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-r border-gray-200 dark:border-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Scroll left one week"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="overflow-x-auto flex-1" ref={scrollRef}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="sticky left-0 bg-white dark:bg-gray-900/80 backdrop-blur-sm z-10 p-4 text-left text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[200px]">
                    <div className="space-y-1">
                      <div>Team Member</div>
                      <div className="text-xs font-normal">Availability</div>
                    </div>
                  </th>
                  {days.map((date) => {
                    const weekend = isWeekend(date);
                    const today = isToday(date);
                    const isHoliday = !!holidays[date];
                    const s = summary[date];
                    const dateEvents = eventsMap[date] || [];
                    const hasEvents = dateEvents.length > 0;
                    const isMandatory = dateEvents.some(
                      (e) => e.eventType === 'mandatory-office' || /mandatory/i.test(e.title)
                    );
                    const totalCount = s ? (s.office + s.leave + s.wfh) : 0;
                    return (
                      <th
                        key={date}
                        className={`p-3 text-center min-w-[100px] ${
                          weekend || isHoliday ? 'bg-gray-50 dark:bg-gray-800/30' : ''
                        } ${today ? 'bg-primary-50/50 dark:bg-primary-900/20' : ''} ${
                          isMandatory ? 'bg-red-50 dark:bg-red-900/20' : ''
                        }`}
                        title={
                          hasEvents
                            ? dateEvents.map((e) => `📌 ${e.title}`).join('\n')
                            : buildSummaryTooltip(date)
                        }
                      >
                        <div className="space-y-1">
                          <div className={`text-sm font-medium ${
                            weekend ? 'text-gray-400 dark:text-gray-500' : today ? 'text-primary-600' : 'text-gray-700 dark:text-gray-300'
                          }`}>
                            {getShortDayName(date)} {getDayNumber(date)}
                          </div>
                          <div className="text-xs font-normal text-gray-400 dark:text-gray-500">
                            {!weekend && !isHoliday && s ? totalCount : isHoliday ? '🎉' : weekend ? '' : '0'}
                          </div>
                          {hasEvents && (
                            <div
                              className="flex justify-center gap-0.5 cursor-pointer"
                              onClick={() => { setEventDetailList(dateEvents); setEventDetailIdx(0); }}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full ${isMandatory ? 'bg-red-500' : 'bg-amber-500'}`} />
                            </div>
                          )}
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
                      className={`border-b border-gray-100 dark:border-gray-800/50 transition-colors ${
                        isSelf ? 'bg-primary-50/20 dark:bg-primary-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/20'
                      }`}
                    >
                      <td className="sticky left-0 bg-white dark:bg-gray-900/80 backdrop-blur-sm z-10 p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-300">
                            {member.user.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {member.user.name}
                            {isSelf && <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(You)</span>}
                          </span>
                        </div>
                      </td>
                      {days.map((date) => {
                        const status = getEffectiveStatus(member.entries, date);
                        const config = STATUS_CONFIG[status];
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
                        const CellIcon = config?.icon;

                        return (
                          <td
                            key={date}
                            className={`relative p-2 text-center ${
                              weekend ? 'bg-gray-50 dark:bg-gray-800/30' : ''
                            } ${today ? 'bg-primary-50/30 dark:bg-primary-900/10' : ''} ${
                              past && !isAdmin ? 'opacity-60' : ''
                            } ${canEdit ? 'cursor-pointer' : ''}`}
                            onClick={() => canEdit && handleCellClick(member.user._id, date, member.entries)}
                            title={buildTooltip(entry, date)}
                          >
                            {!weekend && config && status !== 'weekend' && (
                              <div className="relative">
                                <div
                                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${config.color} w-full justify-center hover:brightness-110 transition-all`}
                                >
                                  {CellIcon && <CellIcon size={14} />}
                                  <span className="text-xs font-bold uppercase tracking-wider">{config.label}</span>
                                </div>
                                {(hasTime || hasNote) && (
                                  <span className="absolute -top-1 -right-1 flex gap-px">
                                    {hasTime && <span className="text-[7px]">⏰</span>}
                                    {hasNote && <span className="text-[7px]">📝</span>}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Inline edit popover */}
                            {isEditing && (
                              <div
                                className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[260px] text-left"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {holidays[editCell.date] && (
                                  <div className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                                    ⚠️ This is a holiday: {holidays[editCell.date]}
                                  </div>
                                )}

                                <div className="flex gap-1">
                                  {([
                                    { value: 'office' as const, label: 'Office', icon: Building2, hover: 'hover:bg-blue-50 dark:hover:bg-blue-900/20' },
                                    { value: 'leave' as const, label: 'Leave', icon: Palmtree, hover: 'hover:bg-green-50 dark:hover:bg-green-900/20' },
                                    { value: 'wfh' as const, label: 'WFH', icon: Home, hover: 'hover:bg-amber-50 dark:hover:bg-amber-900/20' },
                                  ] as const).map((opt) => {
                                    const BtnIcon = opt.icon;
                                    return (
                                      <button
                                        key={opt.value}
                                        className={`flex-1 px-2 py-1.5 text-xs rounded border transition-all flex items-center justify-center gap-1 ${
                                          editCell.status === opt.value
                                            ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 font-semibold'
                                            : `border-gray-200 dark:border-gray-600 ${opt.hover}`
                                        }`}
                                        onClick={() => setEditCell({ ...editCell, status: opt.value })}
                                      >
                                        <BtnIcon size={12} />
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>

                                {editCell.status === 'leave' && (editCell.startTime || editCell.endTime) && (
                                  <div className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                                    ⚠️ Time window on leave is unusual
                                  </div>
                                )}

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

                                {editCell.startTime && editCell.endTime && editCell.endTime <= editCell.startTime && (
                                  <div className="text-[10px] text-red-500">
                                    ⚠️ End time must be after start time
                                  </div>
                                )}

                                <textarea
                                  value={editCell.note}
                                  onChange={(e) =>
                                    setEditCell({ ...editCell, note: e.target.value.slice(0, 500) })
                                  }
                                  rows={2}
                                  className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                  placeholder="Note (optional, max 500)"
                                />

                                {member.entries[date] && (
                                  <div className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded">
                                    ℹ️ Will overwrite existing: {member.entries[date].status}
                                  </div>
                                )}

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

            {/* Right scroll arrow */}
            <button
              type="button"
              onClick={() => scrollWeek('right')}
              className="sticky right-0 z-20 flex items-center justify-center px-1 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-l border-gray-200 dark:border-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Scroll right one week"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="p-4 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-500">
            <span>Showing {filteredTeam.length} of {team.length} team members · {days.length} days · Click a cell to change status, set hours &amp; add notes · Top row shows daily office/leave/WFH counts</span>
          </div>
        )}
      </div>

      {/* Event Detail Modal */}
      {eventDetailList.length > 0 && (() => {
        const eventDetail = eventDetailList[eventDetailIdx];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50" onClick={() => setEventDetailList([])}>
            <div
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {eventDetailList.length > 1 && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Event {eventDetailIdx + 1} of {eventDetailList.length}
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">📌</span>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{eventDetail.title}</h2>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {new Date(eventDetail.date + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              </div>
              {eventDetail.eventType && (
                <div className="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 mb-3">
                  {eventDetail.eventType}
                </div>
              )}
              {eventDetail.description && (
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{eventDetail.description}</p>
              )}
              {eventDetail.createdBy && (
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  Created by {eventDetail.createdBy.name || eventDetail.createdBy.email || 'Unknown'}
                </p>
              )}
              <div className="flex justify-between items-center mt-4">
                <div className="flex gap-2">
                  {eventDetailList.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEventDetailIdx((i) => Math.max(0, i - 1))}
                        disabled={eventDetailIdx === 0}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
                      >
                        ← Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setEventDetailIdx((i) => Math.min(eventDetailList.length - 1, i + 1))}
                        disabled={eventDetailIdx === eventDetailList.length - 1}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
                      >
                        Next →
                      </button>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEventDetailList([])}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default TeamCalendarPage;
