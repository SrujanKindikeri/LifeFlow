import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId
  publicId: string
  name: string
  email: string
  passwordHash: string
  avatar?: string
  currency: string
  timezone: string
  notificationPreferences: {
    habitReminders: boolean
    taskReminders: boolean
    spendingAlerts: boolean
    dailySummary: boolean
  }
  createdAt: Date
  updatedAt: Date
}

/**
 * Generate a unique public-facing LifeFlow user ID.
 * Format: LF-XXXXXXXX (8 alphanumeric chars, uppercase)
 * Example: LF-7K29X4P1
 */
export function generatePublicId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O, 0, I, 1 to avoid confusion
  let id = 'LF-'
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

const UserSchema = new Schema<IUser>(
  {
    publicId: {
      type: String,
      required: true,
      unique: true,
      default: generatePublicId,
    },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 255,
    },
    passwordHash: { type: String, required: true },
    avatar: { type: String },
    currency: { type: String, default: 'INR', maxlength: 5 },
    timezone: { type: String, default: 'Asia/Kolkata', maxlength: 50 },
    notificationPreferences: {
      habitReminders: { type: Boolean, default: true },
      taskReminders: { type: Boolean, default: true },
      spendingAlerts: { type: Boolean, default: true },
      dailySummary: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
)

// Index for fast lookup by publicId (in addition to the unique constraint)
UserSchema.index({ publicId: 1 })

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema)

export default User
