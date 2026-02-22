import React, { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { pushApi, type PushPreferences } from '../api';
import {
  isPushSupported,
  getNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getExistingSubscription,
} from '../utils/pwa';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
/** Local required version — all keys are set in component state. */
interface NotificationPreferences extends Required<PushPreferences> {}

type PreferenceKey = keyof NotificationPreferences;

const PREF_LABELS: Record<PreferenceKey, { label: string; description: string }> = {
  teamStatusChanges: {
    label: 'Team status changes',
    description: 'When a teammate changes their status for today',
  },
  weeklyReminder: {
    label: 'Weekly reminders',
    description: 'Reminder to fill in next week\'s schedule',
  },
  adminAnnouncements: {
    label: 'Admin announcements',
    description: 'New holidays or events from admin',
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
const NotificationBell: React.FC = () => {
  const [supported] = useState(isPushSupported);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(getNotificationPermission);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    teamStatusChanges: true,
    weeklyReminder: true,
    adminAnnouncements: true,
  });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /* ── Load current state from server ── */
  useEffect(() => {
    if (!supported) return;

    pushApi
      .getStatus()
      .then((res) => {
        const d = res.data.data;
        if (d) {
          setSubscribed(d.subscribed);
          setPreferences({
            teamStatusChanges: d.preferences.teamStatusChanges ?? true,
            weeklyReminder: d.preferences.weeklyReminder ?? true,
            adminAnnouncements: d.preferences.adminAnnouncements ?? true,
          });
        }
      })
      .catch(() => {});
  }, [supported]);

  /* ── Close panel on outside click ── */
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

  /* ── Subscribe / Unsubscribe ── */
  const handleToggleSubscription = useCallback(async () => {
    setLoading(true);
    try {
      if (subscribed) {
        // Get current subscription to send endpoint to server
        const existing = await getExistingSubscription();
        if (existing) {
          await pushApi.unsubscribe(existing.endpoint);
        }
        await unsubscribeFromPush();
        setSubscribed(false);
        toast.success('Notifications disabled');
      } else {
        const subscription = await subscribeToPush();
        if (!subscription) {
          if (Notification.permission === 'denied') {
            toast.error('Notifications blocked. Please allow them in browser settings.');
          } else {
            toast.error('Could not enable notifications. Check VAPID key configuration.');
          }
          setPermission(getNotificationPermission());
          return;
        }
        const subJson = subscription.toJSON();
        const endpoint = subJson.endpoint;
        const p256dh = subJson.keys?.p256dh;
        const auth = subJson.keys?.auth;
        if (!endpoint || typeof endpoint !== 'string' || !p256dh || typeof p256dh !== 'string' || !auth || typeof auth !== 'string') {
          console.error('[NotificationBell] Invalid subscription JSON:', subJson);
          toast.error('Invalid push subscription data.');
          return;
        }
        const keys: { p256dh: string; auth: string } = { p256dh, auth };
        await pushApi.subscribe(
          endpoint,
          keys,
          { ...preferences },
        );
        setSubscribed(true);
        setPermission('granted');
        toast.success('Notifications enabled!');
      }
    } catch (err) {
      console.error('[NotificationBell] toggle error:', err);
      toast.error('Failed to update notification settings');
    } finally {
      setLoading(false);
    }
  }, [subscribed, preferences]);

  /* ── Update preference ── */
  const handlePrefChange = useCallback(
    async (key: PreferenceKey, value: boolean) => {
      const prevValueHolder: { v: boolean | undefined } = { v: undefined };
      setPreferences((prev) => {
        prevValueHolder.v = prev[key];
        return { ...prev, [key]: value };
      });
      if (subscribed) {
        try {
          // Read the latest preferences for the API call
          let latestPrefs: NotificationPreferences | undefined;
          setPreferences((prev) => {
            latestPrefs = prev;
            return prev;
          });
          await pushApi.updatePreferences({ ...latestPrefs! });
        } catch {
          toast.error('Failed to update preferences');
          setPreferences((prev) => ({ ...prev, [key]: prevValueHolder.v as boolean }));
        }
      }
    },
    [subscribed]
  );

  if (!supported) return null;

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors
          ${subscribed
            ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        aria-label={subscribed ? 'Notification settings (enabled)' : 'Enable notifications'}
        title={subscribed ? 'Notifications enabled' : 'Enable notifications'}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          {subscribed ? (
            // Filled bell
            <>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </>
          ) : (
            // Outlined bell with slash
            <>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.143 17.082a24.248 24.248 0 003.857.918m0 0a24.248 24.248 0 003.857-.918m-7.714 0a3 3 0 005.714 0M18 9.75V9A6 6 0 006 9v.75"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3.75l16.5 16.5"
              />
            </>
          )}
        </svg>
        {/* Active dot */}
        {subscribed && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              🔔 Push Notifications
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {subscribed
                ? 'Manage your notification preferences'
                : 'Enable push notifications to stay updated'}
            </p>
          </div>

          {/* Enable/Disable toggle */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <button
              onClick={handleToggleSubscription}
              disabled={loading || permission === 'denied'}
              className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                subscribed
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  : 'bg-primary-600 text-white hover:bg-primary-700'
              } disabled:opacity-50`}
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : subscribed ? (
                'Disable notifications'
              ) : (
                'Enable notifications'
              )}
            </button>
            {permission === 'denied' && (
              <p className="text-xs text-red-500 mt-2 text-center">
                Notifications are blocked. Please update your browser settings.
              </p>
            )}
          </div>

          {/* Preferences */}
          {subscribed && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Notify me about
              </p>
              {(Object.keys(PREF_LABELS) as PreferenceKey[]).map((key) => (
                <label
                  key={key}
                  className="flex items-start gap-3 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    onChange={(e) => handlePrefChange(key, e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                      {PREF_LABELS[key].label}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {PREF_LABELS[key].description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Install PWA hint */}
          {!window.matchMedia('(display-mode: standalone)').matches && (
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-750 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                💡 Tip: Install dhSync as an app from your browser menu for the best experience.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
