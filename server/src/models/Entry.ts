import mongoose, { Document, Schema } from 'mongoose';

export type StatusType = 'office' | 'leave';
export type LeaveDuration = 'full' | 'half';
export type HalfDayPortion = 'first-half' | 'second-half';
export type WorkingPortion = 'wfh' | 'office';

export interface IEntry extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD format
  status: StatusType;
  leaveDuration?: LeaveDuration;
  halfDayPortion?: HalfDayPortion;
  workingPortion?: WorkingPortion;
  note?: string;
  startTime?: string; // HH:mm (24h, IST)
  endTime?: string;   // HH:mm (24h, IST)
  createdAt: Date;
  updatedAt: Date;
}

const entrySchema = new Schema<IEntry>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    date: {
      type: String,
      required: [true, 'Date is required'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'],
    },
    status: {
      type: String,
      enum: ['office', 'leave'],
      required: [true, 'Status is required'],
    },
    leaveDuration: {
      type: String,
      enum: ['full', 'half'],
    },
    halfDayPortion: {
      type: String,
      enum: ['first-half', 'second-half'],
    },
    workingPortion: {
      type: String,
      enum: ['wfh', 'office'],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, 'Note cannot exceed 500 characters'],
    },
    startTime: {
      type: String,
      trim: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be in HH:mm 24-hour format'],
    },
    endTime: {
      type: String,
      trim: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be in HH:mm 24-hour format'],
    },
  },
  {
    timestamps: true,
  }
);

/* ─── Cross-field validation ──────────────────── */
entrySchema.pre('validate', function (next) {
  const status = this.get('status') as string | undefined;
  const leaveDuration = this.get('leaveDuration') as string | undefined;
  const halfDayPortion = this.get('halfDayPortion') as string | undefined;
  const workingPortion = this.get('workingPortion') as string | undefined;

  // leaveDuration is only valid when status is 'leave'
  if (leaveDuration && status !== 'leave') {
    return next(new mongoose.Error.ValidationError(this as any).addError(
      'leaveDuration',
      new mongoose.Error.ValidatorError({
        message: 'leaveDuration is only allowed when status is "leave"',
        path: 'leaveDuration',
        value: leaveDuration,
      } as any),
    ) as any);
  }

  // halfDayPortion is only valid when leaveDuration is 'half'
  if (halfDayPortion && leaveDuration !== 'half') {
    return next(new mongoose.Error.ValidationError(this as any).addError(
      'halfDayPortion',
      new mongoose.Error.ValidatorError({
        message: 'halfDayPortion is only allowed when leaveDuration is "half"',
        path: 'halfDayPortion',
        value: halfDayPortion,
      } as any),
    ) as any);
  }

  // workingPortion is only valid when leaveDuration is 'half'
  if (workingPortion && leaveDuration !== 'half') {
    return next(new mongoose.Error.ValidationError(this as any).addError(
      'workingPortion',
      new mongoose.Error.ValidatorError({
        message: 'workingPortion is only allowed when leaveDuration is "half"',
        path: 'workingPortion',
        value: workingPortion,
      } as any),
    ) as any);
  }

  next();
});

// Compound unique index: one entry per user per date
entrySchema.index({ userId: 1, date: 1 }, { unique: true });

const Entry = mongoose.model<IEntry>('Entry', entrySchema);
export default Entry;
