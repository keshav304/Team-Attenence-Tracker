import { Response } from 'express';
import PushSubscription from '../models/PushSubscription.js';
import { AuthRequest } from '../types/index.js';

/** Allowed preference keys and their expected type (boolean). */
const PREFERENCE_KEYS = ['teamStatusChanges', 'weeklyReminder', 'adminAnnouncements'] as const;

/**
 * Whitelist and type-check raw preferences input.
 * Returns an object containing only known boolean keys, or `null` if nothing valid was provided.
 */
function sanitizePreferences(
  raw: unknown
): Record<string, boolean> | null {
  if (!raw || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const result: Record<string, boolean> = {};
  for (const key of PREFERENCE_KEYS) {
    if (typeof (raw as Record<string, unknown>)[key] === 'boolean') {
      result[key] = (raw as Record<string, boolean>)[key];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * POST /api/push/subscribe
 * Store (or update) a push subscription for the authenticated user.
 */
export const subscribe = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { endpoint, keys, preferences } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ success: false, message: 'Invalid push subscription payload' });
      return;
    }

    const sanitizedPreferences = sanitizePreferences(preferences);

    const sub = await PushSubscription.findOneAndUpdate(
      { userId, endpoint },
      {
        userId,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        ...(sanitizedPreferences ? { preferences: sanitizedPreferences } : {}),
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, data: sub });
  } catch (error: any) {
    console.error('push subscribe error:', error);
    res.status(500).json({ success: false, message: 'Failed to save subscription' });
  }
};

/**
 * DELETE /api/push/subscribe
 * Remove the push subscription for the authenticated user.
 */
export const unsubscribe = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { endpoint } = req.body;

    if (!endpoint) {
      res.status(400).json({ success: false, message: 'Endpoint is required' });
      return;
    }

    await PushSubscription.deleteOne({ userId, endpoint });
    res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('push unsubscribe error:', error);
    res.status(500).json({ success: false, message: 'Failed to unsubscribe' });
  }
};

/**
 * GET /api/push/status
 * Check if the requesting user has any active push subscriptions
 * and return their notification preferences.
 */
export const getStatus = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const subs = await PushSubscription.find({ userId }).select('endpoint preferences');

    // Preferences are expected to be identical across all subscriptions
    // because updatePreferences uses updateMany. Log if any inconsistency.
    if (subs.length > 1) {
      const baseline = JSON.stringify(subs[0].preferences);
      for (let i = 1; i < subs.length; i++) {
        if (JSON.stringify(subs[i].preferences) !== baseline) {
          console.warn(
            `[Push] Preference mismatch for user ${userId}: sub[0]=${baseline}, sub[${i}]=${JSON.stringify(subs[i].preferences)}`
          );
          break;
        }
      }
    }

    res.json({
      success: true,
      data: {
        subscribed: subs.length > 0,
        subscriptionCount: subs.length,
        preferences: subs[0]?.preferences ?? {
          teamStatusChanges: true,
          weeklyReminder: true,
          adminAnnouncements: true,
        },
      },
    });
  } catch (error) {
    console.error('push status error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch push status' });
  }
};

/**
 * PUT /api/push/preferences
 * Update notification preferences for ALL of this user's subscriptions.
 */
export const updatePreferences = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
      res.status(400).json({ success: false, message: 'preferences object is required' });
      return;
    }

    const sanitized = sanitizePreferences(preferences);
    if (!sanitized) {
      res.status(400).json({ success: false, message: 'No valid preference keys provided' });
      return;
    }

    const update: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(sanitized)) {
      update[`preferences.${key}`] = value;
    }

    await PushSubscription.updateMany({ userId }, { $set: update });

    // Fetch updated preferences
    const sub = await PushSubscription.findOne({ userId }).select('preferences');
    if (!sub) {
      res.status(404).json({ success: false, message: 'No subscriptions found for this user' });
      return;
    }
    res.json({
      success: true,
      data: {
        preferences: sub.preferences,
      },
    });
  } catch (error) {
    console.error('push updatePreferences error:', error);
    res.status(500).json({ success: false, message: 'Failed to update preferences' });
  }
};
