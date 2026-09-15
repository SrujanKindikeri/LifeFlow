import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId
  publicId: string
  /**
   * Canonical LifeFlow identifier for this user — always in the form LF-XXXXXXXX.
   * This is a virtual that returns `publicId`. It is NOT stored separately in MongoDB.
   * Use `user.lifeFlowId` throughout server-side code when stamping owned documents.
   * Use `user.publicId` only when you specifically need the stored field name.
   */
  lifeFlowId: string
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
  /**
   * Per-category email notification preferences.
   * Completely separate from push/in-app channels — users can mix-and-match.
   * emailNotifications.enabled is the master switch; category flags are only
   * checked when enabled is true.
   */
  emailNotifications: {
    /** Master switch — set to false to suppress all notification emails. */
    enabled: boolean
    /** Email for task reminders (tomorrow tasks + incomplete today). */
    taskReminders: boolean
    /** Email for habit reminders (tomorrow habits + daily habit reminder). */
    habitReminders: boolean
    /** Email for spending/budget alerts. */
    spendingAlerts: boolean
    /** Email for the daily summary. */
    dailySummary: boolean
  }

  // ── Email verification ────────────────────────────────────────────────────
  /** true once the user has clicked a valid verification link */
  emailVerified: boolean
  /** SHA-256 hash of the raw token; never store the raw token */
  emailVerificationTokenHash: string | null
  /** UTC expiry — token is invalid at or after this date */
  emailVerificationExpiresAt: Date | null

  // ── Password reset ────────────────────────────────────────────────────────
  /** SHA-256 hash of the raw reset token; never store the raw token */
  passwordResetTokenHash: string | null
  /** UTC expiry — reset token is invalid at or after this date */
  passwordResetExpiresAt: Date | null

  // ── TOTP / Google Authenticator ───────────────────────────────────────────
  /** Whether TOTP 2FA is active for this account */
  twoFactorEnabled: boolean
  /**
   * AES-256-GCM encrypted TOTP base32 secret.
   * Format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
   * Never store this as plaintext.
   */
  twoFactorSecretEncrypted: string | null
  /** Timestamp when 2FA was successfully verified and enabled */
  twoFactorVerifiedAt: Date | null
  /**
   * Hashed single-use recovery codes.
   * Each entry: SHA-256 hash of the raw code.
   * An entry is removed from the array once used.
   */
  twoFactorRecoveryCodeHashes: string[]

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

    // ── Email notification preferences ──────────────────────────────────────
    // Independent from push/in-app channels — users can enable email for
    // some categories and push for others.  The master `enabled` switch must
    // be true before any category flag is evaluated.
    emailNotifications: {
      enabled:       { type: Boolean, default: false },
      taskReminders: { type: Boolean, default: true  },
      habitReminders:{ type: Boolean, default: true  },
      spendingAlerts:{ type: Boolean, default: true  },
      dailySummary:  { type: Boolean, default: true  },
    },

    // ── Email verification ──────────────────────────────────────────────────
    emailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    emailVerificationTokenHash: {
      type: String,
      default: null,
      index: true,  // fast lookup during verification
      sparse: true,
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null,
    },

    // ── Password reset ──────────────────────────────────────────────────────
    passwordResetTokenHash: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
    },

    // ── TOTP / Google Authenticator ─────────────────────────────────────────
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecretEncrypted: {
      type: String,
      default: null,
    },
    twoFactorVerifiedAt: {
      type: Date,
      default: null,
    },
    twoFactorRecoveryCodeHashes: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
)

// publicId already has a unique index from the schema field definition above.
// No additional explicit index needed.

/**
 * lifeFlowId virtual — returns publicId so all downstream code can reference
 * `user.lifeFlowId` uniformly without storing a second field.
 * Not included in lean() results; use `user.publicId` when working with lean docs,
 * or call toObject({ virtuals: true }).
 */
UserSchema.virtual('lifeFlowId').get(function (this: IUser) {
  return this.publicId
})

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema)

export default User
