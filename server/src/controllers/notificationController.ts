import { Response } from 'express';
import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { AuthRequest } from '../types/index.js';

/**
 * Get notifications for the current user (newest first, max 50).
 * GET /api/notifications
 */
export const getNotifications = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;

    const notifications = await Notification.find({ userId })
      .populate('sourceUserId', '_id name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, data: notifications });
  } catch (error: any) {
    console.error('getNotifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to get notifications' });
  }
};

/**
 * Get unread notification count.
 * GET /api/notifications/unread-count
 */
export const getUnreadCount = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const count = await Notification.countDocuments({ userId, isRead: false });
    res.json({ success: true, data: { count } });
  } catch (error: any) {
    console.error('getUnreadCount error:', error);
    res.status(500).json({ success: false, message: 'Failed to get unread count' });
  }
};

/**
 * Mark a notification as read.
 * PUT /api/notifications/:id/read
 */
export const markAsRead = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!._id;

    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid notification ID' });
      return;
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    res.json({ success: true, data: notification });
  } catch (error: any) {
    console.error('markAsRead error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
};

/**
 * Mark all notifications as read.
 * PUT /api/notifications/read-all
 */
export const markAllAsRead = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user!._id;
    await Notification.updateMany({ userId, isRead: false }, { isRead: true });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    console.error('markAllAsRead error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
};

/**
 * Create favorite schedule update notifications.
 * Called internally when a user adds office days.
 * NOT an API endpoint — used by entry controller.
 */
export const createFavoriteNotifications = async (
  sourceUserId: string,
  sourceName: string,
  officeDates: string[]
): Promise<void> => {
  try {
    if (officeDates.length === 0) return;

    const BATCH_SIZE = 500;
    const dateCount = officeDates.length;
    const message = `${sourceName} added ${dateCount} office day${dateCount > 1 ? 's' : ''}. Want to align?`;
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
