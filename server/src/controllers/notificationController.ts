import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { AuthRequest } from '../types/index.js';
import { Errors } from '../utils/AppError.js';

/**
 * Get notifications for the current user (newest first, max 50).
 * GET /api/notifications
 */
export const getNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!._id;

    const notifications = await Notification.find({ userId })
      .populate('sourceUserId', '_id name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Map sourceUserId → sourceUser to match frontend expectations
    const mapped = notifications.map(({ sourceUserId, ...rest }) => ({
      ...rest,
      sourceUser: sourceUserId,
    }));

    res.json({ success: true, data: mapped });
  } catch (error) {
    next(error);
  }
};

/**
 * Get unread notification count.
 * GET /api/notifications/unread-count
 */
export const getUnreadCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const count = await Notification.countDocuments({ userId, isRead: false });
    res.json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a notification as read.
 * PUT /api/notifications/:id/read
 */
export const markAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    if (!mongoose.isValidObjectId(id)) {
      throw Errors.validation('Invalid notification ID.');
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true },
      { new: true }
    )
      .populate('sourceUserId', '_id name')
      .lean();

    if (!notification) {
      throw Errors.notFound('Notification not found.');
    }

    // Map sourceUserId → sourceUser to match the same shape as getNotifications
    const { sourceUserId, ...rest } = notification as Record<string, unknown>;
    res.json({ success: true, data: { ...rest, sourceUser: sourceUserId } });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark all notifications as read.
 * PUT /api/notifications/read-all
 */
export const markAllAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!._id;
    await Notification.updateMany({ userId, isRead: false }, { isRead: true });
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    next(error);
  }
};

/** The kind of schedule change that triggered a favourite notification. */
export type FavoriteChangeKind = 'added' | 'updated' | 'removed';

/**
 * Build a human-readable notification message.
 */
const buildFavoriteMessage = (
  sourceName: string,
  dateCount: number,
  kind: FavoriteChangeKind,
): string => {
  const dayWord = `office day${dateCount > 1 ? 's' : ''}`;
  switch (kind) {
    case 'added':
      return `${sourceName} added ${dateCount} ${dayWord}. Want to align?`;
    case 'updated':
      return `${sourceName} updated ${dateCount} ${dayWord}. Review your alignment.`;
    case 'removed':
      return `${sourceName} removed ${dateCount} ${dayWord}. You may want to update yours.`;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled FavoriteChangeKind: ${_exhaustive}`);
    }
  }
};

/**
 * Create favorite schedule update notifications.
 * Called internally when a user changes office days.
 * NOT an API endpoint — used by entry controller.
 *
 * @param kind – 'added' first time setting office, 'updated' editing an
 *   existing office entry, 'removed' changing away from office or deleting.
 */
export const createFavoriteNotifications = async (
  sourceUserId: string,
  sourceName: string,
  officeDates: string[],
  kind: FavoriteChangeKind = 'added',
): Promise<void> => {
  try {
    if (officeDates.length === 0) return;

    const BATCH_SIZE = 500;
    const dateCount = officeDates.length;
    const message = buildFavoriteMessage(sourceName, dateCount, kind);

    if (!mongoose.isValidObjectId(sourceUserId)) {
      console.warn('createFavoriteNotifications: invalid sourceUserId, skipping', sourceUserId);
      return;
    }
    const sourceObjId = new mongoose.Types.ObjectId(sourceUserId);

    // Stream fans via cursor to avoid loading all into memory at once
    const cursor = User.find({
      favorites: sourceObjId,
      isActive: true,
      _id: { $ne: sourceObjId },
    }).select('_id').cursor();

    let batch: Array<{
      userId: mongoose.Types.ObjectId;
      type: 'favorite_schedule_update';
      sourceUserId: mongoose.Types.ObjectId;
      affectedDates: string[];
      message: string;
      isRead: boolean;
    }> = [];

    for await (const fan of cursor) {
      batch.push({
        userId: fan._id,
        type: 'favorite_schedule_update' as const,
        sourceUserId: sourceObjId,
        affectedDates: officeDates,
        message,
        isRead: false,
      });

      if (batch.length >= BATCH_SIZE) {
        await Notification.insertMany(batch);
        batch = [];
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await Notification.insertMany(batch);
    }
  } catch (error) {
    // Don't let notification failures block the main operation
    console.error('createFavoriteNotifications error:', error);
  }
};
