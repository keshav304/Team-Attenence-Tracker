import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'member' | 'admin';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: UserRole;
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

/**
 * Helper: extract candidate favorites array from an update payload,
 * deduplicate, and check for self-referencing.
 */
function validateFavoritesUpdate(query: any, update: any): void {
  const selfId = query._id?.toString?.();
  if (!selfId) {
    throw new Error('Favorites validation requires an _id filter on the query.');
  }

  let candidates: any[] | undefined;

  // Direct replacement via $set.favorites
  if (update?.$set?.favorites) {
    candidates = update.$set.favorites;
  }
  // $push with $each
  else if (update?.$push?.favorites?.$each) {
    candidates = update.$push.favorites.$each;
  }
  // $addToSet with $each
  else if (update?.$addToSet?.favorites?.$each) {
    candidates = update.$addToSet.favorites.$each;
  }
  // Single $push / $addToSet (non-$each)
  else if (update?.$push?.favorites && !update.$push.favorites.$each) {
    candidates = [update.$push.favorites];
  } else if (update?.$addToSet?.favorites && !update.$addToSet.favorites.$each) {
    candidates = [update.$addToSet.favorites];
  }

  if (!candidates || candidates.length === 0) return;

  // Check for self-referencing and guard against null/undefined entries
  for (const fav of candidates) {
    if (fav == null) {
      throw new Error('Invalid favorites entry: null or undefined value');
    }
    if (fav.toString() === selfId) {
      throw new Error('Cannot add yourself as a favorite');
    }
  }

  // Deduplicate for $set replacements
  if (update?.$set?.favorites) {
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const fav of candidates) {
      const key = fav.toString();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(fav);
      }
    }
    update.$set.favorites = deduped;
  }
}

// Mirror favorites validation for findOneAndUpdate
userSchema.pre('findOneAndUpdate', function (next) {
  try {
    validateFavoritesUpdate(this.getQuery(), this.getUpdate());
    next();
  } catch (err: any) {
    next(err);
  }
});

// Mirror favorites validation for updateOne
userSchema.pre('updateOne', function (next) {
  try {
    validateFavoritesUpdate(this.getQuery(), this.getUpdate());
    next();
  } catch (err: any) {
    next(err);
  }
});

// Mirror favorites validation for updateMany
userSchema.pre('updateMany', function (next) {
  try {
    validateFavoritesUpdate(this.getQuery(), this.getUpdate());
    next();
  } catch (err: any) {
    next(err);
  }
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
