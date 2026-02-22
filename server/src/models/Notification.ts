import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: 'favorite_schedule_update' | 'event_created' | 'event_updated';
  sourceUserId: mongoose.Types.ObjectId;
  eventId?: mongoose.Types.ObjectId;
  affectedDates: string[]; // YYYY-MM-DD
  message: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
    },
    type: {
      type: String,
      enum: ['favorite_schedule_update', 'event_created', 'event_updated'],
      required: [true, 'type is required'],
    },
    sourceUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'sourceUserId is required'],
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: [
        function (this: INotification) {
          return this.type === 'event_created' || this.type === 'event_updated';
        },
        'eventId is required for event_created and event_updated notifications',
      ],
    },
    affectedDates: {
      type: [{
        type: String,
        match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
        validate: {
          validator: function (v: string) {
            const [y, m, d] = v.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
          },
          message: (props: { value: string }) => `${props.value} is not a valid calendar date`,
        },
      }],
      validate: [
        {
          validator: function (v: string[]) { return v.length <= 366; },
          message: 'affectedDates cannot exceed 366 entries',
        },
      ],
    },
    message: {
      type: String,
      required: [true, 'message is required'],
      maxlength: [500, 'Message cannot exceed 500 characters'],
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast queries: user's unread notifications (covers userId-only queries via prefix)
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// TTL index: automatically remove notifications older than 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Notification = mongoose.model<INotification>('Notification', notificationSchema);
export default Notification;
