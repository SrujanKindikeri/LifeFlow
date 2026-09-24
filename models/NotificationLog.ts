/**
 * models/NotificationLog.ts — Idempotency / deduplication log for scheduled notifications.
 *
 * PURPOSE
 * ───────
 * The notification scheduler runs periodically (e.g. minutely or hourly via cron).
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
 *   <userId>:<notificationType>:<dateString>[:<extraDiscriminator>]
 *
 * Examples:
 *   "6630a1b2c3d4e5f6a7b8c9d0:TASK_TOMORROW:2026-09-13"
 *   "6630a1b2c3d4e5f6a7b8c9d0:TASK_INCOMPLETE_TODAY:2026-09-12"
 *   "6630a1b2c3d4e5f6a7b8c9d0:TASK_DUE_SOON:2026-09-16:<taskObjectId>"
 *   "6630a1b2c3d4e5f6a7b8c9d0:DAILY_SUMMARY:2026-09-12"
 *   "6630a1b2c3d4e5f6a7b8c9d0:WEEKLY_SUMMARY:2026-W37"
 *   "6630a1b2c3d4e5f6a7b8c9d0:SPENDING_ALERT:food:2026-09"
 *   "6630a1b2c3d4e5f6a7b8c9d0:MORNING_BRIEF:2026-09-17"
 *
 * STATUS LIFECYCLE
 * ────────────────
 * Each log entry tracks the full send lifecycle:
 *
 *   pending      → claimed by scheduler, not yet sent
 *   processing   → actively being sent (stale after >5 min = crashed worker)
 *   sent_to_smtp → successfully handed to the SMTP/email transport
 *   failed       → send attempt failed; see `errorMessage`
 *
 * USAGE
 * ─────
 * Before sending a notification:
 *   const alreadySent = await checkAndRecord(userId, type, forDate)
 *   if (alreadySent) return   // already dispatched — skip
 *
 * On success:
 *   await markNotificationSent(key)
 *
 * On failure:
 *   await markNotificationFailed(key, errorMessage)
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
  | 'MORNING_BRIEF'
  /**
   * Daily reminder to the bill OWNER about outstanding Group Bill balances.
   * Sent at 10:00 AM local time when any person has an unsettled balance.
   * Key format: "<userId>:GROUP_BILL_REMINDER:<YYYY-MM-DD>"
   * Deduplication: one per owner per calendar day.
   * Channel gating: uses spendingAlerts preference (in-app + email).
   */
  | 'GROUP_BILL_REMINDER'
  /**
   * Manual reminder sent by the bill OWNER to a specific person (the recipient).
   * Triggered by the owner clicking "Send Reminder" in the Group Bill People Summary UI.
   * Key format: "<senderUserId>:GROUP_BILL_MANUAL_REMINDER:<YYYY-MM-DD>:<personKey>:<requestId>"
   * Deduplication: per request ID (prevents double-send on double-click).
   * Channel gating: uses spendingAlerts preference on the RECIPIENT's account.
   * The notification/email is delivered to the RECIPIENT, not the sender.
   */
  | 'GROUP_BILL_MANUAL_REMINDER'

export type NotificationDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'sent_to_smtp'
  | 'failed'

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

  /**
   * UTC timestamp when this notification was scheduled to be delivered.
   * Derived from: user's local date + local time + user's IANA timezone.
   * Never computed from the EC2 server's local timezone.
   * e.g. 2026-09-17T01:30:00.000Z for a 7:00 AM IST notification.
   */
  scheduledAt: Date

  /**
   * UTC timestamp when the notification was actually handed to the transport
   * (SMTP, push, etc.).  Null until delivery completes.
   */
  sentAt: Date | null

  /**
   * Delivery lifecycle status.
   * pending      → claimed by scheduler, not yet sent
   * processing   → actively being sent
   * sent_to_smtp → successfully handed to SMTP/push transport
   * failed       → transport returned an error
   */
  status: NotificationDeliveryStatus

  /** Short human-readable preview of the notification content (max 200 chars). */
  contentPreview: string

  /**
   * The email subject line that was sent to the user.
   * Stored at send time so the History view can show exactly what was sent,
   * even if the user's data changes later.
   * Null for non-email or pre-history notifications.
   */
  emailSubject: string | null

  /**
   * A safe snapshot of the email body — plain text, stripped of HTML tags,
   * truncated to 2000 chars.  Used to display "View email content" in the
   * notification history detail view without re-generating from current data.
   *
   * NEVER contains SMTP credentials, tokens, or server secrets.
   * HTML is stripped before storage; only plain text is saved.
   */
  emailBodySnapshot: string | null

  /** Error message if status === 'failed'. Sanitised — never contains secrets. */
  errorMessage: string | null

  createdAt: Date
  updatedAt: Date
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
        'MORNING_BRIEF',
        'GROUP_BILL_REMINDER',
        'GROUP_BILL_MANUAL_REMINDER',
      ],
      required: true,
    },
    forDate: { type: String, required: true },

    scheduledAt: {
      type:    Date,
      default: () => new Date(),   // defaults to now; callers should supply precise UTC
      index:   true,   // enables efficient "find due notifications" queries
    },
    sentAt: {
      type:    Date,
      default: null,
    },
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'sent_to_smtp', 'failed'],
      default: 'pending',
      index:   true,    // filter by status in history queries
    },
    contentPreview: {
      type:      String,
      default:   '',
      maxlength: 200,
    },
    emailSubject: {
      type:      String,
      default:   null,
      maxlength: 500,
    },
    emailBodySnapshot: {
      type:      String,
      default:   null,
      maxlength: 2000,
    },
    errorMessage: {
      type:    String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
)

// Global unique key — duplicate inserts throw E11000, which callers catch.
NotificationLogSchema.index({ key: 1 }, { unique: true })

// Compound index for history queries by user, ordered by scheduled time.
NotificationLogSchema.index({ userId: 1, scheduledAt: -1 })

// Compound index for "find due notifications" queries:
//   find({ scheduledAt: { $lte: now }, status: 'pending' })
NotificationLogSchema.index({ status: 1, scheduledAt: 1 })

// TTL index — MongoDB auto-removes documents older than 30 days.
// Longer retention than before (was 7 * 24 * 60 * 60 = 7 days) so notification
// history stays visible for a full calendar month.
NotificationLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
)

const NotificationLog: Model<INotificationLog> =
  mongoose.models.NotificationLog ||
  mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema)

export default NotificationLog
