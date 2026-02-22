import webPush from 'web-push';
import config from '../config/index.js';
import PushSubscription, { IPushSubscription } from '../models/PushSubscription.js';

/* ── Initialise web-push with VAPID keys ──────── */
if (
  config.vapidPublicKey &&
  config.vapidPrivateKey &&
  config.vapidSubject &&
  typeof config.vapidSubject === 'string' &&
  config.vapidSubject.length > 0
) {
  webPush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey
  );
} else if (config.vapidPublicKey && config.vapidPrivateKey) {
  console.warn('[Push] vapidSubject is missing or empty — skipping VAPID initialisation.');
}

/** Payload shape expected by our service worker */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Send a push notification to a single subscription.
 * Returns `true` on success. On 410 (Gone) the stale subscription is removed.
 */
async function sendToSubscription(
  sub: IPushSubscription,
  payload: PushPayload
): Promise<boolean> {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return false;

  try {
    await webPush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 } // 1 hour
    );
    return true;
  } catch (error: any) {
    // 404 or 410 → subscription expired / unsubscribed
    if (error.statusCode === 404 || error.statusCode === 410) {
      await PushSubscription.deleteOne({ _id: sub._id });
      console.info(`[Push] Removed stale subscription ${sub.endpoint.slice(0, 40)}…`);
    } else {
      console.error('[Push] Failed to send notification:', error.message);
    }
    return false;
  }
}

/* ── Public helpers ───────────────────────────── */

/**
 * Notify all subscribers of a specific user.
 */
export async function notifyUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  const subs = await PushSubscription.find({ userId });
  const results = await Promise.all(
    subs.map((sub) => sendToSubscription(sub, payload))
  );
  return results.filter(Boolean).length;
}

/**
 * Notify all subscribers who have a specific preference enabled,
 * optionally excluding a particular user (e.g. the actor who triggered
 * the event).
 *
 * Sends are dispatched in parallel with a concurrency limit to avoid
 * overwhelming the push service while still being significantly faster
 * than a fully sequential loop.
 */
const PUSH_CONCURRENCY = 10;

export async function notifyAllWithPreference(
  preferenceKey: keyof IPushSubscription['preferences'],
  payload: PushPayload,
  excludeUserId?: string
): Promise<number> {
  const filter: Record<string, unknown> = {
    [`preferences.${preferenceKey}`]: true,
  };
  if (excludeUserId) {
    filter.userId = { $ne: excludeUserId };
  }
  const subs = await PushSubscription.find(filter);

  let sent = 0;
  // Process in batches of PUSH_CONCURRENCY
  for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
    const batch = subs.slice(i, i + PUSH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((sub) => sendToSubscription(sub, payload))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) sent++;
      if (r.status === 'rejected') {
        console.error('[Push] Unexpected sendToSubscription rejection:', r.reason);
      }
    }
  }
  return sent;
}

/**
 * Notify team members when someone changes their status for today.
 * Runs in the background (fire-and-forget).
 */
export function notifyTeamStatusChange(
  actorName: string,
  actorId: string,
  date: string,
  newStatus: string
): void {
  // Compare using UTC date components to avoid timezone-related mismatches.
  // The `date` parameter is expected to be an ISO date string (YYYY-MM-DD) in UTC.
  const now = new Date();
  const todayUTC = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const isToday = date === todayUTC;
  if (!isToday) return; // Only send push for today's changes

  const payload: PushPayload = {
    title: '📍 Team Status Update',
    body: `${actorName} is now "${newStatus}" today.`,
    url: '/',
    tag: `status-${actorId}-${date}`,
  };

  notifyAllWithPreference('teamStatusChanges', payload, actorId).catch((err) =>
    console.error('[Push] notifyTeamStatusChange error:', err)
  );
}

/**
 * Notify all subscribers about a new holiday or event created by admin.
 */
export function notifyAdminAnnouncement(
  title: string,
  body: string,
  url = '/'
): void {
  const payload: PushPayload = { title, body, url, tag: 'admin-announcement' };
  notifyAllWithPreference('adminAnnouncements', payload).catch((err) =>
    console.error('[Push] notifyAdminAnnouncement error:', err)
  );
}
