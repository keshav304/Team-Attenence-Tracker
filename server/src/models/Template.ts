import mongoose, { Document, Schema } from 'mongoose';

export type TemplateStatus = 'office' | 'leave';

export interface ITemplate extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  status: TemplateStatus;
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

// Compound index: unique template name per user
templateSchema.index({ userId: 1, name: 1 }, { unique: true });

const Template = mongoose.model<ITemplate>('Template', templateSchema);
export default Template;
