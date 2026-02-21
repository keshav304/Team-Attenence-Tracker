import React, { useState, useEffect, useMemo } from 'react';
import { entryApi, templateApi } from '../api';
import type { Template, StatusType } from '../types';
import {
  getTodayString,
  getMaxPlanDate,
  getDayOfWeek,
  isWeekend,
  toISTDateString,
} from '../utils/date';
import toast from 'react-hot-toast';

// ─── Shared types ─────────────────────────────
interface BulkActionProps {
  selectedDates: string[];
  holidays: Record<string, string>;
  onDone: () => void;
  onClearSelection: () => void;
}

// ─── Conflict check helper ────────────────────
const checkConflicts = (
  dates: string[],
  holidays: Record<string, string>,
  status: string,
  startTime: string,
  endTime: string,
  existingEntries: Record<string, { status: string }>,
): string[] => {
  const warnings: string[] = [];
  const holidayDates = dates.filter((d) => holidays[d]);
  if (holidayDates.length > 0 && status === 'leave') {
    warnings.push(`${holidayDates.length} date(s) are already holidays`);
  }
  if (status === 'leave' && startTime && endTime) {
    warnings.push('Setting time window on leave days is unusual');
  }
  if (startTime && endTime && endTime <= startTime) {
    warnings.push('End time is before start time');
  }
  const overwriteCount = dates.filter((d) => existingEntries[d]).length;
  if (overwriteCount > 0) {
    warnings.push(`Will overwrite ${overwriteCount} existing entries`);
  }
  return warnings;
};

// ═══════════════════════════════════════════════
// 1. BULK ACTION TOOLBAR
// ═══════════════════════════════════════════════
export const BulkActionToolbar: React.FC<
  BulkActionProps & { entries: Record<string, { status: StatusType; note?: string; startTime?: string; endTime?: string }> }
