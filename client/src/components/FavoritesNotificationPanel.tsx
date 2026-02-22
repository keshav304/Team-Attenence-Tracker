import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationsApi } from '../api';
import type { FavoriteNotification } from '../types';
import AlignScheduleModal from './AlignScheduleModal';

const FavoritesNotificationPanel: React.FC = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<FavoriteNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<FavoriteNotification | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await notificationsApi.getUnreadCount();
      if (res.data.success && res.data.data) {
        setUnreadCount(res.data.data.count);
      }
    } catch {
      // silently fail
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.getAll();
      if (res.data.success && res.data.data) {
        setNotifications(res.data.data);
      }
    } catch {
      // silently fail
    }
  }, []);

  // Poll unread count every 60s
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch full list when panel opens
  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keyboard handling for dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      // Arrow key navigation within the dropdown
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = dropdownRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (!items || items.length === 0) return;
        const currentIdx = Array.from(items).findIndex((el) => el === document.activeElement);
        let nextIdx: number;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
        }
        items[nextIdx].focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleNotificationClick = async (n: FavoriteNotification) => {
    // Mark as read
    if (!n.isRead) {
      try {
        await notificationsApi.markAsRead(n._id);
        setNotifications((prev) =>
          prev.map((item) => (item._id === n._id ? { ...item, isRead: true } : item))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // ignore
      }
    }
    // Event notifications → navigate to Events page
    if (n.type === 'event_created' || n.type === 'event_updated') {
      setOpen(false);
      navigate('/events');
      return;
    }
    // Schedule notifications → open align modal with up-to-date read state
    setSelectedNotification({ ...n, isRead: true });
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const handleAlignApplied = () => {
    setSelectedNotification(null);
    fetchNotifications();
    fetchUnreadCount();
  };

  const formatTimeAgo = (dateStr: string) => {
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return '';
    const diff = Date.now() - parsed.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return parsed.toLocaleDateString();
  };

  return (
    <>
      <div className="relative" ref={panelRef}>
        {/* Star bell button */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors
            ${unreadCount > 0
              ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          aria-label={`Favorite notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? 'favorites-dropdown' : undefined}
          title="Favorite member updates"
        >
          <svg className="w-5 h-5" fill={unreadCount > 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {open && (
          <div
            ref={dropdownRef}
            id="favorites-dropdown"
            role="menu"
            aria-label="Favorite updates"
            className="absolute right-0 top-11 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                ⭐ Favorite Updates
              </h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Notification list */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  No favorite updates yet
                </div>
              )}
              {notifications.map((n) => {
                const isEventNotif = n.type === 'event_created' || n.type === 'event_updated';
                return (
                <button
                  key={n._id}
                  role="menuitem"
                  onClick={() => handleNotificationClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors ${
                    !n.isRead ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {!n.isRead && (
                      <span className="mt-1.5 w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                        {formatTimeAgo(n.createdAt)}{isEventNotif ? '' : (() => { const count = n.affectedDates?.length ?? 0; return ` · ${count} day${count !== 1 ? 's' : ''}`; })()}
                      </p>
                    </div>
                    <span className="text-xs text-primary-500 dark:text-primary-400 shrink-0 mt-0.5">
                      {isEventNotif ? 'View →' : 'Align →'}
                    </span>
                  </div>
                </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Align Schedule Modal */}
      {selectedNotification && (
        <AlignScheduleModal
          notification={selectedNotification}
          onClose={() => setSelectedNotification(null)}
          onApplied={handleAlignApplied}
        />
      )}
    </>
  );
};

export default FavoritesNotificationPanel;
