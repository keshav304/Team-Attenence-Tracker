import mongoose, { Document, Schema } from 'mongoose';

export type TemplateStatus = 'office' | 'leave';
export type TemplateLeaveDuration = 'full' | 'half';
export type TemplateHalfDayPortion = 'first-half' | 'second-half';
export type TemplateWorkingPortion = 'wfh' | 'office';

export interface ITemplate extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  status: TemplateStatus;
  leaveDuration?: TemplateLeaveDuration;
  halfDayPortion?: TemplateHalfDayPortion;
  workingPortion?: TemplateWorkingPortion;
  startTime?: string;
  endTime?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const templateSchema = new Schema<ITemplate>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
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
    note: {
      type: String,
      trim: true,
      maxlength: [500, 'Note cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
  }
);

/* ─── Cross-field validation ──────────────────── */
templateSchema.pre('validate', function (next) {
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

// Compound index: unique template name per user
templateSchema.index({ userId: 1, name: 1 }, { unique: true });

const Template = mongoose.model<ITemplate>('Template', templateSchema);
export default Template;