> = ({ selectedDates, holidays, onDone, onClearSelection, entries }) => {
  const [status, setStatus] = useState<'office' | 'leave' | 'clear'>('office');
  const [note, setNote] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [loading, setLoading] = useState(false);

  const warnings = checkConflicts(selectedDates, holidays, status, startTime, endTime, entries);

  const handleApply = async () => {
    if (selectedDates.length === 0) return;
    setLoading(true);
    try {
      const res = await entryApi.bulkSet(
        selectedDates,
        status,
        status !== 'clear' ? { note: note || undefined, startTime: startTime || undefined, endTime: endTime || undefined } : undefined,
      );
      const data = res.data.data;
      if (data) {
        toast.success(`${data.processed} dates updated, ${data.skipped} skipped`);
      } else {
        toast.success('Bulk operation completed');
      }
      onDone();
      onClearSelection();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Bulk operation failed');
    } finally {
      setLoading(false);
    }
  };

  if (selectedDates.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-800 rounded-xl shadow-lg p-3 sm:p-4 mb-4 animate-in slide-in-from-top transition-colors">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200">
          Bulk Action — {selectedDates.length} date{selectedDates.length > 1 ? 's' : ''} selected
        </h3>
        <button onClick={onClearSelection} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          Clear selection
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {/* Status */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Status</label>
          <div className="flex gap-1">
            {(['office', 'leave', 'clear'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-2 sm:py-1.5 text-xs rounded-lg border transition-all ${
                  status === s
                    ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 font-semibold'
                    : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                {s === 'office' ? '🏢 Office' : s === 'leave' ? '🌴 Leave' : '🏠 Clear (WFH)'}
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        {status !== 'clear' && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Time (optional)</label>
            <div className="flex items-center gap-1">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
              <span className="text-xs text-gray-400 dark:text-gray-500">–</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
          </div>
        )}

        {/* Note */}
        {status !== 'clear' && (
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))}
              className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              placeholder="Note for all dates" />
          </div>
        )}

        <button onClick={handleApply} disabled={loading}
          className="px-4 py-2 sm:py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 self-start sm:self-auto">
          {loading ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {warnings.map((w, i) => (
            <span key={i} className="text-[10px] bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
              ⚠️ {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════
// 2. COPY FROM DATE MODAL
// ═══════════════════════════════════════════════
export const CopyFromDateModal: React.FC<{
  selectedDates: string[];
  onDone: () => void;
  onClose: () => void;
}> = ({ selectedDates, onDone, onClose }) => {
  const [sourceDate, setSourceDate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCopy = async () => {
    if (!sourceDate || selectedDates.length === 0) return;
    setLoading(true);
    try {
      const res = await entryApi.copyFromDate(sourceDate, selectedDates);
      const data = res.data.data!;
      toast.success(`Copied from ${sourceDate}: ${data.processed} updated, ${data.skipped} skipped`);
      onDone();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Copy failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="responsive-modal-backdrop" onClick={onClose}>
      <div className="responsive-modal p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Copy From Date</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Copy the status, time window, and note from a source date to {selectedDates.length} selected date(s).
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Date</label>
          <input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Dates</label>
          <div className="text-xs text-gray-500 dark:text-gray-400 max-h-20 overflow-y-auto">
            {[...selectedDates].sort().join(', ')}
          </div>        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300">Cancel</button>
          <button onClick={handleCopy} disabled={loading || !sourceDate}
            className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {loading ? 'Copying…' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════
// 3. REPEAT PATTERN MODAL
// ═══════════════════════════════════════════════
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const RepeatPatternModal: React.FC<{
  onDone: () => void;
  onClose: () => void;
}> = ({ onDone, onClose }) => {
  const [status, setStatus] = useState<'office' | 'leave' | 'clear'>('office');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(getTodayString());
  const [endDate, setEndDate] = useState(getMaxPlanDate());
  const [note, setNote] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleDay = (d: number) => {
    setDaysOfWeek((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  };

  const handleRepeat = async () => {
    if (daysOfWeek.length === 0) { toast.error('Select at least one day'); return; }
    setLoading(true);
    try {
      const res = await entryApi.repeatPattern({
        status,
        daysOfWeek,
        startDate,
        endDate,
        note: note || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
      });
      const data = res.data.data!;
      toast.success(`Repeat applied: ${data.processed} dates updated, ${data.skipped} skipped`);
      onDone();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Repeat failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="responsive-modal-backdrop" onClick={onClose}>
      <div className="responsive-modal p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Repeat Pattern</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Apply a status to specific days of the week across a date range.
        </p>

        {/* Status */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
          <div className="flex gap-2">
            {(['office', 'leave', 'clear'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={`flex-1 py-2 rounded-lg text-sm border transition-all ${
                  status === s ? 'bg-primary-50 dark:bg-primary-900/30 ring-2 ring-primary-400 border-transparent font-semibold' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}>
                {s === 'office' ? '🏢 Office' : s === 'leave' ? '🌴 Leave' : '🏠 Clear'}
              </button>
            ))}
          </div>
        </div>

        {/* Days of week */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Days of Week</label>
          <div className="flex gap-1">
            {DAY_NAMES.map((name, i) => (
              <button key={i} onClick={() => toggleDay(i)}
                className={`flex-1 py-2 rounded-lg text-xs border transition-all ${
                  daysOfWeek.includes(i)
                    ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 font-semibold'
                    : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                } ${(i === 0 || i === 6) ? 'text-gray-400 dark:text-gray-500' : ''}`}>
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              min={getTodayString()} max={getMaxPlanDate()}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              min={startDate} max={getMaxPlanDate()}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>

        {/* Time */}
        {status !== 'clear' && (
          <div className="mb-4">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Active Hours (optional)</label>
            <div className="flex items-center gap-2">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
              <span className="text-sm text-gray-400 dark:text-gray-500">to</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
          </div>
        )}

        {/* Note */}
        {status !== 'clear' && (
          <div className="mb-4">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              placeholder="e.g. Late shift, half day…" />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300">Cancel</button>
          <button onClick={handleRepeat} disabled={loading || daysOfWeek.length === 0}
            className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {loading ? 'Applying…' : 'Apply Pattern'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════
// 4. QUICK TEMPLATES PANEL
// ═══════════════════════════════════════════════
export const TemplatesPanel: React.FC<{
  selectedDates: string[];
  onApplied: () => void;
}> = ({ selectedDates, onApplied }) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStatus, setNewStatus] = useState<'office' | 'leave'>('office');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    templateApi.getTemplates()
      .then((res) => setTemplates(res.data.data || []))
      .catch((err) => {
        console.error('Failed to load templates:', err);
        toast.error('Failed to load templates');
        setTemplates([]);
      });
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('Name is required'); return; }
    setLoading(true);
    try {
      const res = await templateApi.createTemplate({
        name: newName.trim(),
        status: newStatus,
        startTime: newStartTime || undefined,
        endTime: newEndTime || undefined,
        note: newNote || undefined,
      });
      setTemplates((prev) => [...prev, res.data.data!]);
      setShowCreate(false);
      setNewName(''); setNewStartTime(''); setNewEndTime(''); setNewNote('');
      toast.success('Template created');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create template');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await templateApi.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t._id !== id));
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const handleApply = async (template: Template) => {
    if (selectedDates.length === 0) {
      toast.error('Select dates first to apply template');
      return;
    }
    setLoading(true);
    try {
      await entryApi.bulkSet(selectedDates, template.status, {
        note: template.note,
        startTime: template.startTime,
        endTime: template.endTime,
      });
      toast.success(`Template "${template.name}" applied to ${selectedDates.length} dates`);
      onApplied();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to apply template');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">⚡ Quick Templates</h3>
        <button onClick={() => setShowCreate(!showCreate)}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium">
          {showCreate ? 'Cancel' : '+ New'}
        </button>
      </div>

      {/* Template list */}
      {templates.length === 0 && !showCreate && (
        <p className="text-xs text-gray-400 dark:text-gray-500">No templates yet. Create one to get started.</p>
      )}

      <div className="space-y-1.5">
        {templates.map((t) => (
          <div key={t._id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg group">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{t.name}</span>
              <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500">
                {t.status === 'office' ? '🏢' : '🌴'} {t.status}
                {t.startTime && ` ⏰ ${t.startTime}–${t.endTime}`}
                {t.note && ` 📝 ${t.note}`}
              </span>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleApply(t)}
                disabled={selectedDates.length === 0 || loading}
                className="text-[10px] px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded hover:bg-primary-200 dark:hover:bg-primary-900/50 disabled:opacity-50"
                title={selectedDates.length === 0 ? 'Select dates first' : `Apply to ${selectedDates.length} dates`}>
                Apply
              </button>
              <button onClick={() => handleDelete(t._id)}
                className="text-[10px] px-2 py-0.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-100 dark:hover:bg-red-900/50">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-2">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Template name" className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          <div className="flex gap-1">
            <button onClick={() => setNewStatus('office')}
              className={`flex-1 py-1 text-xs rounded border ${newStatus === 'office' ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 font-semibold' : 'border-gray-200 dark:border-gray-600'}`}>
              🏢 Office
            </button>
            <button onClick={() => setNewStatus('leave')}
              className={`flex-1 py-1 text-xs rounded border ${newStatus === 'leave' ? 'bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 font-semibold' : 'border-gray-200 dark:border-gray-600'}`}>
              🌴 Leave
            </button>
          </div>
          <div className="flex items-center gap-1">
            <input type="time" value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <span className="text-[10px] text-gray-400 dark:text-gray-500">–</span>
            <input type="time" value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          </div>
          <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value.slice(0, 500))}
            placeholder="Default note (optional)" className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          <button onClick={handleCreate} disabled={loading || !newName.trim()}
            className="w-full py-1.5 bg-primary-600 text-white text-xs rounded hover:bg-primary-700 disabled:opacity-50">
            {loading ? 'Creating…' : 'Create Template'}
          </button>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════
// 5. COPY WEEK/MONTH MODAL
// ═══════════════════════════════════════════════
export const CopyRangeModal: React.FC<{
  onDone: () => void;
  onClose: () => void;
}> = ({ onDone, onClose }) => {
  const [mode, setMode] = useState<'last-week' | 'last-month' | 'custom'>('last-week');
  const [customSourceStart, setCustomSourceStart] = useState('');
  const [customSourceEnd, setCustomSourceEnd] = useState('');
  const [customTargetStart, setCustomTargetStart] = useState('');
  const [loading, setLoading] = useState(false);

  const todayStr = getTodayString();

  const lastWeekRange = useMemo(() => {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const d = new Date(nowIST);
    const dayOfWeek = d.getDay();
    // last Monday
    const lastMonday = new Date(d);
    lastMonday.setDate(d.getDate() - dayOfWeek - 6);
    const lastFriday = new Date(lastMonday);
    lastFriday.setDate(lastMonday.getDate() + 4);
    const thisMonday = new Date(d);
    thisMonday.setDate(d.getDate() - dayOfWeek + 1);
    return {
      sourceStart: toISTDateString(lastMonday),
      sourceEnd: toISTDateString(lastFriday),
      targetStart: toISTDateString(thisMonday),
    };
  }, []);

  const lastMonthRange = useMemo(() => {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const lastMonth = new Date(nowIST.getFullYear(), nowIST.getMonth() - 1, 1);
    const lastMonthEnd = new Date(nowIST.getFullYear(), nowIST.getMonth(), 0);
    const thisMonthStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
    return {
      sourceStart: toISTDateString(lastMonth),
      sourceEnd: toISTDateString(lastMonthEnd),
      targetStart: toISTDateString(thisMonthStart),
    };
  }, []);

  const handleCopy = async () => {
    setLoading(true);
    try {
      let sourceStart: string, sourceEnd: string, targetStart: string;
      if (mode === 'last-week') {
        sourceStart = lastWeekRange.sourceStart; sourceEnd = lastWeekRange.sourceEnd; targetStart = lastWeekRange.targetStart;
      } else if (mode === 'last-month') {
        sourceStart = lastMonthRange.sourceStart; sourceEnd = lastMonthRange.sourceEnd; targetStart = lastMonthRange.targetStart;
      } else {
        sourceStart = customSourceStart; sourceEnd = customSourceEnd; targetStart = customTargetStart;
      }

      const res = await entryApi.copyRange(sourceStart, sourceEnd, targetStart);
      const data = res.data.data!;
      toast.success(`Range copied: ${data.processed} dates updated, ${data.skipped} skipped`);
      onDone();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Copy range failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="responsive-modal-backdrop" onClick={onClose}>
      <div className="responsive-modal p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Copy Week / Month</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Quickly replicate a previous period's plan.</p>

        {/* Mode selector */}
        <div className="flex gap-2 mb-4">
          {([
            ['last-week', '📅 Last Week → This Week'],
            ['last-month', '📆 Last Month → This Month'],
            ['custom', '🔧 Custom Range'],
          ] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 text-xs rounded-lg border transition-all ${
                mode === m ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 font-semibold' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Preview for preset modes */}
        {mode === 'last-week' && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            {`${lastWeekRange.sourceStart} → ${lastWeekRange.sourceEnd} copied to start at ${lastWeekRange.targetStart}`}
          </div>
        )}
        {mode === 'last-month' && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            {`${lastMonthRange.sourceStart} → ${lastMonthRange.sourceEnd} copied to start at ${lastMonthRange.targetStart}`}
          </div>
        )}

        {/* Custom inputs */}
        {mode === 'custom' && (
          <div className="space-y-3 mb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Source Start</label>
                <input type="date" value={customSourceStart} onChange={(e) => setCustomSourceStart(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Source End</label>
                <input type="date" value={customSourceEnd} onChange={(e) => setCustomSourceEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Target Start Date</label>
              <input type="date" value={customTargetStart} onChange={(e) => setCustomTargetStart(e.target.value)}
                min={todayStr}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={handleCopy} disabled={loading}
            className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {loading ? 'Copying…' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
};
