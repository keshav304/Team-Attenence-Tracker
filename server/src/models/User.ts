import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: 'member' | 'admin';
  isActive: boolean;
  favorites: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['member', 'admin'],
      default: 'member',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    favorites: {
      type: [{
        type: Schema.Types.ObjectId,
        ref: 'User',
      }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Validate favorites: no duplicates, no self-referencing
userSchema.pre('validate', function (next) {
  if (this.favorites && this.favorites.length > 0) {
    const selfId = this._id?.toString();
    const seen = new Set<string>();
    const deduped: mongoose.Types.ObjectId[] = [];
    for (const fav of this.favorites) {
      const favStr = fav.toString();
      if (favStr === selfId) {
        return next(new Error('Cannot add yourself as a favorite'));
      }
      if (!seen.has(favStr)) {
        seen.add(favStr);
        deduped.push(fav);
      }
    }
    this.favorites = deduped;
  }
  next();
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const User = mongoose.model<IUser>('User', userSchema);
export default User;
