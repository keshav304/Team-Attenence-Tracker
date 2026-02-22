import { Response } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { AuthRequest } from '../types/index.js';
import { notifyAdminAnnouncement } from '../utils/pushNotifications.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Helper: format date string for display in notifications.
 */
function formatDateForDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Helper: Create event notifications for all active users (except creator).
 */
async function createEventNotifications(
  eventId: mongoose.Types.ObjectId,
  creatorId: mongoose.Types.ObjectId,
  type: 'event_created' | 'event_updated',
  message: string,
  eventDate: string
): Promise<void> {
  try {
    const users = await User.find({
      isActive: true,
      _id: { $ne: creatorId },
    }).select('_id');

    if (users.length === 0) return;

    const notifications = users.map((u) => ({
      userId: u._id,
      type,
      sourceUserId: creatorId,
      eventId,
      affectedDates: [eventDate],
      message,
      isRead: false,
    }));

    await Notification.insertMany(notifications);
  } catch (error) {
    console.error('createEventNotifications error:', error);
  }
}

/**
 * Get events for a date range. All authenticated users can view.
 * Returns events with aggregated RSVP counts and the current user's RSVP status.
 * GET /api/events?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const getEvents = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };
    const currentUserId = req.user?._id?.toString();

    const query: Record<string, unknown> = {};

    if (startDate || endDate) {
      const dateFilter: Record<string, string> = {};

      if (startDate) {
        if (!DATE_RE.test(startDate)) {
          res.status(400).json({ success: false, message: 'startDate must be YYYY-MM-DD' });
          return;
        }
        dateFilter.$gte = startDate;
      }

      if (endDate) {
        if (!DATE_RE.test(endDate)) {
          res.status(400).json({ success: false, message: 'endDate must be YYYY-MM-DD' });
          return;
        }
        dateFilter.$lte = endDate;
      }

      query.date = dateFilter;
    }

    const events = await Event.find(query)
      .populate('createdBy', 'name email')
      .populate('rsvps.userId', 'name email')
      .sort({ date: 1 })
      .lean();

    // Enrich each event with RSVP counts and current user's status
    const enriched = events.map((ev: any) => {
      const rsvps = ev.rsvps || [];
      const rsvpCounts = {
        going: rsvps.filter((r: any) => r.status === 'going').length,
        maybe: rsvps.filter((r: any) => r.status === 'maybe').length,
        not_going: rsvps.filter((r: any) => r.status === 'not_going').length,
      };
      const myRsvp = currentUserId
        ? rsvps.find((r: any) => r.userId?._id?.toString() === currentUserId || r.userId?.toString() === currentUserId)
        : null;

      return {
        ...ev,
        rsvpCounts,
        myRsvpStatus: myRsvp?.status || null,
      };
    });

    res.json({ success: true, data: enriched });
  } catch (error: any) {
    console.error('getEvents error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch events' });
  }
};

/**
 * Create an event (admin only).
 * POST /api/events
 */
export const createEvent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { date, title, description, eventType } = req.body;

    const event = await Event.create({
      date,
      title,
      description,
      eventType,
      createdBy: req.user._id,
    });

    const populated = await Event.findById(event._id).populate('createdBy', 'name email');

    // Push notification to all subscribers (fire-and-forget; errors handled internally)
    try {
      notifyAdminAnnouncement(
        '📌 New Event',
        `${title} on ${date}`,
        '/'
      );
    } catch (pushErr) {
      console.error(`notifyAdminAnnouncement failed for event "${title}":`, pushErr);
    }

    // In-app notification for all active members
    const displayDate = formatDateForDisplay(date);
    await createEventNotifications(
      event._id,
      req.user._id,
      'event_created',
      `New Event Created: ${title} on ${displayDate}. RSVP now.`,
      date
    );

    res.status(201).json({ success: true, data: populated });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'An event with this title already exists on this date',
      });
      return;
    }
    console.error('createEvent error:', error);
    res.status(400).json({ success: false, message: 'Failed to create event' });
  }
};

