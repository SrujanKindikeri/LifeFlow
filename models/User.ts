import mongoose, { Document, Model, Schema } from 'mongoose'

// ── Account lifecycle ─────────────────────────────────────────────────────────

/**
 * "active"  — normal account, all features accessible.
 * "deleted" — soft-deleted; account is within the 30-day recovery window.
 *             Sessions are invalidated at deletion time.  No new sessions
 *             can be started until the account is restored.
 *             All user data is preserved in MongoDB during this window.
 */
export type AccountStatus = 'active' | 'deleted'

export type AppTheme = 'light' | 'dark' | 'system'

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

  // ── Appearance & Experience preferences ──────────────────────────────────
  /**
   * User-controlled appearance and experience settings.
   * All fields have safe defaults so existing users are unaffected.
   */
  appearancePreferences: {
    /** Selected colour scheme. 'system' follows OS/browser preference. */
    theme: AppTheme
    /** Whether Night Shift is enabled (softer visuals during configured hours). */
    nightShiftEnabled: boolean
    /** Night Shift start time in 24h "HH:MM" format, e.g. "22:00". */
    nightShiftStart: string
    /** Night Shift end time in 24h "HH:MM" format, e.g. "07:00". */
    nightShiftEnd: string
    /** Whether in-app notification tones are enabled. */
    turnToneEnabled: boolean
    /** Volume from 0 (silent) to 1 (max). */
    turnToneVolume: number
  }
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
    /** Email for task reminders (7 PM incomplete check + tomorrow preview at 10 PM). */
    taskReminders: boolean
    /** Email for habit reminders (upcoming and incomplete habit reminders). */
    habitReminders: boolean
    /** Email for spending/budget alerts (threshold reached / exceeded). */
    spendingAlerts: boolean
    /** Email for the daily summary at 11:55 PM. */
    dailySummary: boolean
    /** Email for the weekly summary every Sunday at 10 PM. */
    weeklySummary: boolean
  }

  // ── Notification activation ───────────────────────────────────────────────
  /**
   * True once the user has successfully received a test notification email.
   * The scheduler only delivers regular Gmail notifications to users where
   * this is true AND emailNotifications.enabled is true.
   * Existing users default to false — they must verify once before regular
   * scheduled emails begin.
   */
  notificationsTested: boolean
  /**
   * UTC timestamp when notificationsTested was set to true.
   * Null until the first successful test send.
   */
  notificationsTestedAt: Date | null

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

  // ── Account restoration token ─────────────────────────────────────────────
  /**
   * SHA-256 hash of the raw single-use restoration token included in the
   * "Restore your LifeFlow account" email.  Never store the raw token.
   * Cleared immediately on successful restoration or on re-issue (if delete
   * is triggered again).
   */
  accountRestoreTokenHash: string | null
  /**
   * UTC expiry — restoration token is invalid at or after this date.
   * Default window: ACCOUNT_RESTORE_TOKEN_EXPIRY_DAYS env var (default 30 days,
   * matching the recovery window so the link stays valid for the full period).
   */
  accountRestoreExpiresAt: Date | null

  // ── Account recovery OTP (step 2 of password → OTP → restore) ────────────
  /**
   * SHA-256 hash of the 6-digit OTP sent to the user's email after a
   * successful password verification during account recovery.
   * Never store the raw OTP.  Cleared on successful verification or expiry.
   */
  accountRecoveryOtpHash: string | null
  /**
   * UTC expiry of the recovery OTP — valid for 10 minutes after generation.
   * Set to null when no OTP is pending or after it has been consumed.
   */
  accountRecoveryOtpExpiresAt: Date | null
  /**
   * Number of incorrect OTP attempts for the current recovery OTP.
   * Reset to 0 whenever a fresh OTP is generated.
   * If this reaches accountRecoveryOtpMaxAttempts the OTP is invalidated
   * and the user must request a new one.
   */
  accountRecoveryOtpAttempts: number
  /**
   * Maximum number of incorrect OTP attempts before invalidation (default 5).
   */
  accountRecoveryOtpMaxAttempts: number
  /**
   * ISO timestamp of when the most recent recovery OTP was generated.
   * Used to enforce the 60-second resend cooldown on the client/server.
   */
  accountRecoveryOtpSentAt: Date | null

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

  // ── Email OTP Two-Factor Authentication ───────────────────────────────────
  /**
   * Whether Email OTP 2FA is active for this account.
   * When true, a 6-digit OTP is emailed on each login attempt.
   * Completely independent from twoFactorEnabled (TOTP).
   */
  emailOtpEnabled: boolean
  /**
   * UTC timestamp when Email OTP 2FA was enabled for this account.
   * Set on successful OTP verification during the enable flow.
   * Cleared when 2FA is disabled.
   */
  twoFactorEnabledAt: Date | null
  /**
   * SHA-256 hash of the current pending login/enable/disable OTP.
   * Only the hash is stored — the raw OTP is sent by email only.
   * Cleared on successful use, expiry, or max-attempt exhaustion.
   */
  emailOtpHash: string | null
  /**
   * UTC timestamp after which the pending OTP is invalid.
   * Set to emailOtpSentAt + 10 minutes.
   */
  emailOtpExpiresAt: Date | null
  /**
   * Number of incorrect OTP attempts for the current pending OTP.
   * Reset to 0 whenever a fresh OTP is generated.
   * If this reaches emailOtpMaxAttempts the OTP is invalidated.
   */
  emailOtpAttempts: number
  /**
   * Maximum number of incorrect attempts before invalidation.
   * Default 5 — matches accountRecoveryOtpMaxAttempts.
   */
  emailOtpMaxAttempts: number
  /**
   * UTC timestamp when the most recent OTP was sent.
   * Used to enforce the 60-second resend cooldown server-side.
   */
  emailOtpSentAt: Date | null
  /**
   * Purpose of the pending OTP.
   * Prevents cross-purpose OTP reuse (e.g. a login OTP cannot enable 2FA).
   * Values: "2fa_enable" | "2fa_login" | "2fa_disable"
   */
  emailOtpPurpose: '2fa_enable' | '2fa_login' | '2fa_disable' | null

  // ── Account lifecycle (soft-delete) ──────────────────────────────────────
  /**
   * "active"  — normal operational state (default for all users).
   * "deleted" — soft-deleted; account is in the 30-day recovery window.
   *             Data is preserved.  Sessions are invalidated on deletion.
   */
  accountStatus: AccountStatus
  /**
   * UTC timestamp when the account was soft-deleted.
   * Null for active accounts.
   */
  deletedAt: Date | null
  /**
   * UTC timestamp after which permanent deletion may run.
   * Set to deletedAt + 30 days.  Null for active accounts.
   * The cleanup job processes accounts where this date has passed.
   */
  scheduledPermanentDeletionAt: Date | null

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

    // ── Appearance & Experience preferences ──────────────────────────────────
    // Safe defaults ensure all existing users get light theme, Night Shift
    // off, and Turn Tone on at 50 % volume — no data migration required.
    appearancePreferences: {
      theme:             { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
      nightShiftEnabled: { type: Boolean, default: false },
      nightShiftStart:   { type: String,  default: '22:00', maxlength: 5 },
      nightShiftEnd:     { type: String,  default: '07:00', maxlength: 5 },
      turnToneEnabled:   { type: Boolean, default: true  },
      turnToneVolume:    { type: Number,  default: 0.5, min: 0, max: 1 },
    },

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
      enabled:        { type: Boolean, default: false },
      taskReminders:  { type: Boolean, default: true  },
      habitReminders: { type: Boolean, default: true  },
      spendingAlerts: { type: Boolean, default: true  },
      dailySummary:   { type: Boolean, default: true  },
      weeklySummary:  { type: Boolean, default: true  },
    },

    // ── Notification activation ──────────────────────────────────────────────
    // Set to true after a successful test notification email.
    // The scheduler only delivers regular Gmail notifications to users where
    // notificationsTested is true AND emailNotifications.enabled is true.
    // Existing users safely default to false — they must verify once.
    notificationsTested: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    notificationsTestedAt: {
      type:    Date,
      default: null,
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

    // ── Account restoration token ────────────────────────────────────────────
    // A single-use, short-lived (30-day) token sent in the account-deletion
    // confirmation email.  Only the SHA-256 hash is stored here; the raw token
    // goes only into the email URL and is discarded afterward.
    // Cleared on successful restoration or when a new deletion is triggered.
    accountRestoreTokenHash: {
      type:   String,
      default: null,
      index:  true,
      sparse: true,  // unique sparse: fast lookup, no null collisions
    },
    accountRestoreExpiresAt: {
      type:    Date,
      default: null,
    },

    // ── Account recovery OTP ─────────────────────────────────────────────────
    // Generated after successful password verification during account recovery.
    // Only the SHA-256 hash is stored; the raw 6-digit OTP goes only to the
    // user's email and is immediately discarded. Cleared on use or expiry.
    accountRecoveryOtpHash: {
      type:    String,
      default: null,
      index:   true,
      sparse:  true,
    },
    accountRecoveryOtpExpiresAt: {
      type:    Date,
      default: null,
    },
    accountRecoveryOtpAttempts: {
      type:    Number,
      default: 0,
      min:     0,
    },
    accountRecoveryOtpMaxAttempts: {
      type:    Number,
      default: 5,
    },
    accountRecoveryOtpSentAt: {
      type:    Date,
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

    // ── Email OTP Two-Factor Authentication ──────────────────────────────────
    // Completely independent from twoFactorEnabled (TOTP / Google Authenticator).
    // When emailOtpEnabled is true, a 6-digit OTP is emailed on every login.
    // Only the SHA-256 hash of the OTP is stored here; the raw OTP goes only
    // into the email body and is discarded immediately after sending.
    emailOtpEnabled: {
      type:    Boolean,
      default: false,
      index:   true,   // fast filter in login route
    },
    twoFactorEnabledAt: {
      type:    Date,
      default: null,
    },
    emailOtpHash: {
      type:    String,
      default: null,
    },
    emailOtpExpiresAt: {
      type:    Date,
      default: null,
    },
    emailOtpAttempts: {
      type:    Number,
      default: 0,
      min:     0,
    },
    emailOtpMaxAttempts: {
      type:    Number,
      default: 5,
    },
    emailOtpSentAt: {
      type:    Date,
      default: null,
    },
    emailOtpPurpose: {
      type:    String,
      enum:    ['2fa_enable', '2fa_login', '2fa_disable', null],
      default: null,
    },

    // ── Account lifecycle (soft-delete) ──────────────────────────────────────
    // accountStatus defaults to 'active' so all existing users are unaffected.
    // The scheduler and requireAuth() filter on accountStatus: 'active'.
    accountStatus: {
      type:    String,
      enum:    ['active', 'deleted'],
      default: 'active',
      index:   true,
    },
    deletedAt: {
      type:    Date,
      default: null,
      index:   true,   // used by cleanup job: { accountStatus, deletedAt }
    },
    scheduledPermanentDeletionAt: {
      type:    Date,
      default: null,
      index:   true,   // used by cleanup job: range query on this field
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
