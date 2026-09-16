/**
 * models/NotificationLog.ts — Idempotency / deduplication log for scheduled notifications.
 *
 * PURPOSE
 * ───────
 * The notification scheduler runs periodically (e.g. hourly via cron).
 * Without a deduplication mechanism the same reminder (e.g. "tomorrow's tasks")
 * would be re-sent on every scheduler run.
 *
 * This collection records each notification that has already been dispatched so
 * subsequent scheduler runs skip it.  A TTL index auto-expires old records after
 * 7 days so the collection stays small.
 *
 * IDEMPOTENCY KEY FORMAT
 * ──────────────────────
 * The `key` field is a deterministic string composed of:
 *
 *   <userId>:<notificationType>:<dateString>
 *
 * Examples:
 *   "6630a1b2c3d4e5f6a7b8c9d0:TASK_TOMORROW:2026-09-13"
 *   "6630a1b2c3d4e5f6a7b8c9d0:TASK_INCOMPLETE_TODAY:2026-09-12"
 *   "6630a1b2c3d4e5f6a7b8c9d0:TASK_DUE_SOON:2026-09-16:<taskObjectId>"
 *   "6630a1b2c3d4e5f6a7b8c9d0:DAILY_SUMMARY:2026-09-12"
 *   "6630a1b2c3d4e5f6a7b8c9d0:WEEKLY_SUMMARY:2026-W37"
 *   "6630a1b2c3d4e5f6a7b8c9d0:SPENDING_ALERT:food:2026-09"
 *
 * USAGE
 * ─────
 * Before sending a notification:
 *   const sent = await NotificationLog.exists({ key })
 *   if (sent) return   // already dispatched — skip
 *
 * After dispatching:
 *   await NotificationLog.create({ key, userId })
 *
 * The unique index on `key` makes concurrent scheduler runs safe — the second
 * insert throws E11000 (duplicate key) which the caller catches and ignores.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export type ScheduledNotificationType =
  | 'TASK_TOMORROW'
  | 'TASK_INCOMPLETE_TODAY'
  | 'TASK_DUE_SOON'
  | 'HABIT_TOMORROW'
  | 'HABIT_REMINDER'
  | 'SPENDING_ALERT'
  | 'DAILY_SUMMARY'
  | 'WEEKLY_SUMMARY'

export interface INotificationLog extends Document {
  _id: mongoose.Types.ObjectId
  /**
   * Deterministic idempotency key.
   * Format: "<userId>:<type>:<date>[:<extraDiscriminator>]"
   */
  key: string
  userId: mongoose.Types.ObjectId
  type: ScheduledNotificationType
  /** ISO date string of the "logical date" this notification is for. */
  forDate: string
  createdAt: Date
}

const NotificationLogSchema = new Schema<INotificationLog>(
  {
    key:    { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type:   {
      type: String,
      enum: [
        'TASK_TOMORROW',
        'TASK_INCOMPLETE_TODAY',
        'TASK_DUE_SOON',
        'HABIT_TOMORROW',
        'HABIT_REMINDER',
        'SPENDING_ALERT',
        'DAILY_SUMMARY',
        'WEEKLY_SUMMARY',
      ],
      required: true,
    },
    forDate: { type: String, required: true },
  },
  {
    timestamps: true,
    // Only store createdAt — we never update these records.
    // (updatedAt is excluded by this partial timestamps config)
  }
)

// Global unique key — duplicate inserts throw E11000, which callers catch.
NotificationLogSchema.index({ key: 1 }, { unique: true })

// TTL index — MongoDB auto-removes documents older than 7 days.
// This keeps the collection lean without a separate cleanup job.
NotificationLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 }
)

const NotificationLog: Model<INotificationLog> =
  mongoose.models.NotificationLog ||
  mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema)

export default NotificationLog
