import React, { useEffect, useState, useCallback, useRef } from 'react';
import { entryApi, holidayApi } from '../api';
import { useAuth } from '../context/AuthContext';
import type { Entry, Holiday, StatusType } from '../types';
import {
  getCurrentMonth,
  offsetMonth,
  formatMonth,
  getDaysInMonth,
  isWeekend,
  isPast,
  isToday,
  getDayNumber,
  canMemberEdit,
  getDayOfWeek,
} from '../utils/date';
import toast from 'react-hot-toast';
import {
  BulkActionToolbar,
  CopyFromDateModal,
  RepeatPatternModal,
  CopyRangeModal,
  TemplatesPanel,
} from '../components/BulkActions';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local representation of a day's full data (status + meta). */
interface DayData {
  status: StatusType;
  note?: string;
  startTime?: string;
  endTime?: string;
}

const MyCalendarPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const [month, setMonth] = useState(getCurrentMonth);
  // Full entry data per date
  const [entries, setEntries] = useState<Record<string, DayData>>({});
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Detail modal state
  const [editDate, setEditDate] = useState<string | null>(null);
  const [modalStatus, setModalStatus] = useState<StatusType | 'wfh'>('wfh');
  const [modalNote, setModalNote] = useState('');
  const [modalStartTime, setModalStartTime] = useState('');
  const [modalEndTime, setModalEndTime] = useState('');
  const [saving, setSaving] = useState(false);

  // ─── Multi-select / drag state ───────────────
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // ─── Modal states for advanced features ──────
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showRepeatModal, setShowRepeatModal] = useState(false);
  const [showCopyRangeModal, setShowCopyRangeModal] = useState(false);

  const days = getDaysInMonth(month);
  const firstDayOfWeek = getDayOfWeek(days[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [entryRes, holidayRes] = await Promise.all([
        entryApi.getMyEntries(days[0], days[days.length - 1]),
        holidayApi.getHolidays(days[0], days[days.length - 1]),
      ]);

      const eMap: Record<string, DayData> = {};
      (entryRes.data.data || []).forEach((e: Entry) => {
        eMap[e.date] = {
          status: e.status,
          ...(e.note ? { note: e.note } : {}),
          ...(e.startTime ? { startTime: e.startTime } : {}),
          ...(e.endTime ? { endTime: e.endTime } : {}),
        };
      });
      setEntries(eMap);

      const hMap: Record<string, string> = {};
      (holidayRes.data.data || []).forEach((h: Holiday) => {
        hMap[h.date] = h.name;
      });
      setHolidays(hMap);
    } catch {
      toast.error('Failed to load calendar data');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Drag selection handlers ──────────────────
  const isSelectable = (date: string): boolean => {
    return !isWeekend(date) && !holidays[date] && (isAdmin || canMemberEdit(date));
  };

  const getDatesInRange = (start: string, end: string): string[] => {
    const ordered = start <= end ? [start, end] : [end, start];
    return days.filter((d) => d >= ordered[0] && d <= ordered[1] && isSelectable(d));
  };

  const handleMouseDown = (date: string) => {
    if (!isSelectable(date)) return;
    setIsDragging(true);
    setDragStart(date);
    setSelectedDates([date]);
  };

  const handleMouseEnter = (date: string) => {
    if (!isDragging || !dragStart || !isSelectable(date)) return;
    setSelectedDates(getDatesInRange(dragStart, date));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    const handler = () => { setIsDragging(false); };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, []);

  const toggleDateSelection = (date: string) => {
    if (!isSelectable(date)) return;
    setSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]
    );
  };

  // ─── Open single-day modal ─────────────────────
  const openModal = (date: string) => {
    if (selectedDates.length > 1) return;
    const existing = entries[date];
    setEditDate(date);
    setModalStatus(existing?.status || 'wfh');
    setModalNote(existing?.note || '');
    setModalStartTime(existing?.startTime || '');
    setModalEndTime(existing?.endTime || '');
  };

  const closeModal = () => {
    setEditDate(null);
    setSaving(false);
  };

  const handleSave = async () => {
    if (!editDate) return;

    if ((modalStartTime && !modalEndTime) || (!modalStartTime && modalEndTime)) {
      toast.error('Provide both start and end time, or leave both empty');
      return;
    }
    if (modalStartTime && modalEndTime && modalEndTime <= modalStartTime) {
      toast.error('End time must be after start time');
      return;
    }

    if (modalStatus === 'leave' && holidays[editDate]) {
      toast('This date is already a holiday', { icon: '⚠️' });
    }
    if (modalStatus === 'leave' && modalStartTime && modalEndTime) {
      toast('Setting time on a leave day is unusual', { icon: '⚠️' });
    }

    setSaving(true);
    try {
      if (modalStatus === 'wfh') {
        await entryApi.deleteEntry(editDate);
        setEntries((prev) => {
          const copy = { ...prev };
          delete copy[editDate];
          return copy;
        });
      } else {
        await entryApi.upsertEntry(editDate, modalStatus, {
          note: modalNote || '',
          startTime: modalStartTime || '',
          endTime: modalEndTime || '',
        });
        setEntries((prev) => ({
          ...prev,
          [editDate]: {
            status: modalStatus,
            ...(modalNote ? { note: modalNote } : {}),
            ...(modalStartTime ? { startTime: modalStartTime } : {}),
            ...(modalEndTime ? { endTime: modalEndTime } : {}),
          },
        }));
      }
      closeModal();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update');
      setSaving(false);
    }
  };

  const getStatusInfo = (date: string) => {
    if (isWeekend(date))
      return { label: '', bg: 'bg-gray-100', emoji: '', textColor: 'text-gray-300' };
    if (holidays[date])
      return {
        label: holidays[date],
        bg: 'bg-purple-50 border-purple-200',
        emoji: '🎉',
        textColor: 'text-purple-600',
      };
    const status = entries[date]?.status || 'wfh';
    if (status === 'office')
      return {
        label: 'Office',
        bg: 'bg-blue-50 border-blue-200',
        emoji: '🏢',
        textColor: 'text-blue-700',
      };
    if (status === 'leave')
      return {
        label: 'Leave',
        bg: 'bg-orange-50 border-orange-200',
        emoji: '🌴',
        textColor: 'text-orange-700',
      };
    return {
      label: 'WFH',
      bg: 'bg-green-50/50 border-gray-200',
      emoji: '🏠',
      textColor: 'text-green-600',
    };
  };

  // Stats
  const statuses = Object.values(entries).map((e) => e.status);
  const officeDays = statuses.filter((s) => s === 'office').length;
  const leaveDays = statuses.filter((s) => s === 'leave').length;
  const workingDays = days.filter((d) => !isWeekend(d) && !holidays[d]).length;
  const wfhDays = workingDays - officeDays - leaveDays;

  const formatDateLong = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">My Calendar</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMonth(offsetMonth(month, -1))}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            ◀
          </button>
          <span className="text-lg font-semibold min-w-[180px] text-center">
            {formatMonth(month)}
          </span>
          <button
            onClick={() => setMonth(offsetMonth(month, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            ▶
          </button>
          <button
            onClick={() => setMonth(getCurrentMonth())}
            className="ml-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Today
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{officeDays}</div>
          <div className="text-xs text-gray-500 mt-1">🏢 Office</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{wfhDays}</div>
          <div className="text-xs text-gray-500 mt-1">🏠 WFH</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{leaveDays}</div>
          <div className="text-xs text-gray-500 mt-1">🌴 Leave</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-700">{workingDays}</div>
          <div className="text-xs text-gray-500 mt-1">Working Days</div>
        </div>
      </div>

      {/* ─── Action Toolbar ───────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setShowRepeatModal(true)}
          className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 font-medium">
          🔄 Repeat Pattern
        </button>
        <button onClick={() => setShowCopyRangeModal(true)}
          className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 font-medium">
          ⚡ Copy Week/Month
        </button>
        {selectedDates.length > 0 && (
          <button onClick={() => setShowCopyModal(true)}
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 font-medium">
            📋 Copy From Date → {selectedDates.length} selected
          </button>
        )}
        {selectedDates.length > 0 && (
          <button onClick={() => setSelectedDates([])}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600">
            Clear selection
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      <BulkActionToolbar
        selectedDates={selectedDates}
        holidays={holidays}
        entries={entries}
        onDone={fetchData}
        onClearSelection={() => setSelectedDates([])}
      />

      <div className="flex gap-4">
        {/* Calendar */}
        <div className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4" ref={calendarRef}>
              {/* Weekday headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {WEEKDAY_NAMES.map((name) => (
                  <div
                    key={name}
                    className="text-center text-xs font-semibold text-gray-500 py-1"
                  >
                    {name}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1 select-none">
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}

                {days.map((date) => {
                  const info = getStatusInfo(date);
                  const weekend = isWeekend(date);
                  const today = isToday(date);
                  const past = isPast(date);
                  const canEdit =
                    !weekend && !holidays[date] && (isAdmin || canMemberEdit(date));
                  const dayData = entries[date];
                  const hasTime = dayData?.startTime && dayData?.endTime;
                  const hasNote = !!dayData?.note;
                  const isSelected = selectedDates.includes(date);

                  // Conflict indicators
                  const isLeaveOnHoliday = dayData?.status === 'leave' && holidays[date];
                  const hasTimeOnLeave = dayData?.status === 'leave' && hasTime;

                  return (
                    <div
                      key={date}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (canEdit) {
                          if (e.ctrlKey || e.metaKey) {
                            toggleDateSelection(date);
                          } else {
                            handleMouseDown(date);
                          }
                        }
                      }}
                      onMouseEnter={() => handleMouseEnter(date)}
                      onMouseUp={() => {
                        handleMouseUp();
                        if (canEdit && selectedDates.length <= 1 && dragStart === date) {
                          openModal(date);
                        }
                      }}
                      className={`
                        relative rounded-lg border p-2 min-h-[80px] transition-all
                        ${info.bg}
                        ${today ? 'ring-2 ring-primary-400 ring-offset-1' : ''}
                        ${canEdit ? 'cursor-pointer hover:shadow-md' : ''}
                        ${past && !isAdmin ? 'opacity-50' : ''}
                        ${weekend ? 'border-transparent' : ''}
                        ${isSelected ? 'ring-2 ring-indigo-400 ring-offset-1 shadow-md' : ''}
                      `}
                      title={
                        holidays[date]
                          ? holidays[date]
                          : `${info.label}${hasTime ? ` (${dayData.startTime}–${dayData.endTime})` : ''}${hasNote ? ` — ${dayData.note}` : ''}`
                      }
                    >
                      <div
                        className={`text-xs font-semibold ${
                          today ? 'text-primary-600' : info.textColor
                        }`}
                      >
                        {getDayNumber(date)}
                      </div>
                      {!weekend && (
                        <>
                          <div className="text-lg text-center mt-0.5">{info.emoji}</div>
                          <div className="text-[10px] text-center font-medium truncate">
                            {holidays[date] ? holidays[date] : info.label}
                          </div>
                          {hasTime && (
                            <div className="text-[9px] text-center text-gray-500 mt-0.5 leading-tight">
                              ⏰ {dayData.startTime}–{dayData.endTime}
                            </div>
                          )}
                          {hasNote && (
                            <div className="absolute top-1 right-1 text-[9px]" title={dayData.note}>
                              📝
                            </div>
                          )}
                          {isLeaveOnHoliday && (
                            <div className="absolute bottom-0.5 left-0.5 text-[8px] bg-amber-100 text-amber-700 px-1 rounded">
                              ⚠️
                            </div>
                          )}
                          {hasTimeOnLeave && (
                            <div className="absolute bottom-0.5 right-0.5 text-[8px] bg-amber-100 text-amber-700 px-1 rounded">
                              ⏰⚠️
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute top-0.5 left-0.5 text-[10px] bg-indigo-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                              ✓
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-gray-500">
            Click a date to edit · Drag to select range · Ctrl+Click for multi-select
          </p>
        </div>

        {/* ─── Side Panel: Templates ──────────── */}
        <div className="w-72 flex-shrink-0 hidden lg:block">
          <TemplatesPanel selectedDates={selectedDates} onApplied={() => { fetchData(); setSelectedDates([]); }} />
        </div>
      </div>

      {/* ─── Modals ────────────────────────────── */}
      {showCopyModal && (
        <CopyFromDateModal
          selectedDates={selectedDates}
          onDone={() => { fetchData(); setSelectedDates([]); }}
          onClose={() => setShowCopyModal(false)}
        />
      )}

      {showRepeatModal && (
        <RepeatPatternModal
          onDone={fetchData}
          onClose={() => setShowRepeatModal(false)}
        />
      )}

      {showCopyRangeModal && (
        <CopyRangeModal
          onDone={fetchData}
          onClose={() => setShowCopyRangeModal(false)}
        />
      )}

      {/* ─── Day Detail Modal ──────────────────── */}
      {editDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              {formatDateLong(editDate)}
            </h2>
            <p className="text-xs text-gray-500 mb-5">Set your status, hours &amp; note for this day</p>

            {/* Conflict warnings */}
            {holidays[editDate] && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                ⚠️ This date is a holiday: {holidays[editDate]}
              </div>
            )}
            {entries[editDate] && (
              <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                ℹ️ This will overwrite the existing entry ({entries[editDate].status})
              </div>
            )}

            {/* Status Selector */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <div className="flex gap-2">
                {([
                  { value: 'office' as const, label: '🏢 Office', ring: 'ring-blue-400', bg: 'bg-blue-50' },
                  { value: 'leave' as const, label: '🌴 Leave', ring: 'ring-orange-400', bg: 'bg-orange-50' },
                  { value: 'wfh' as const, label: '🏠 WFH', ring: 'ring-green-400', bg: 'bg-green-50' },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setModalStatus(opt.value)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                      modalStatus === opt.value
                        ? `${opt.bg} ring-2 ${opt.ring} border-transparent`
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Leave + time warning */}
            {modalStatus === 'leave' && (modalStartTime || modalEndTime) && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                ⚠️ Setting a time window on a leave day is unusual
              </div>
            )}

            {/* Active Time Window */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Active Hours <span className="text-gray-400 font-normal">(optional, IST)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={modalStartTime}
                  onChange={(e) => setModalStartTime(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="time"
                  value={modalEndTime}
                  onChange={(e) => setModalEndTime(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {(modalStartTime || modalEndTime) && (
                  <button
                    type="button"
                    onClick={() => { setModalStartTime(''); setModalEndTime(''); }}
                    className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
                    title="Clear times"
                  >
                    ✕
                  </button>
                )}
              </div>
              {modalStartTime && modalEndTime && modalEndTime <= modalStartTime && (
                <p className="text-xs text-red-500 mt-1">⚠️ End time must be after start time</p>
              )}
            </div>

            {/* Note */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Note <span className="text-gray-400 font-normal">(optional, max 500 chars)</span>
              </label>
              <textarea
                value={modalNote}
                onChange={(e) => setModalNote(e.target.value.slice(0, 500))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="e.g. Doctor appointment, half day, late start…"
              />
              <div className="text-right text-[10px] text-gray-400 mt-0.5">
                {modalNote.length}/500
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyCalendarPage;
