import mongoose, { Document, Schema } from 'mongoose';

export const EVENT_TYPES = [
  'team-party',
  'mandatory-office',
  'offsite',
  'town-hall',
  'deadline',
  'office-closed',
  'other',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const RSVP_STATUSES = ['going', 'not_going', 'maybe'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export interface IRsvp {
  userId: mongoose.Types.ObjectId;
  status: RsvpStatus;
  respondedAt: Date;
}

export interface IEvent extends Document {
  _id: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  title: string;
  description?: string;
  eventType?: EventType;
  createdBy: mongoose.Types.ObjectId;
  rsvps: IRsvp[];
  createdAt: Date;
  updatedAt: Date;
}

const rsvpSchema = new Schema<IRsvp>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: RSVP_STATUSES,
      required: true,
    },
    respondedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const eventSchema = new Schema<IEvent>(
  {
    date: {
      type: String,
      required: [true, 'Date is required'],
      validate: {
        validator: function (val: string) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
          const [y, m, d] = val.split('-').map(Number);
          if (m < 1 || m > 12 || d < 1) return false;
          const dt = new Date(Date.UTC(y, m - 1, d));
          return (
            dt.getUTCFullYear() === y &&
            dt.getUTCMonth() === m - 1 &&
            dt.getUTCDate() === d
          );
        },
        message: 'Date must be a valid calendar date in YYYY-MM-DD format',
      },
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [150, 'Title cannot exceed 150 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    eventType: {
      type: String,
      trim: true,
      enum: {
        values: EVENT_TYPES as unknown as string[],
        message: 'Event type must be one of: {VALUE}. Allowed: ' + EVENT_TYPES.join(', '),
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by user ID is required'],
    },
    rsvps: {
      type: [rsvpSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate events on the same date with the same title (case-insensitive)
eventSchema.index(
  { date: 1, title: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

// Performance indexes
eventSchema.index({ date: 1 });
eventSchema.index({ 'rsvps.userId': 1 });

// Unique compound index to prevent duplicate RSVPs per event
eventSchema.index({ _id: 1, 'rsvps.userId': 1 }, { unique: true });

// Pre-save hook: reject duplicate userIds within the rsvps array
eventSchema.pre('save', function (next) {
  if (this.rsvps && this.rsvps.length > 0) {
    const ids = this.rsvps.map(r => r.userId.toString());
    if (ids.length !== new Set(ids).size) {
      return next(new Error('Duplicate RSVP entries for the same user are not allowed.'));
    }
  }
  next();
});

const Event = mongoose.model<IEvent>('Event', eventSchema);
export default Event;