/**
 * Update an event (admin only).
 * PUT /api/events/:id
 */
export const updateEvent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid event ID format' });
      return;
    }

    const { date, title, description, eventType } = req.body;

    // Fetch existing event to detect significant changes
    const existingEvent = await Event.findById(id);
    if (!existingEvent) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (date !== undefined) updateData.date = date;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (eventType !== undefined) updateData.eventType = eventType;

    const event = await Event.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate('createdBy', 'name email');

    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    // Send update notification if title or date changed
    const dateChanged = date !== undefined && date !== existingEvent.date;
    const titleChanged = title !== undefined && title !== existingEvent.title;

    if (dateChanged || titleChanged) {
      let message: string;
      if (dateChanged) {
        message = `Event Updated: ${event.title} date changed to ${formatDateForDisplay(event.date)}.`;
      } else {
        message = `Event Updated: "${existingEvent.title}" has been updated.`;
      }

      await createEventNotifications(
        event._id,
        req.user!._id,
        'event_updated',
        message,
        event.date
      );
    }

    res.json({ success: true, data: event });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'An event with this title already exists on this date',
      });
      return;
    }
    console.error('updateEvent error:', error);
    res.status(400).json({ success: false, message: 'Failed to update event' });
  }
};

/**
 * Delete an event (admin only).
 * DELETE /api/events/:id
 */
export const deleteEvent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid event ID format' });
      return;
    }

    const event = await Event.findByIdAndDelete(id);

    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    // Remove associated event notifications
    await Notification.deleteMany({
      eventId: new mongoose.Types.ObjectId(id),
    });

    res.json({ success: true, message: 'Event deleted' });
  } catch (error: any) {
    console.error('deleteEvent error:', error);
    res.status(500).json({ success: false, message: 'Unable to delete event' });
  }
};

/**
 * RSVP to an event.
 * POST /api/events/:eventId/rsvp
 * Body: { status: "going" | "not_going" | "maybe" }
 */
export const rsvpToEvent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { eventId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid event ID format' });
      return;
    }

    if (!['going', 'not_going', 'maybe'].includes(status)) {
      res.status(400).json({ success: false, message: 'Status must be going, not_going, or maybe' });
      return;
    }

    const userId = req.user._id;

    // Check if event exists and is not in the past
    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    // Check if event date has passed
    const today = new Date().toISOString().slice(0, 10);
    if (event.date < today) {
      res.status(400).json({ success: false, message: 'Cannot RSVP to past events' });
      return;
    }

    // Atomic update: Replace existing RSVP or add new one
    // First, try to update existing RSVP
    const updated = await Event.findOneAndUpdate(
      { _id: eventId, 'rsvps.userId': userId },
      {
        $set: {
          'rsvps.$.status': status,
          'rsvps.$.respondedAt': new Date(),
        },
      },
      { new: true }
    );

    if (!updated) {
      // No existing RSVP — add new one
      await Event.findByIdAndUpdate(
        eventId,
        {
          $push: {
            rsvps: {
              userId,
              status,
              respondedAt: new Date(),
            },
          },
        },
        { new: true }
      );
    }

    // Return the enriched event
    const refreshed = await Event.findById(eventId)
      .populate('createdBy', 'name email')
      .populate('rsvps.userId', 'name email')
      .lean();

    if (!refreshed) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    const rsvps = (refreshed as any).rsvps || [];
    const rsvpCounts = {
      going: rsvps.filter((r: any) => r.status === 'going').length,
      maybe: rsvps.filter((r: any) => r.status === 'maybe').length,
      not_going: rsvps.filter((r: any) => r.status === 'not_going').length,
    };

    res.json({
      success: true,
      data: {
        ...refreshed,
        rsvpCounts,
        myRsvpStatus: status,
      },
    });
  } catch (error: any) {
    console.error('rsvpToEvent error:', error);
    res.status(500).json({ success: false, message: 'Failed to RSVP' });
  }
};
