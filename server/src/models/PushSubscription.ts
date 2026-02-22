import mongoose, { Document, Schema } from 'mongoose';

export interface IPushSubscription extends Document {
  userId: mongoose.Types.ObjectId;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** User-configurable notification preferences */
  preferences: {
    /** Notify when a teammate changes today's status */
    teamStatusChanges: boolean;
    /** Weekly reminder to fill in next week's schedule */
    weeklyReminder: boolean;
    /** Notify when admin creates a new holiday or event */
    adminAnnouncements: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    preferences: {
      teamStatusChanges: { type: Boolean, default: true },
      weeklyReminder: { type: Boolean, default: true },
      adminAnnouncements: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// Compound index for lookups by userId + endpoint (uniqueness already enforced by endpoint's own unique index)
pushSubscriptionSchema.index({ userId: 1, endpoint: 1 });

const PushSubscription = mongoose.model<IPushSubscription>(
  'PushSubscription',
  pushSubscriptionSchema
);

export default PushSubscription;
