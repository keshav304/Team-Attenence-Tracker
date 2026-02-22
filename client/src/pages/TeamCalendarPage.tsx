import React, { useEffect, useState, useCallback, useMemo, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import { entryApi, holidayApi, statusApi, eventApi, templateApi } from '../api';
import { useAuth } from '../context/AuthContext';
import type { TeamMemberData, Holiday, StatusType, EntryDetail, DaySummary, TodayStatusResponse, CalendarEvent, Template, LeaveDuration, HalfDayPortion, WorkingPortion } from '../types';
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

/* ─── Styled Tooltip ──────────────────────────────── */
const Tooltip: React.FC<{ text: string; children: React.ReactNode; position?: 'top' | 'bottom' }> = ({ text, children, position = 'bottom' }) => (
  <span className="relative group/tip inline-flex">
    {children}
    <span
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-white dark:text-gray-900 shadow-lg opacity-0 scale-95 transition-all duration-150 group-hover/tip:opacity-100 group-hover/tip:scale-100 ${
        position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      {text}
      <span
        className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${
          position === 'top'
            ? 'top-full border-t-gray-900 dark:border-t-gray-100'
            : 'bottom-full border-b-gray-900 dark:border-b-gray-100'
        }`}
      />
    </span>
  </span>
);

const STATUS_CONFIG: Record<string, {
  color: string;
  icon: LucideIcon;
  label: string;
  fullColor: string;
  emoji: string;
  tooltip: string;
}> = {
  office: { color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30', icon: Building2, label: 'Office', fullColor: 'bg-blue-600', emoji: '🏢', tooltip: 'Working from the office' },
  leave: { color: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30', icon: Palmtree, label: 'Leave', fullColor: 'bg-green-600', emoji: '🌴', tooltip: 'On leave / day off' },
  wfh: { color: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30', icon: Home, label: 'WFH', fullColor: 'bg-amber-600', emoji: '🏠', tooltip: 'Working from home' },
  holiday: { color: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30', icon: PartyPopper, label: 'Holiday', fullColor: 'bg-red-600', emoji: '🎉', tooltip: 'Public holiday' },
  weekend: { color: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-300/30', icon: Home, label: '', fullColor: 'bg-gray-400', emoji: '', tooltip: '' },
};

interface EditCellState {
  userId: string;
  date: string;
  status: StatusType | 'wfh';
  note: string;
  startTime: string;
  endTime: string;
  leaveDuration: LeaveDuration;
  halfDayPortion: HalfDayPortion;
  workingPortion: WorkingPortion;
}

/* ─── Error Boundary ──────────────────────────────── */
interface EBProps { children: ReactNode }
interface EBState { hasError: boolean }

class TeamCalendarErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError(): EBState { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TeamCalendar] Render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-gray-500 dark:text-gray-400">Something went wrong displaying the calendar.</p>
          <button
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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

  const [templates, setTemplates] = useState<Template[]>([]);

  const days = useMemo(() => getDaysInMonth(month), [month]);
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
    try {
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
            const entries = m.entries ?? {};
            if (isWeekend(filterDate) || holidays[filterDate]) return statusFilter === 'wfh';
            const status = entries[filterDate]?.status;
            const effective: string = status || 'wfh';
            return effective === statusFilter;
          });
        } else {
          // No date chosen — show members who have this status on ANY weekday in the month
          result = result.filter((m) => {
            const entries = m.entries ?? {};
            return days.some((d) => {
              if (isWeekend(d) || holidays[d]) return false;
              const status = entries[d]?.status;
              const effective: string = status || 'wfh';
              return effective === statusFilter;
            });
          });
        }
      }
      return result;
    } catch (err) {
      console.error('[TeamCalendar] Filter error:', err);
      return team;
    }
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
  }, [month, days]);

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
    templateApi.getTemplates()
      .then((res) => setTemplates(res.data.data || []))
      .catch((err) => console.warn('[TeamCalendar] Failed to load templates:', err));
  }, []);

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
      leaveDuration: existing?.leaveDuration || 'full',
      halfDayPortion: existing?.halfDayPortion || 'first-half',
      workingPortion: existing?.workingPortion || 'wfh',
    });
  };

  const handleSaveEdit = async () => {
    if (!editCell) return;
    const { userId, date, status, note, startTime, endTime, leaveDuration, halfDayPortion, workingPortion } = editCell;

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
      const opts: Record<string, any> = { note: note || '', startTime: startTime || '', endTime: endTime || '' };
      if (status === 'leave' && leaveDuration === 'half') {
        opts.leaveDuration = 'half';
        opts.halfDayPortion = halfDayPortion;
        opts.workingPortion = workingPortion;
      } else if (status === 'leave') {
        opts.leaveDuration = 'full';
        opts.halfDayPortion = undefined;
        opts.workingPortion = undefined;
      }

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
              ...(status === 'leave' && leaveDuration === 'half'
                ? { leaveDuration, halfDayPortion, workingPortion }
                : {}),
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
    if (entry.leaveDuration === 'half') {
      const wp = entry.workingPortion === 'office' ? 'Office' : 'WFH';
      parts[0] = `½ Leave (${entry.halfDayPortion === 'first-half' ? 'AM' : 'PM'}) + ${wp}`;
    }
    if (entry.startTime && entry.endTime) parts.push(`⏰ ${entry.startTime}–${entry.endTime}`);
    if (entry.note) parts.push(`📝 ${entry.note}`);
    return parts.join(' · ');
  };

  const buildSummaryTooltip = (date: string): string => {
    const s = summary[date];
    if (!s) return '';
    const parts = [`🏢 ${s.office} in office · 🌴 ${s.leave} on leave · 🏠 ${s.wfh} WFH`];
    if (s.halfDayLeave && s.halfDayLeave > 0) {
      parts.push(`(${s.halfDayLeave} half-day leave)`);
    }
    return parts.join(' ');
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
    <div className="space-y-4 sm:space-y-6">
      {/* ─── Header Section (glass panel) ─────────────── */}
      <div className="glass-panel p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <h1 className="text-xl sm:text-3xl font-semibold text-gray-900 dark:text-gray-100">Team Calendar</h1>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {Object.entries(STATUS_CONFIG)
                .filter(([key]) => key !== 'weekend')
                .map(([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <Tooltip key={key} text={config.tooltip}>
                      <span
                        className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium ${config.fullColor} text-white cursor-default`}
                      >
                        <Icon size={12} className="sm:hidden" />
                        <Icon size={14} className="hidden sm:block" />
                        {config.label}
                      </span>
                    </Tooltip>
                  );
                })}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 flex-1 sm:flex-none">
              <button
                onClick={() => setMonth(offsetMonth(month, -1))}
                className="p-2 sm:p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-700 dark:text-gray-300"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="px-2 sm:px-4 font-medium min-w-[120px] sm:min-w-[160px] text-center text-sm sm:text-base text-gray-900 dark:text-gray-100">
                {formatMonth(month)}
              </span>
              <button
                onClick={() => setMonth(offsetMonth(month, 1))}
                className="p-2 sm:p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-700 dark:text-gray-300"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              onClick={() => setMonth(getCurrentMonth())}
              className="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 whitespace-nowrap"
            >
              Today
            </button>
          </div>
        </div>

        {/* Today's Status Banner */}
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-2.5 sm:p-3 flex items-center gap-2 sm:gap-3 text-blue-700 dark:text-blue-400">
          <span className="text-base shrink-0">📌</span>
          <span className="text-xs sm:text-sm font-medium leading-relaxed">
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
        <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-800 space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search by name or email..."
              className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg py-2.5 sm:py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">Status on</span>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              min={days[0]}
              max={days[days.length - 1]}
              className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm w-36 sm:w-40 text-gray-700 dark:text-gray-300 focus:outline-none"
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
                  <Tooltip
                    key={opt.value}
                    text={opt.value === 'all' ? 'Show all statuses' : `Filter: ${opt.value === 'wfh' ? 'Work from Home' : opt.value === 'office' ? 'Office' : 'Leave'} only`}
                  >
                    <button
                      onClick={() => setStatusFilter(opt.value)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        statusFilter === opt.value
                          ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                          : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    >
                      {opt.label ? opt.label : Icon && <Icon size={14} />}
                    </button>
                  </Tooltip>
                );
              })}
            </div>

            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1 sm:ml-2">
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
                  <th className="sticky left-0 bg-white dark:bg-gray-900/80 backdrop-blur-sm z-10 p-2 sm:p-4 text-left text-sm font-medium text-gray-500 dark:text-gray-400 min-w-[130px] sm:min-w-[200px]">
                    <div className="space-y-0.5 sm:space-y-1">
                      <div className="text-xs sm:text-sm">Team Member</div>
                      <div className="text-[10px] sm:text-xs font-normal">Availability</div>
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
                        className={`p-1.5 sm:p-3 text-center min-w-[56px] sm:min-w-[100px] ${
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
                      <td className="sticky left-0 bg-white dark:bg-gray-900/80 backdrop-blur-sm z-10 p-2 sm:p-4">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] sm:text-xs font-bold text-gray-700 dark:text-gray-300 shrink-0">
                            {member.user.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 truncate max-w-[70px] sm:max-w-none">
                            {member.user.name}
                            {isSelf && <span className="text-gray-400 dark:text-gray-500 font-normal ml-1 hidden sm:inline">(You)</span>}
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
                                  className={`inline-flex items-center gap-1 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border ${
                                    entry?.leaveDuration === 'half'
                                      ? 'bg-gradient-to-b from-green-500/20 to-amber-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30'
                                      : config.color
                                  } w-full justify-center hover:brightness-110 transition-all`}
                                >
                                  {entry?.leaveDuration === 'half' ? (
                                    <>
                                      <span className="text-[10px] sm:text-xs font-bold">½</span>
                                      <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">Leave</span>
                                    </>
                                  ) : (
                                    <>
                                      {CellIcon && <CellIcon size={12} className="shrink-0" />}
                                      <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">{config.label}</span>
                                    </>
                                  )}
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
                                className="fixed sm:absolute inset-x-3 bottom-3 sm:inset-auto sm:top-full sm:left-1/2 sm:-translate-x-1/2 sm:mt-1 z-30 sm:z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl sm:rounded-lg shadow-2xl sm:shadow-lg p-4 sm:p-3 flex flex-col gap-2.5 sm:gap-2 sm:min-w-[260px] text-left"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {holidays[editCell.date] && (
                                  <div className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                                    ⚠️ This is a holiday: {holidays[editCell.date]}
                                  </div>
                                )}

                                {/* Template picker */}
                                {templates.length > 0 && (
                                  <div>
                                    <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Apply Template</label>
                                    <select
                                      className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                      value=""
                                      onChange={(e) => {
                                        const tpl = templates.find((t) => t._id === e.target.value);
                                        if (tpl) {
                                          setEditCell((prev) => prev ? {
                                            ...prev,
                                            status: tpl.status,
                                            note: tpl.note || '',
                                            startTime: tpl.startTime || '',
                                            endTime: tpl.endTime || '',
                                            leaveDuration: (tpl.leaveDuration as LeaveDuration) || 'full',
                                            halfDayPortion: (tpl.halfDayPortion as HalfDayPortion) || 'first-half',
                                            workingPortion: (tpl.workingPortion as WorkingPortion) || 'wfh',
                                          } : prev);
                                        }
                                      }}
                                    >
                                      <option value="">— Select a template —</option>
                                      {templates.map((t) => {
                                        const statusEmoji: Record<string, string> = { office: '🏢', leave: '🌴', wfh: '🏠' };
                                        const emoji = statusEmoji[t.status] ?? '📋';
                                        return (
                                          <option key={t._id} value={t._id}>
                                            {t.name} ({emoji} {t.status}{t.startTime ? ` ⏰${t.startTime}–${t.endTime}` : ''})
                                          </option>
                                        );
                                      })}
                                    </select>
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

                                {/* Half-day leave options */}
                                {editCell.status === 'leave' && (
                                  <div className="space-y-1.5 p-2 bg-orange-50/50 dark:bg-orange-900/10 rounded border border-orange-100 dark:border-orange-900/30">
                                    <div className="flex gap-1">
                                      <button
                                        className={`flex-1 py-1 text-[10px] rounded border transition-all ${
                                          editCell.leaveDuration === 'full' ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 font-semibold' : 'border-gray-200 dark:border-gray-600'
                                        }`}
                                        onClick={() => setEditCell({ ...editCell, leaveDuration: 'full' })}
                                      >Full Day</button>
                                      <button
                                        className={`flex-1 py-1 text-[10px] rounded border transition-all ${
                                          editCell.leaveDuration === 'half' ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 font-semibold' : 'border-gray-200 dark:border-gray-600'
                                        }`}
                                        onClick={() => setEditCell({ ...editCell, leaveDuration: 'half' })}
                                      >Half Day</button>
                                    </div>
                                    {editCell.leaveDuration === 'half' && (
                                      <>
                                        <div className="flex gap-1">
                                          <button
                                            className={`flex-1 py-1 text-[10px] rounded border transition-all ${
                                              editCell.halfDayPortion === 'first-half' ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 font-semibold' : 'border-gray-200 dark:border-gray-600'
                                            }`}
                                            onClick={() => setEditCell({ ...editCell, halfDayPortion: 'first-half' })}
                                          >🌅 AM</button>
                                          <button
                                            className={`flex-1 py-1 text-[10px] rounded border transition-all ${
                                              editCell.halfDayPortion === 'second-half' ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 font-semibold' : 'border-gray-200 dark:border-gray-600'
                                            }`}
                                            onClick={() => setEditCell({ ...editCell, halfDayPortion: 'second-half' })}
                                          >🌇 PM</button>
                                        </div>
                                        <div className="flex gap-1">
                                          <button
                                            className={`flex-1 py-1 text-[10px] rounded border transition-all ${
                                              editCell.workingPortion === 'wfh' ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 font-semibold' : 'border-gray-200 dark:border-gray-600'
                                            }`}
                                            onClick={() => setEditCell({ ...editCell, workingPortion: 'wfh' })}
                                          >🏠 WFH</button>
                                          <button
                                            className={`flex-1 py-1 text-[10px] rounded border transition-all ${
                                              editCell.workingPortion === 'office' ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 font-semibold' : 'border-gray-200 dark:border-gray-600'
                                            }`}
                                            onClick={() => setEditCell({ ...editCell, workingPortion: 'office' })}
                                          >🏢 Office</button>
                                        </div>
                                      </>
                                    )}
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
          <div className="p-3 sm:p-4 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-500">
            <span className="leading-relaxed">Showing {filteredTeam.length} of {team.length} team members · {days.length} days<span className="hidden sm:inline"> · Click a cell to change status, set hours &amp; add notes · Top row shows daily office/leave/WFH counts</span></span>
          </div>
        )}
      </div>
      {/* Event Detail Modal Section*/}
      {eventDetailList.length > 0 && (() => {
        const eventDetail = eventDetailList[eventDetailIdx];
        return (
          <div className="responsive-modal-backdrop" onClick={() => setEventDetailList([])}>
            <div
              className="responsive-modal p-5 sm:p-6"
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

function TeamCalendarPageWithBoundary() {
  return (
    <TeamCalendarErrorBoundary>
      <TeamCalendarPage />
    </TeamCalendarErrorBoundary>
  );
}

export default TeamCalendarPageWithBoundary;
