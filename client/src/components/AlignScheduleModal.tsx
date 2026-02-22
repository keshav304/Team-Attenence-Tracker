import React, { useState, useEffect, useCallback, useRef } from 'react';
import { scheduleApi } from '../api';
import type { MatchPreviewResponse, FavoriteNotification } from '../types';
import { getShortDayName, getDayNumber } from '../utils/date';
import toast from 'react-hot-toast';

interface AlignScheduleModalProps {
  notification: FavoriteNotification;
  onClose: () => void;
  onApplied: () => void;
}

const CLASSIFICATION_CONFIG: Record<string, { label: string; badge: string; badgeColor: string; icon: string }> = {
  will_be_added: {
    label: 'Will Be Added',
    badge: 'Added',
    badgeColor: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    icon: '✅',
  },
  conflict_leave: {
    label: 'Conflict (Leave)',
    badge: 'Leave Conflict',
    badgeColor: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    icon: '⚠️',
  },
  locked: {
    label: 'Locked',
    badge: 'Locked',
    badgeColor: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
    icon: '🔒',
  },
  already_matching: {
    label: 'Already Matching',
    badge: 'Matching',
    badgeColor: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    icon: '⏭️',
  },
};

const AlignScheduleModal: React.FC<AlignScheduleModalProps> = ({
  notification,
  onClose,
  onApplied,
}) => {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<MatchPreviewResponse | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [overrideLeave, setOverrideLeave] = useState(false);
  const [staleWarning, setStaleWarning] = useState(false);

  const mountedRef = useRef(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Focus the modal container on mount
    modalRef.current?.focus();
    return () => {
      mountedRef.current = false;
      // Restore focus on unmount
      previousFocusRef.current?.focus();
    };
  }, []);

  const sourceUserId = notification.sourceUser != null && typeof notification.sourceUser === 'object'
    ? notification.sourceUser._id
    : notification.sourceUser;

  const sourceName = notification.sourceUser != null && typeof notification.sourceUser === 'object'
    ? notification.sourceUser.name
    : 'User';

  const fetchPreview = useCallback(async () => {
    if (!sourceUserId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setStaleWarning(false);
    try {
      const dates = notification.affectedDates;
      if (dates.length === 0) {
        if (mountedRef.current) setPreview(null);
        return;
      }
      const startDate = dates.reduce((a, b) => (a < b ? a : b));
      const endDate = dates.reduce((a, b) => (a > b ? a : b));

      const res = await scheduleApi.matchPreview(sourceUserId, startDate, endDate);
      if (!mountedRef.current) return;
      if (res.data.success && res.data.data) {
        setPreview(res.data.data);
        // Auto-select "will_be_added" dates
        const autoSelect = new Set<string>();
        res.data.data.preview.forEach((d) => {
          if (d.classification === 'will_be_added') {
            autoSelect.add(d.date);
          }
        });
        setSelectedDates(autoSelect);
      } else if (res.data.success && !res.data.data) {
        setPreview(null);
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (err.response?.status === 409) {
        setStaleWarning(true);
      } else {
        toast.error('Failed to load schedule preview');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [notification.affectedDates, sourceUserId]);

  useEffect(() => { fetchPreview(); }, [fetchPreview]);

  const toggleDate = (date: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (!sourceUserId) {
      toast.error('Source user is unavailable');
      return;
    }
    if (selectedDates.size === 0) {
      toast.error('No dates selected');
      return;
    }
    setApplying(true);
    try {
      const res = await scheduleApi.matchApply(
        sourceUserId,
        Array.from(selectedDates),
        overrideLeave,
      );
      if (!mountedRef.current) return;
      if (res.data.success && res.data.data) {
        const { processed, skipped } = res.data.data;
        if (processed > 0) {
          toast.success(`Aligned ${processed} day${processed > 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
          onApplied();
        } else {
          toast.error('No changes could be applied');
        }
      } else if (res.data.success && !res.data.data) {
        toast.error('No changes could be applied');
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (err.response?.status === 409) {
        setStaleWarning(true);
        toast.error('Schedule has changed. Please review again.');
      } else {
        toast.error(err.response?.data?.message || 'Failed to apply alignment');
      }
    } finally {
      if (mountedRef.current) setApplying(false);
    }
  };

  const addableDates = preview?.preview.filter((d) => d.classification === 'will_be_added') || [];
  const conflictDates = preview?.preview.filter((d) => d.classification === 'conflict_leave') || [];
  const lockedDates = preview?.preview.filter((d) => d.classification === 'locked') || [];
  const matchingDates = preview?.preview.filter((d) => d.classification === 'already_matching') || [];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !applying) {
      onClose();
    }
  };

  return (
    <div
      className="responsive-modal-backdrop"
      onClick={() => { if (!applying) onClose(); }}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Align Schedule"
        tabIndex={-1}
        className="responsive-modal p-0 max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            🤝 Align Schedule
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Match your office days with <span className="font-medium text-gray-700 dark:text-gray-300">{sourceName}</span>
          </p>
        </div>

        {/* Content */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12" role="status">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <span className="sr-only">Loading schedule preview…</span>
            </div>
          )}

          {!sourceUserId && !loading && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
              ⚠️ Source user is unavailable. This notification may be outdated.
            </div>
          )}

          {staleWarning && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
              ⚠️ Schedule has changed. Please review again.
              <button
                onClick={fetchPreview}
                className="ml-2 text-amber-800 dark:text-amber-300 underline hover:no-underline text-sm"
              >
                Refresh
              </button>
            </div>
          )}

          {!loading && preview && !staleWarning && (
            <>
              {preview.preview.length === 0 && (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                  No office days to align with for the given dates.
                </div>
              )}

              {/* Will Be Added */}
              {addableDates.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    ✅ Will Be Added ({addableDates.length})
                  </h3>
                  <div className="space-y-1.5">
                    {addableDates.map((d) => (
                      <label
                        key={d.date}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDates.has(d.date)}
                          onChange={() => toggleDate(d.date)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {getShortDayName(d.date)} {getDayNumber(d.date)}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{d.date}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${CLASSIFICATION_CONFIG.will_be_added.badgeColor}`}>
                          {CLASSIFICATION_CONFIG.will_be_added.badge}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Conflict (Leave) */}
              {conflictDates.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    ⚠️ Leave Conflicts ({conflictDates.length})
                  </h3>
                  <div className="mb-2">
                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overrideLeave}
                        onChange={(e) => {
                          setOverrideLeave(e.target.checked);
                          if (!e.target.checked) {
                            // Deselect all conflict dates
                            setSelectedDates((prev) => {
                              const next = new Set(prev);
                              conflictDates.forEach((d) => next.delete(d.date));
                              return next;
                            });
                          }
                        }}
                        className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-amber-600 focus:ring-amber-500 dark:bg-gray-700"
                      />
                      Allow overriding leave days
                    </label>
                  </div>
                  <div className="space-y-1.5">
                    {conflictDates.map((d) => (
                      <label
                        key={d.date}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors ${
                          overrideLeave
                            ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer'
                            : 'opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedDates.has(d.date)}
                          onChange={() => overrideLeave && toggleDate(d.date)}
                          disabled={!overrideLeave}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-amber-600 focus:ring-amber-500 dark:bg-gray-700"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {getShortDayName(d.date)} {getDayNumber(d.date)}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{d.date}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${CLASSIFICATION_CONFIG.conflict_leave.badgeColor}`}>
                          {CLASSIFICATION_CONFIG.conflict_leave.badge}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Already Matching */}
              {matchingDates.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    ⏭️ Already Matching ({matchingDates.length})
                  </h3>
                  <div className="space-y-1.5">
                    {matchingDates.map((d) => (
                      <div
                        key={d.date}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 opacity-60"
                      >
                        <div className="w-4 h-4 flex items-center justify-center text-green-500">✓</div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {getShortDayName(d.date)} {getDayNumber(d.date)}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{d.date}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${CLASSIFICATION_CONFIG.already_matching.badgeColor}`}>
                          {CLASSIFICATION_CONFIG.already_matching.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Locked */}
              {lockedDates.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    🔒 Locked ({lockedDates.length})
                  </h3>
                  <div className="space-y-1.5">
                    {lockedDates.map((d) => (
                      <div
                        key={d.date}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 opacity-50"
                      >
                        <div className="w-4 h-4 flex items-center justify-center text-gray-400">🔒</div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                            {getShortDayName(d.date)} {getDayNumber(d.date)}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{d.date}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${CLASSIFICATION_CONFIG.locked.badgeColor}`}>
                          {CLASSIFICATION_CONFIG.locked.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {selectedDates.size} day{selectedDates.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={applying}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying || selectedDates.size === 0 || loading || !sourceUserId}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {applying ? 'Applying…' : `Align ${selectedDates.size} Day${selectedDates.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlignScheduleModal;
