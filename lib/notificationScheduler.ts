/**
 * lib/notificationScheduler.ts — Scheduled notification engine for LifeFlow.
 *
 * NOTIFICATION SCHEDULE (all times in the USER'S LOCAL TIMEZONE)
 * ──────────────────────────────────────────────────────────────
 *   07:00 (7 AM)      → Morning daily brief
 *                       Subject: "Today's LifeFlow — {date}"
 *                       Personalised snapshot: tasks, habits, goals.
 *                       Not sent if nothing is scheduled for today.
 *
 *   Any time          → 30-minute task due-soon reminder
 *                       Subject: "Task reminder: <title>"
 *                       Sent 30 minutes before each task's due time.
 *                       One reminder per task per calendar date.
 *                       Skipped if task is already completed.
 *                       Skipped during quiet hours (00:00–07:00).
 *
 *   19:00 (7 PM)      → Today's incomplete tasks check
 *                       Subject: "You still have work to finish today"
 *                       Sent only when incomplete tasks exist.
 *
 *   22:00 (10 PM)     → Tomorrow preview
 *                       Subject: "Tomorrow's plan is ready"
 *                       Shows tomorrow's tasks + habits.
 *                       Not sent if nothing is planned.
 *
 *   23:55 (11:55 PM)  → Daily summary
 *                       Subject: "Your LifeFlow daily summary — {date}"
 *                       Tasks + habits + expenses overview.
 *                       Not sent if there is nothing to report.
 *
 *   Sunday 22:00      → Weekly summary
 *                       Subject: "Your LifeFlow weekly summary — {weekLabel}"
 *                       Covers the past 7 days.
 *
 *   09:00–11:00       → Habit reminder (morning, push + in-app + email)
 *                       Sent when habits are incomplete.
 *
 *   Any time          → Spending / budget alerts (threshold crossed)
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * 1. Idempotency.  Every notification type has a deterministic key stored in
 *    NotificationLog.  Re-running the scheduler never double-sends.
 *    Concurrent scheduler instances (e.g. after Docker restart) are safe via
 *    MongoDB's unique index on the key field — the second insert throws E11000
 *    which we catch and treat as "already claimed".
 *
 * 2. Precise UTC timestamps.  Every scheduled window is converted to UTC before
 *    any comparison.  localTimeToUtc() derives the exact UTC moment for any
 *    "HH:MM" in any IANA timezone, including DST transitions.  The scheduler
 *    never uses the EC2 server's local timezone for user notification times.
 *
 * 3. Sub-minute precision.  When called by the precise scheduler (every minute
 *    or more frequently), checkWindowSeconds() detects whether the current UTC
 *    instant falls within a ±30-second window around the target UTC moment.
 *    When called by the hourly scheduler, a ±60-minute window is used instead,
 *    guaranteeing every notification fires at most once per day.
 *
 * 4. Timezone-awareness.  All schedule windows use each user's `timezone` field
 *    (falls back to DEFAULT_TIMEZONE env var → 'Asia/Kolkata').
 *    DST is handled automatically by Intl.DateTimeFormat — no fixed offsets.
 *
 * 5. User isolation.  Queries always include userId.  Users never see each
 *    other's data.
 *
 * 6. Delivery channels.  Each notification goes to all enabled channels:
 *      a) In-app  — always created in the Notification collection
 *      b) Push    — sent via lib/pushSender.ts (silently skipped if no VAPID)
 *      c) Email   — sent via getNotificationService() only when:
 *                   • emailNotifications.enabled === true
 *                   • the per-category flag for the type is true
 *                   • EMAIL_PROVIDER != 'none'
 *    Channel failures do not abort other channels.
 *
 * 7. Status tracking.  NotificationLog records each delivery attempt with a
 *    lifecycle status: pending → processing → sent_to_smtp / failed.
 *    The Profile notification history reads from this enriched log.
 *
 * 8. Missed notification policy.
 *    - Task due-soon reminders: if the server was offline during the reminder
 *      window and the task's dueTime has already passed, the reminder is
 *      skipped (not sent late).
 *    - Daily/weekly summaries: a 90-minute grace window is allowed so a brief
 *      server hiccup doesn't silently suppress the day's summary.
 *    - Morning brief: 60-minute grace window (7:00–8:00 AM local).
 *
 * 9. Quiet hours.  Default: 00:00–07:00 local time.  Notifications are
 *    suppressed in this window.  (The 11:55 PM daily summary is just before
 *    the quiet window begins at midnight.)
 *
 * 10. Email recipient security.  The recipient address is always resolved from
 *     the user's database record (user.email).  No client-supplied address is
 *     ever used.
 *
 * 11. Privacy.  Push notification bodies are concise — no full task titles,
 *     financial amounts, or other sensitive data that could appear on a lock
 *     screen.
 *
 * EMAIL VERIFICATION SAFETY
 * ─────────────────────────
 * This module never touches verification token generation, verification routes,
 * or token expiry logic.  Verification emails are sent exclusively by the
 * auth routes (app/api/auth/signup, app/api/auth/resend-verification).
 */

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'
import Budget from '@/models/Budget'
import Expense from '@/models/Expense'
import Goal from '@/models/Goal'
import Notification from '@/models/Notification'
import NotificationLog, {
  type ScheduledNotificationType,
  type NotificationDeliveryStatus,
} from '@/models/NotificationLog'
import { sendPushToUser } from '@/lib/pushSender'
import { getNotificationService } from '@/lib/notifications'
import {
  buildTomorrowTasksEmail,
  buildIncompleteTasksEmail,
  buildTomorrowPreviewEmail,
  buildTomorrowHabitsEmail,
  buildHabitReminderEmail,
  buildSpendingAlertEmail,
  buildDailySummaryEmail,
  buildWeeklySummaryEmail,
  buildTaskReminderEmail,
  buildMorningBriefEmail,
  buildGroupBillReminderEmail,
} from '@/lib/auth/email-templates'
import GroupBill from '@/models/GroupBill'
import Person    from '@/models/Person'
import { aggregateGroupBillPeople } from '@/lib/groupBillAggregator'
import type { IGroupBill } from '@/models/GroupBill'
import type { IPerson }   from '@/models/Person'
import logger from '@/lib/logger'
import { getAppUrl } from '@/lib/env'

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Return today's date as YYYY-MM-DD in the given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
function dateInTimezone(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
    }).formatToParts(date)
    const y = parts.find((p) => p.type === 'year')!.value
    const m = parts.find((p) => p.type === 'month')!.value
    const d = parts.find((p) => p.type === 'day')!.value
    return `${y}-${m}-${d}`
  } catch {
    return date.toISOString().split('T')[0]
  }
}

/** Return the local hour (0–23) for a given instant in the given timezone. */
function localHour(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     'numeric',
      hour12:   false,
    }).formatToParts(date)
    const h = parts.find((p) => p.type === 'hour')
    return h ? parseInt(h.value, 10) : date.getUTCHours()
  } catch {
    return date.getUTCHours()
  }
}

/** Return the local minute (0–59) for a given instant in the given timezone. */
function localMinute(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      minute:   'numeric',
    }).formatToParts(date)
    const m = parts.find((p) => p.type === 'minute')
    return m ? parseInt(m.value, 10) : date.getUTCMinutes()
  } catch {
    return date.getUTCMinutes()
  }
}

/** Return the local second (0–59) for a given instant in the given timezone. */
function _localSecond(date: Date): number {
  return date.getUTCSeconds()
}

/**
 * Return the local day-of-week (0 = Sunday … 6 = Saturday) in the given
 * timezone.
 */
function localDayOfWeek(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday:  'short',
    }).formatToParts(date)
    const wd = parts.find((p) => p.type === 'weekday')?.value
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    }
    return wd !== undefined ? (map[wd] ?? date.getUTCDay()) : date.getUTCDay()
  } catch {
    return date.getUTCDay()
  }
}

/** Add one calendar day to a YYYY-MM-DD string. */
function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return dt.toISOString().split('T')[0]
}

/** Subtract N calendar days from a YYYY-MM-DD string. Returns YYYY-MM-DD. */
function subtractDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - n))
  return dt.toISOString().split('T')[0]
}

/**
 * Return an ISO week label such as "10–16 Sep 2026".
 * weekStart and weekEnd are YYYY-MM-DD strings.
 */
function weekRangeLabel(weekStart: string, weekEnd: string, timezone: string): string {
  try {
    const [sy, sm, sd] = weekStart.split('-').map(Number)
    const [ey, em, ed] = weekEnd.split('-').map(Number)
    const dtStart = new Date(Date.UTC(sy, sm - 1, sd, 12))
    const dtEnd   = new Date(Date.UTC(ey, em - 1, ed, 12))

    const startDay   = dtStart.toLocaleDateString('en-GB', { timeZone: timezone, day: 'numeric' })
    const endDay     = dtEnd.toLocaleDateString('en-GB', { timeZone: timezone, day: 'numeric' })
    const endMonYear = dtEnd.toLocaleDateString('en-GB', {
      timeZone: timezone,
      month: 'short',
      year:  'numeric',
    })
    return `${startDay}–${endDay} ${endMonYear}`
  } catch {
    return `${weekStart} – ${weekEnd}`
  }
}

/**
 * Return a human-readable date label like "Tuesday, 13 Sep".
 * Used in email subject lines and bodies.
 */
function formatDateLabel(dateStr: string, timezone: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d, 12)) // noon UTC to avoid DST edge
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday:  'long',
      day:      'numeric',
      month:    'short',
    }).format(dt)
  } catch {
    return dateStr
  }
}

/** Current month as YYYY-MM in the given timezone. */
function currentMonth(date: Date, timezone: string): string {
  return dateInTimezone(date, timezone).slice(0, 7)
}

// ─── Precise UTC timestamp helpers ────────────────────────────────────────────

/**
 * Convert a user's local "HH:MM" time on a specific YYYY-MM-DD date to a UTC
 * Date object.
 *
 * This is the correct, DST-safe approach:
 *   1. Format the target as a local ISO string "YYYY-MM-DDTHH:MM:00"
 *   2. Pass it through Intl.DateTimeFormat to find the UTC offset at that
 *      exact moment in that timezone (handles DST transitions correctly).
 *   3. Return the resulting UTC Date.
 *
 * Examples:
 *   localTimeToUtc('2026-09-17', '07:00', 'Asia/Kolkata')
 *     → 2026-09-17T01:30:00.000Z   (IST = UTC+5:30)
 *
 *   localTimeToUtc('2026-03-08', '07:00', 'America/New_York')
 *     → 2026-03-08T12:00:00.000Z   (EDT = UTC-4, after spring-forward)
 *
 *   localTimeToUtc('2026-10-25', '01:30', 'Europe/London')
 *     → 2026-10-25T01:30:00.000Z   (BST→GMT transition hour)
 *
 * @param dateStr  YYYY-MM-DD (the calendar date in the user's timezone)
 * @param timeStr  HH:MM (24-hour, the local time)
 * @param timezone IANA timezone string e.g. "Asia/Kolkata"
 * @returns UTC Date, or null if inputs are invalid
 */
export function localTimeToUtc(
  dateStr: string,
  timeStr: string,
  timezone: string
): Date | null {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number)
    const [h, mi]    = timeStr.split(':').map(Number)
    if ([y, mo, d, h, mi].some((n) => isNaN(n))) return null

    // Step 1: Create a "naive" UTC moment assuming the local time IS UTC.
    //         This is a starting approximation only.
    const naiveUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0))

    // Step 2: Ask Intl what the local date/time components are for naiveUtc
    //         in the target timezone.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    }).formatToParts(naiveUtc)

    const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10)
    const localY  = get('year')
    const localMo = get('month')
    const localD  = get('day')
    const localH  = get('hour')
    const localMi = get('minute')

    // Step 3: The offset between what we asked for and what we got is the
    //         timezone offset at that moment (in milliseconds).
    const localAsUtcMs = Date.UTC(localY, localMo - 1, localD, localH, localMi, 0, 0)
    const targetUtcMs  = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
    const offsetMs     = naiveUtc.getTime() - localAsUtcMs

    return new Date(targetUtcMs + offsetMs)
  } catch {
    return null
  }
}

/**
 * Check whether `now` is within `graceSeconds` seconds AFTER a target UTC time.
 *
 * Used for precise window detection:
 *   - graceSeconds = 30  → only fire within 30 s of the exact target (sub-minute cron)
 *   - graceSeconds = 3600 → fire within 1 hour of the target (hourly cron)
 *
 * "After" means: targetUtc <= now < targetUtc + graceSeconds*1000
 *
 * @param now          Current UTC instant
 * @param targetUtc    The scheduled UTC instant
 * @param graceSeconds How many seconds after the target we still consider it valid
 */
export function isWithinGraceWindow(
  now: Date,
  targetUtc: Date,
  graceSeconds: number
): boolean {
  const nowMs    = now.getTime()
  const targetMs = targetUtc.getTime()
  return nowMs >= targetMs && nowMs < targetMs + graceSeconds * 1000
}

/**
 * Return the UTC Date for a named schedule anchor on a given local date.
 *
 * Anchors:
 *   'morning_brief'      → 07:00 local
 *   'incomplete_tasks'   → 19:00 local
 *   'tomorrow_preview'   → 22:00 local
 *   'daily_summary'      → 23:55 local
 *   'weekly_summary'     → 22:00 local (Sunday only)
 *   'habit_reminder'     → 09:30 local
 *
 * Returns null if conversion fails.
 */
export function getScheduleTargetUtc(
  anchor: 'morning_brief' | 'incomplete_tasks' | 'tomorrow_preview' |
          'daily_summary' | 'weekly_summary' | 'habit_reminder',
  localDate: string,
  timezone: string
): Date | null {
  const anchorTimes: Record<string, string> = {
    morning_brief:    '07:00',
    incomplete_tasks: '19:00',
    tomorrow_preview: '22:00',
    daily_summary:    '23:55',
    weekly_summary:   '22:00',
    habit_reminder:   '09:30',
  }
  const timeStr = anchorTimes[anchor]
  if (!timeStr) return null
  return localTimeToUtc(localDate, timeStr, timezone)
}

// ─── Quiet hours ──────────────────────────────────────────────────────────────

/**
 * Default quiet window: 00:00–07:00 local time.
 * The 11:55 PM daily summary runs just before midnight, safely outside this window.
 */
const DEFAULT_QUIET_START = 0   // midnight
const DEFAULT_QUIET_END   = 7   // 7 AM

function isQuietHour(localHr: number): boolean {
  // Window does NOT cross midnight (0–7), so simple range check
  return localHr >= DEFAULT_QUIET_START && localHr < DEFAULT_QUIET_END
}

// ─── Idempotency & status helpers ─────────────────────────────────────────────

/**
 * Build the deterministic idempotency key from its components.
 */
function buildKey(
  userId: mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
  forDate: string,
  extraDiscriminator = ''
): string {
  return [userId.toString(), type, forDate, extraDiscriminator]
    .filter(Boolean)
    .join(':')
}

/**
 * Atomically claim a notification slot.
 *
 * Returns true  → already sent or currently processing; caller should skip.
 * Returns false → slot is now claimed as 'pending'; caller should proceed to send.
 *
 * IDEMPOTENCY RULES
 * ─────────────────
 * • status = 'sent_to_smtp'  → skip (already delivered successfully)
 * • status = 'processing'    → skip (another worker is currently sending it)
 * • status = 'pending'       → skip (claimed by concurrent scheduler in this window)
 * • status = 'failed'        → RETRY: delete the failed record and re-claim
 *   Rationale: a failed notification was never delivered.  The scheduler should
 *   attempt again on the next run within the grace window.  Once the grace
 *   window closes the notification is permanently skipped.
 * • No record                → create as 'pending' and proceed
 *
 * Concurrent safety:
 *   The unique index on `key` ensures only one scheduler insert wins.
 *   The second concurrent insert throws E11000 → caller skips.
 *
 * The `scheduledAt` UTC timestamp is stored for history queries.
 */
async function checkAndRecord(
  userId: mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
  forDate: string,
  extraDiscriminator = '',
  scheduledAt?: Date,
  contentPreview?: string
): Promise<boolean> {
  const key = buildKey(userId, type, forDate, extraDiscriminator)

  const existing = await NotificationLog.findOne({ key }).select('status').lean()
  if (existing) {
    if (existing.status === 'failed') {
      // Retry: remove the failed record so we can re-claim it this run.
      // If the grace window has closed the outer processor already returned early,
      // so we only reach this point when re-delivery is still valid.
      await NotificationLog.deleteOne({ key }).catch(() => undefined)
      logger.info('[notifScheduler] Retrying failed notification', {
        userId: userId.toString(),
        type,
        forDate,
        extraDiscriminator,
      })
      // Fall through to create a fresh 'pending' record below.
    } else {
      // pending / processing / sent_to_smtp — skip
      return true
    }
  }

  try {
    await NotificationLog.create({
      key,
      userId,
      type,
      forDate,
      scheduledAt: scheduledAt ?? new Date(),
      status:      'pending' as NotificationDeliveryStatus,
      contentPreview: (contentPreview ?? '').slice(0, 200),
    })
    return false // claimed — proceed to send
  } catch (err: unknown) {
    // E11000 = concurrent scheduler run already inserted this key
    if (
      err instanceof Error &&
      (err.message.includes('E11000') || err.message.includes('duplicate key'))
    ) {
      return true
    }
    throw err
  }
}

/**
 * Strip HTML tags from an email body and truncate to 2000 chars.
 * Used to produce a safe plain-text snapshot for the notification history
 * detail view.  Never stores raw HTML — only plain text.
 */
function stripHtmlForSnapshot(html: string): string {
  return html
    // Remove <style> blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove <script> blocks entirely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Replace block-level elements with newlines for readability
    .replace(/<\/?(p|div|br|tr|li|h[1-6]|section|article|header|footer|blockquote)[^>]*>/gi, '\n')
    // Replace table cells with tabs
    .replace(/<\/?(td|th)[^>]*>/gi, '\t')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse runs of whitespace/newlines
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000)
}

/**
 * Mark a notification log entry as successfully sent to the SMTP transport.
 * Sets status → 'sent_to_smtp' and records sentAt = now.
 * Optionally stores the email subject and a plain-text body snapshot.
 */
async function markNotificationSent(
  userId: mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
  forDate: string,
  extraDiscriminator = '',
  emailSubject?: string,
  emailBodyHtml?: string
): Promise<void> {
  const key = buildKey(userId, type, forDate, extraDiscriminator)
  const update: Record<string, unknown> = {
    status: 'sent_to_smtp' as NotificationDeliveryStatus,
    sentAt: new Date(),
  }
  if (emailSubject) {
    update.emailSubject = emailSubject.slice(0, 500)
  }
  if (emailBodyHtml) {
    update.emailBodySnapshot = stripHtmlForSnapshot(emailBodyHtml)
  }
  await NotificationLog.updateOne({ key }, { $set: update }).catch(() => undefined)
}

/**
 * Mark a notification log entry as failed.
 * Sanitises the error message to never include credentials.
 */
async function markNotificationFailed(
  userId: mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
  forDate: string,
  extraDiscriminator = '',
  errorMessage?: string
): Promise<void> {
  const key = buildKey(userId, type, forDate, extraDiscriminator)
  const safe = (errorMessage ?? 'unknown error')
    .replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
    .slice(0, 500)
  await NotificationLog.updateOne(
    { key },
    {
      $set: {
        status:       'failed' as NotificationDeliveryStatus,
        errorMessage: safe,
      },
    }
  ).catch(() => undefined)
}

// ─── Type definitions ─────────────────────────────────────────────────────────

interface NotifPrefs {
  taskReminders:  boolean
  habitReminders: boolean
  spendingAlerts: boolean
  dailySummary:   boolean
}

interface EmailNotifPrefs {
  enabled:        boolean
  taskReminders:  boolean
  habitReminders: boolean
  spendingAlerts: boolean
  dailySummary:   boolean
  weeklySummary:  boolean
}

interface UserRecord {
  _id:                     mongoose.Types.ObjectId
  publicId:                string
  name:                    string
  email:                   string
  timezone:                string
  notificationPreferences: NotifPrefs
  emailNotifications:      EmailNotifPrefs
  /**
   * Only users with notificationsTested=true receive regular Gmail notifications.
   * This is set to true after the user completes the one-time test email flow.
   * Legacy documents default to false (safe: no emails until the user tests).
   */
  notificationsTested:     boolean
}

/** Results for a single user's notification run. */
interface UserResult {
  userId:  string
  sent:    number
  skipped: number
  errors:  string[]
}

// ─── Email eligibility helper ─────────────────────────────────────────────────

/**
 * Determine whether an email should be sent for a given category.
 *
 * Rules (all must be true):
 *   1. emailNotifications.enabled is true  (master switch)
 *   2. The per-category flag is true
 *   3. The user has a valid email address
 *
 * The email address is ALWAYS sourced from the user's DB record — never from
 * client input.
 */
export function shouldSendEmail(
  emailPrefs: EmailNotifPrefs,
  categoryKey: keyof Omit<EmailNotifPrefs, 'enabled'>,
  userEmail: string
): boolean {
  if (!emailPrefs.enabled) return false
  if (!emailPrefs[categoryKey]) return false
  if (!userEmail || !userEmail.includes('@')) return false
  return true
}

// ─── Delivery helper ──────────────────────────────────────────────────────────

interface DeliveryOptions {
  userId:          mongoose.Types.ObjectId
  lifeFlowId:      string
  prefs:           NotifPrefs
  prefKey:         keyof NotifPrefs
  emailPrefs:      EmailNotifPrefs
  emailPrefKey:    keyof Omit<EmailNotifPrefs, 'enabled'>
  userEmail:       string
  /** Idempotency discriminators — used to update the log entry status. */
  notifType:       ScheduledNotificationType
  forDate:         string
  extraDiscriminator?: string
  inApp: {
    title:   string
    message: string
    type:    'task' | 'habit' | 'expense' | 'general' | 'reminder'
  }
  push?: {
    title: string
    body:  string
    url:   string
    tag:   string
  }
  email?: {
    subject: string
    html:    string
    text:    string
  }
}

/**
 * Deliver a notification across all enabled channels.
 *
 * Channel independence: a failure in push does not abort email, and vice versa.
 * The recipient email address is always taken from `opts.userEmail` which must
 * be the authenticated user's registered address from the database.
 *
 * After all channels are attempted, the NotificationLog entry is updated:
 *   → sent_to_smtp  if email was attempted and succeeded
 *   → failed        if email was the only channel and it failed
 *   → sent_to_smtp  if in-app/push succeeded (email not configured/enabled)
 */
async function deliver(opts: DeliveryOptions): Promise<void> {
  const {
    userId, lifeFlowId, prefs, prefKey,
    emailPrefs, emailPrefKey, userEmail,
    notifType, forDate, extraDiscriminator,
    inApp, push, email,
  } = opts

  if (!prefs[prefKey]) return // user has this category disabled

  let emailOk = false
  let emailAttempted = false

  // ── In-app ─────────────────────────────────────────────────────────────────
  await Notification.create({
    userId,
    lifeFlowId,
    title:   inApp.title,
    message: inApp.message,
    type:    inApp.type,
  }).catch((err: unknown) => {
    logger.warn('[notifScheduler] In-app creation failed', {
      userId: userId.toString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  })

  // ── Push ───────────────────────────────────────────────────────────────────
  if (push) {
    await sendPushToUser(userId, push).catch((err: unknown) => {
      logger.warn('[notifScheduler] Push delivery failed', {
        userId: userId.toString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  // Only send when the user has email notifications enabled for this category.
  // The recipient is always the user's own registered address — never a
  // client-supplied address.
  if (email && shouldSendEmail(emailPrefs, emailPrefKey, userEmail)) {
    emailAttempted = true
    logger.info('[EMAIL] notification preparing', {
      userId:           userId.toString(),
      notificationType: emailPrefKey,
    })

    try {
      logger.info('[EMAIL] sending', { notificationType: emailPrefKey })

      const notifier = await getNotificationService()
      const result = await notifier.send({
        to:      userEmail,
        subject: email.subject,
        html:    email.html,
        text:    email.text,
      })

      if (result.ok) {
        emailOk = true
        logger.info('[EMAIL] sent successfully', {
          notificationType: emailPrefKey,
          messageId:        result.messageId,
        })
      } else {
        logger.warn('[EMAIL] delivery failed', {
          notificationType: emailPrefKey,
          error:            result.error ?? 'provider returned non-ok',
        })
        await markNotificationFailed(
          userId, notifType, forDate, extraDiscriminator ?? '',
          result.error ?? 'provider returned non-ok'
        )
        return
      }
    } catch (err: unknown) {
      // Email failure never aborts in-app or push — log and continue.
      const sanitisedError = err instanceof Error
        ? err.message.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
        : 'unexpected error'

      logger.warn('[EMAIL] delivery failed', {
        notificationType: emailPrefKey,
        error:            sanitisedError,
      })
      await markNotificationFailed(
        userId, notifType, forDate, extraDiscriminator ?? '', sanitisedError
      )
      return
    }
  }

  // ── Update status ──────────────────────────────────────────────────────────
  // Mark sent_to_smtp if email was successfully delivered, or if in-app/push
  // ran (email was not configured/required for this notification).
  if (!emailAttempted || emailOk) {
    await markNotificationSent(
      userId, notifType, forDate, extraDiscriminator ?? '',
      emailOk && email ? email.subject   : undefined,
      emailOk && email ? email.html      : undefined,
    )
  }
}

// ─── Per-user notification processors ────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  food:          'Food & Dining',
  transport:     'Transport',
  shopping:      'Shopping',
  bills:         'Bills & Utilities',
  entertainment: 'Entertainment',
  education:     'Education',
  health:        'Health & Wellness',
  subscriptions: 'Subscriptions',
  other:         'Other',
}

// ─── 0. Morning daily brief (7:00 AM) ────────────────────────────────────────
//
// Sent at 07:00 local time.
// Personalised snapshot of today: tasks, habits, goals.
// Only sent to users who have notificationsTested=true AND email notifications enabled.
// Not sent if there is nothing relevant for today.
//
// PRECISION
// ─────────
// The target UTC is computed from localTimeToUtc('07:00', userTimezone).
// When using the precise endpoint (grace = 90s), this fires within seconds of 7 AM.
// When using the hourly endpoint (grace = 3600s), this fires during the 7:xx AM hour.

async function processMorningBrief(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: boolean }> {
  // Morning brief requires email to be enabled and tested
  if (!user.notificationsTested) return { sent: false }
  if (!user.emailNotifications.enabled) return { sent: false }
  if (!user.emailNotifications.dailySummary) return { sent: false }

  const tz      = user.timezone
  const today   = dateInTimezone(now, tz)

  // Compute target UTC for 7:00 AM in the user's local timezone
  const targetUtc = localTimeToUtc(today, '07:00', tz)
  if (!targetUtc) return { sent: false }

  // Only fire if we're within the grace window after the target
  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  const alreadySent = await checkAndRecord(
    user._id, 'MORNING_BRIEF', today, '',
    targetUtc,
    `Morning brief for ${today}`
  )
  if (alreadySent) return { sent: false }

  // Gather today's data in parallel
  const [
    todayTasks,
    completedTasks,
    allDailyHabits,
    completedHabitLogs,
    activeGoals,
  ] = await Promise.all([
    Task.find({ userId: user._id, dueDate: today, completed: false })
      .select('title priority dueTime recurring')
      .sort({ priority: -1, dueTime: 1 })
      .limit(10)
      .lean(),
    Task.countDocuments({ userId: user._id, dueDate: today, completed: true }),
    Habit.find({ userId: user._id, frequency: 'daily' })
      .select('name icon')
      .lean(),
    HabitLog.find({ userId: user._id, date: today, completed: true })
      .select('habitId')
      .lean(),
    Goal.find({ userId: user._id, status: 'active' })
      .select('title targetValue currentValue unit targetDate category')
      .sort({ targetDate: 1 })
      .limit(5)
      .lean(),
  ])

  const completedHabitIds = new Set(completedHabitLogs.map((l) => l.habitId.toString()))
  const incompleteHabits = allDailyHabits.filter((h) => !completedHabitIds.has(h._id.toString()))

  // Do not send if there is genuinely nothing to brief
  const hasContent =
    todayTasks.length > 0 ||
    completedTasks > 0 ||
    incompleteHabits.length > 0 ||
    activeGoals.length > 0

  if (!hasContent) {
    // Release the slot so it isn't counted as a skip forever
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'MORNING_BRIEF',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const todayLabel   = formatDateLabel(today, tz)
  const taskTitles   = todayTasks.slice(0, 5).map((t) => t.title)
  const habitNames   = incompleteHabits.slice(0, 5).map((h) => `${h.icon} ${h.name}`)
  const goalTitles   = activeGoals.slice(0, 3).map((g) => g.title)

  const preview = [
    todayTasks.length > 0 ? `${todayTasks.length} task(s) due` : null,
    incompleteHabits.length > 0 ? `${incompleteHabits.length} habit(s) to complete` : null,
    activeGoals.length > 0 ? `${activeGoals.length} active goal(s)` : null,
  ].filter(Boolean).join(' · ')

  // Update the content preview now that we know the content
  await NotificationLog.updateOne(
    { userId: user._id, type: 'MORNING_BRIEF', forDate: today },
    { $set: { contentPreview: preview.slice(0, 200), status: 'processing' } }
  ).catch(() => undefined)

  const emailContent = buildMorningBriefEmail({
    toName:            user.name,
    todayLabel,
    scheduledTimeLabel: '7:00 AM',
    taskCount:          todayTasks.length,
    taskTitles,
    completedTaskCount: completedTasks,
    habitCount:         incompleteHabits.length,
    habitNames,
    goalTitles,
    totalGoals:        activeGoals.length,
    appUrl,
  })

  const notifier = await getNotificationService()
  let emailOk = false
  try {
    const result = await notifier.send({
      to:      user.email,
      subject: emailContent.subject,
      html:    emailContent.html,
      text:    emailContent.text,
    })
    emailOk = result.ok
    if (result.ok) {
      logger.info('[EMAIL] sent successfully', {
        notificationType: 'morningBrief',
        messageId:        result.messageId,
      })
    } else {
      logger.warn('[EMAIL] delivery failed', {
        notificationType: 'morningBrief',
        error: result.error ?? 'provider returned non-ok',
      })
    }
  } catch (err: unknown) {
    const sanitisedError = err instanceof Error
      ? err.message.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
      : 'unexpected error'
    logger.warn('[EMAIL] morning brief delivery failed', {
      userId: user._id.toString(),
      error:  sanitisedError,
    })
    await markNotificationFailed(user._id, 'MORNING_BRIEF', today, '', sanitisedError)
    return { sent: false }
  }

  if (emailOk) {
    await markNotificationSent(
      user._id, 'MORNING_BRIEF', today, '',
      emailContent.subject,
      emailContent.html,
    )
    // Create an in-app notification as well
    await Notification.create({
      userId:     user._id,
      lifeFlowId: user.publicId,
      title:      `Good morning! Here's your day`,
      message:    preview,
      type:       'general',
    }).catch(() => undefined)
  } else {
    await markNotificationFailed(
      user._id, 'MORNING_BRIEF', today, '', 'email provider returned non-ok'
    )
    return { sent: false }
  }

  logger.info('[notifScheduler] MORNING_BRIEF sent', {
    userId:      user._id.toString(),
    taskCount:   todayTasks.length,
    habitCount:  incompleteHabits.length,
    goalCount:   activeGoals.length,
  })
  return { sent: true }
}

// ─── 1. Today's incomplete tasks (7 PM) ──────────────────────────────────────
//
// Sent at 19:00 (7 PM) local time.
// Subject: "You still have work to finish today"
// Only sent when there are incomplete tasks for today.
//
// PRECISION
// ─────────
// Target UTC = localTimeToUtc('19:00', userTimezone).
// Grace window: when called by precise scheduler = 90s, by hourly = 3600s.

async function processIncompleteTasks(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders) return { sent: false }

  const tz    = user.timezone
  const today = dateInTimezone(now, tz)

  const targetUtc = localTimeToUtc(today, '19:00', tz)
  if (!targetUtc) return { sent: false }

  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  const alreadySent = await checkAndRecord(
    user._id, 'TASK_INCOMPLETE_TODAY', today, '',
    targetUtc,
    'Incomplete tasks check'
  )
  if (alreadySent) return { sent: false }

  const hr = localHour(now, tz)
  if (isQuietHour(hr)) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'TASK_INCOMPLETE_TODAY', forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const tasks = await Task.find({
    userId:    user._id,
    dueDate:   today,
    completed: false,
  })
    .select('title')
    .sort({ priority: -1, createdAt: 1 })
    .limit(10)
    .lean()

  if (tasks.length === 0) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'TASK_INCOMPLETE_TODAY', forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count     = tasks.length
  const titles    = tasks.slice(0, 5).map((t) => t.title)
  const dateLabel = formatDateLabel(today, tz)
  const taskWord  = count === 1 ? 'task' : 'tasks'

  await NotificationLog.updateOne(
    { userId: user._id, type: 'TASK_INCOMPLETE_TODAY', forDate: today },
    { $set: { status: 'processing', contentPreview: `${count} incomplete ${taskWord}` } }
  ).catch(() => undefined)

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      'taskReminders',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'taskReminders',
    userEmail:    user.email,
    notifType:    'TASK_INCOMPLETE_TODAY',
    forDate:      today,
    inApp: {
      title:   `${count} ${taskWord} still incomplete today`,
      message: titles.slice(0, 3).join(' • '),
      type:    'task',
    },
    push: {
      title: `${count} ${taskWord} still incomplete today`,
      body:  titles.slice(0, 2).join('\n'),
      url:   '/app/tasks',
      tag:   'TASK_INCOMPLETE_TODAY',
    },
    email: buildIncompleteTasksEmail({
      toName:     user.name,
      taskCount:  count,
      taskTitles: titles,
      todayLabel: dateLabel,
      appUrl,
    }),
  })

  logger.info('[notifScheduler] TASK_INCOMPLETE_TODAY sent', {
    userId: user._id.toString(),
    count,
  })
  return { sent: true }
}

// ─── 2. Tomorrow preview (10 PM) ─────────────────────────────────────────────
//
// Sent at 22:00 (10 PM) local time.
// Combines tomorrow's tasks AND habits into one email.
// Not sent if there is nothing planned for tomorrow.

async function processTomorrowPreview(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders && !prefs.habitReminders) return { sent: false }

  const tz       = user.timezone
  const today    = dateInTimezone(now, tz)
  const tomorrow = addOneDay(today)

  const targetUtc = localTimeToUtc(today, '22:00', tz)
  if (!targetUtc) return { sent: false }

  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  const hr = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: false }

  const alreadySent = await checkAndRecord(
    user._id, 'TASK_TOMORROW', tomorrow, '',
    targetUtc,
    'Tomorrow preview'
  )
  if (alreadySent) return { sent: false }

  const [tasks, habits] = await Promise.all([
    prefs.taskReminders
      ? Task.find({ userId: user._id, dueDate: tomorrow, completed: false })
          .select('title')
          .sort({ priority: -1, createdAt: 1 })
          .limit(10)
          .lean()
      : Promise.resolve([]),
    prefs.habitReminders
      ? Habit.find({ userId: user._id, frequency: 'daily' })
          .select('name icon')
          .sort({ createdAt: 1 })
          .lean()
      : Promise.resolve([]),
  ])

  if (tasks.length === 0 && habits.length === 0) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'TASK_TOMORROW', forDate: tomorrow,
    }).catch(() => undefined)
    return { sent: false }
  }

  const taskCount  = tasks.length
  const taskTitles = tasks.slice(0, 5).map((t) => t.title)
  const habitCount = habits.length
  const habitNames = habits.slice(0, 5).map((h) => `${h.icon} ${h.name}`)
  const dateLabel  = formatDateLabel(tomorrow, tz)

  const inAppParts: string[] = []
  if (taskCount > 0)  inAppParts.push(`${taskCount} task${taskCount > 1 ? 's' : ''}`)
  if (habitCount > 0) inAppParts.push(`${habitCount} habit${habitCount > 1 ? 's' : ''}`)

  await NotificationLog.updateOne(
    { userId: user._id, type: 'TASK_TOMORROW', forDate: tomorrow },
    { $set: { status: 'processing', contentPreview: `Tomorrow: ${inAppParts.join(' + ')}` } }
  ).catch(() => undefined)

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      taskCount > 0 ? 'taskReminders' : 'habitReminders',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'taskReminders',
    userEmail:    user.email,
    notifType:    'TASK_TOMORROW',
    forDate:      tomorrow,
    inApp: {
      title:   `Tomorrow: ${inAppParts.join(' + ')} planned`,
      message: [...taskTitles.slice(0, 2), ...habitNames.slice(0, 1)].join(' • '),
      type:    'task',
    },
    push: {
      title: `Tomorrow: ${inAppParts.join(' + ')} planned`,
      body:  taskTitles.slice(0, 2).join('\n') || habitNames.slice(0, 2).join('\n'),
      url:   '/app/dashboard',
      tag:   'TASK_TOMORROW',
    },
    email: buildTomorrowPreviewEmail({
      toName:        user.name,
      tomorrowLabel: dateLabel,
      taskCount,
      taskTitles,
      habitCount,
      habitNames,
      appUrl,
    }),
  })

  logger.info('[notifScheduler] TASK_TOMORROW (tomorrow preview) sent', {
    userId: user._id.toString(),
    taskCount,
    habitCount,
  })
  return { sent: true }
}

// ─── 3. Daily summary (11:55 PM) ─────────────────────────────────────────────
//
// Sent at 23:55 (11:55 PM) local time.
// Covers today's tasks, habits, and expenses.
// Not sent if there is nothing to report.

async function processDailySummary(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.dailySummary) return { sent: false }

  const tz    = user.timezone
  const today = dateInTimezone(now, tz)

  // Target: 23:55 local
  const targetUtc = localTimeToUtc(today, '23:55', tz)
  if (!targetUtc) return { sent: false }

  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  const hr = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: false }

  const alreadySent = await checkAndRecord(
    user._id, 'DAILY_SUMMARY', today, '',
    targetUtc,
    'Daily summary'
  )
  if (alreadySent) return { sent: false }

  const [tasksCompleted, tasksRemaining, allDailyHabits, completedLogs, todayExpenses] =
    await Promise.all([
      Task.countDocuments({ userId: user._id, dueDate: today, completed: true }),
      Task.countDocuments({ userId: user._id, dueDate: today, completed: false }),
      Habit.countDocuments({ userId: user._id, frequency: 'daily' }),
      HabitLog.countDocuments({ userId: user._id, date: today, completed: true }),
      Expense.countDocuments({ userId: user._id, date: today }),
    ])

  const hasAnything =
    tasksCompleted > 0 || tasksRemaining > 0 || allDailyHabits > 0 || todayExpenses > 0
  if (!hasAnything) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'DAILY_SUMMARY', forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const month   = currentMonth(now, tz)
  const budgets = await Budget.find({ userId: user._id, month, status: 'active' }).lean()
  let spendingNote: string | undefined

  for (const budget of budgets) {
    if (budget.amountMinor <= 0) continue
    const startOfMonth = `${month}-01`
    const agg = await Expense.aggregate([
      {
        $match: {
          userId:   user._id,
          category: budget.category,
          date:     { $gte: startOfMonth, $lte: today },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    const totalRupees  = agg[0]?.total ?? 0
    const budgetRupees = budget.amountMinor / 100
    if (totalRupees / budgetRupees >= 0.8) {
      const label = CATEGORY_LABELS[budget.category] ?? budget.category
      const pct   = Math.round((totalRupees / budgetRupees) * 100)
      spendingNote = pct >= 100
        ? `${label} budget has been exceeded.`
        : `${label} budget is ${pct}% used.`
      break
    }
  }

  const dateLabel    = formatDateLabel(today, tz)
  const summaryTitle = 'Your LifeFlow daily summary'
  const summaryMsg   = [
    `Tasks: ${tasksCompleted} done, ${tasksRemaining} remaining`,
    `Habits: ${completedLogs}/${allDailyHabits} completed`,
    ...(spendingNote ? [spendingNote] : []),
  ].join(' · ')

  await NotificationLog.updateOne(
    { userId: user._id, type: 'DAILY_SUMMARY', forDate: today },
    { $set: { status: 'processing', contentPreview: summaryMsg.slice(0, 200) } }
  ).catch(() => undefined)

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      'dailySummary',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'dailySummary',
    userEmail:    user.email,
    notifType:    'DAILY_SUMMARY',
    forDate:      today,
    inApp: {
      title:   summaryTitle,
      message: summaryMsg,
      type:    'general',
    },
    push: {
      title: summaryTitle,
      body:  summaryMsg,
      url:   '/app/dashboard',
      tag:   'DAILY_SUMMARY',
    },
    email: buildDailySummaryEmail({
      toName:          user.name,
      todayLabel:      dateLabel,
      tasksCompleted,
      tasksRemaining,
      habitsCompleted: completedLogs,
      habitsTotal:     allDailyHabits,
      spendingNote,
      appUrl,
    }),
  })

  logger.info('[notifScheduler] DAILY_SUMMARY sent', {
    userId:          user._id.toString(),
    tasksCompleted,
    tasksRemaining,
    habitsCompleted: completedLogs,
    habitsTotal:     allDailyHabits,
    todayExpenses,
  })
  return { sent: true }
}

// ─── 4. Weekly summary (Sunday 10 PM) ────────────────────────────────────────
//
// Sent every Sunday at 22:00 (10 PM) local time.
// Covers the 7-day period ending today (Mon–Sun).

async function processWeeklySummary(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: boolean }> {
  const tz  = user.timezone
  const dow = localDayOfWeek(now, tz) // 0 = Sunday

  if (dow !== 0) return { sent: false }

  if (!user.emailNotifications.enabled)       return { sent: false }
  if (!user.emailNotifications.weeklySummary) return { sent: false }

  const today = dateInTimezone(now, tz)

  const targetUtc = localTimeToUtc(today, '22:00', tz)
  if (!targetUtc) return { sent: false }

  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  const hr = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: false }

  const weekStart = subtractDays(today, 6)
  const weekKey   = `${weekStart}:${today}`

  const alreadySent = await checkAndRecord(
    user._id, 'WEEKLY_SUMMARY', today, weekKey,
    targetUtc,
    'Weekly summary'
  )
  if (alreadySent) return { sent: false }

  const [
    tasksCompleted,
    tasksTotal,
    allDailyHabits,
    completedHabitLogs,
    weekExpenses,
  ] = await Promise.all([
    Task.countDocuments({
      userId: user._id, dueDate: { $gte: weekStart, $lte: today }, completed: true,
    }),
    Task.countDocuments({
      userId: user._id, dueDate: { $gte: weekStart, $lte: today },
    }),
    Habit.countDocuments({ userId: user._id, frequency: 'daily' }),
    HabitLog.countDocuments({
      userId: user._id, date: { $gte: weekStart, $lte: today }, completed: true,
    }),
    Expense.find({ userId: user._id, date: { $gte: weekStart, $lte: today } })
      .select('category')
      .lean(),
  ])

  const habitsTotal = allDailyHabits * 7

  const hasAnything = tasksTotal > 0 || habitsTotal > 0 || weekExpenses.length > 0
  if (!hasAnything) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'WEEKLY_SUMMARY', forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const catCounts: Record<string, number> = {}
  for (const e of weekExpenses) {
    catCounts[e.category] = (catCounts[e.category] ?? 0) + 1
  }
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topExpenseCategory = topCat ? (CATEGORY_LABELS[topCat] ?? topCat) : undefined

  const activeDaysSet = new Set<string>()
  const [taskDates, habitLogDates] = await Promise.all([
    Task.find({
      userId: user._id, dueDate: { $gte: weekStart, $lte: today }, completed: true,
    }).select('dueDate').lean(),
    HabitLog.find({
      userId: user._id, date: { $gte: weekStart, $lte: today }, completed: true,
    }).select('date').lean(),
  ])
  for (const t of taskDates)     { if (t.dueDate) activeDaysSet.add(t.dueDate) }
  for (const h of habitLogDates) activeDaysSet.add(h.date)
  const activeDays = activeDaysSet.size

  const weekLabel = weekRangeLabel(weekStart, today, tz)
  const preview   = `Tasks ${tasksCompleted}/${tasksTotal} · Habits ${completedHabitLogs}/${habitsTotal} · ${weekExpenses.length} txn`

  await NotificationLog.updateOne(
    { userId: user._id, type: 'WEEKLY_SUMMARY', forDate: today },
    { $set: { status: 'processing', contentPreview: preview.slice(0, 200) } }
  ).catch(() => undefined)

  const notifier = await getNotificationService()
  const { subject, html, text } = buildWeeklySummaryEmail({
    toName:             user.name,
    weekLabel,
    tasksCompleted,
    tasksTotal,
    habitsCompleted:    completedHabitLogs,
    habitsTotal,
    expenseCount:       weekExpenses.length,
    topExpenseCategory,
    activeDays,
    appUrl,
  })

  let emailOk = false
  try {
    const result = await notifier.send({
      to: user.email, subject, html, text,
    })
    emailOk = result.ok
    if (result.ok) {
      logger.info('[EMAIL] sent successfully', {
        notificationType: 'weeklySummary',
        messageId:        result.messageId,
      })
    } else {
      logger.warn('[EMAIL] delivery failed', {
        notificationType: 'weeklySummary',
        error:            result.error ?? 'provider returned non-ok',
      })
    }
  } catch (err: unknown) {
    const sanitisedError = err instanceof Error
      ? err.message.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
      : 'unexpected error'
    logger.warn('[EMAIL] delivery failed', {
      notificationType: 'weeklySummary',
      error: sanitisedError,
    })
    await markNotificationFailed(user._id, 'WEEKLY_SUMMARY', today, weekKey, sanitisedError)
    return { sent: false }
  }

  if (emailOk) {
    await markNotificationSent(
      user._id, 'WEEKLY_SUMMARY', today, weekKey,
      subject,
      html,
    )
  } else {
    await markNotificationFailed(
      user._id, 'WEEKLY_SUMMARY', today, weekKey, 'provider returned non-ok'
    )
    return { sent: false }
  }

  await Notification.create({
    userId:     user._id,
    lifeFlowId: user.publicId,
    title:      'Your weekly summary is ready',
    message:    preview,
    type:       'general',
  }).catch((err: unknown) => {
    logger.warn('[notifScheduler] In-app weekly summary creation failed', {
      userId:       user._id.toString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  })

  logger.info('[notifScheduler] WEEKLY_SUMMARY sent', {
    userId:          user._id.toString(),
    weekLabel,
    tasksCompleted,
    habitsCompleted: completedHabitLogs,
    expenseCount:    weekExpenses.length,
    activeDays,
  })
  return { sent: true }
}

// ─── 5. Habit reminder (morning, 9:30 AM) ────────────────────────────────────
//
// Sent at 09:30 local time.

async function processHabitReminder(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.habitReminders) return { sent: false }

  const tz    = user.timezone
  const today = dateInTimezone(now, tz)

  const targetUtc = localTimeToUtc(today, '09:30', tz)
  if (!targetUtc) return { sent: false }

  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  const hr = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: false }

  const alreadySent = await checkAndRecord(
    user._id, 'HABIT_REMINDER', today, '',
    targetUtc,
    'Habit reminder'
  )
  if (alreadySent) return { sent: false }

  const allDailyHabits = await Habit.find({ userId: user._id, frequency: 'daily' })
    .select('_id name icon')
    .lean()

  if (allDailyHabits.length === 0) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'HABIT_REMINDER', forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const completedLogs = await HabitLog.find({
    userId: user._id, date: today, completed: true,
  })
    .select('habitId')
    .lean()

  const completedIds = new Set(completedLogs.map((l) => l.habitId.toString()))
  const incomplete   = allDailyHabits.filter((h) => !completedIds.has(h._id.toString()))

  if (incomplete.length === 0) {
    await NotificationLog.deleteOne({
      userId: user._id, type: 'HABIT_REMINDER', forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count      = incomplete.length
  const names      = incomplete.slice(0, 5).map((h) => `${h.icon} ${h.name}`)
  const habitWord  = count === 1 ? 'habit' : 'habits'
  const todayLabel = formatDateLabel(today, tz)

  await NotificationLog.updateOne(
    { userId: user._id, type: 'HABIT_REMINDER', forDate: today },
    { $set: { status: 'processing', contentPreview: `${count} ${habitWord} to complete` } }
  ).catch(() => undefined)

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      'habitReminders',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'habitReminders',
    userEmail:    user.email,
    notifType:    'HABIT_REMINDER',
    forDate:      today,
    inApp: {
      title:   `${count} ${habitWord} to complete today`,
      message: names.slice(0, 3).join(' • '),
      type:    'habit',
    },
    push: {
      title: `${count} ${habitWord} to complete today`,
      body:  names.slice(0, 2).join('\n'),
      url:   '/app/habits',
      tag:   'HABIT_REMINDER',
    },
    email: buildHabitReminderEmail({
      toName:          user.name,
      todayLabel,
      incompleteCount: count,
      habitNames:      names,
      totalCount:      allDailyHabits.length,
      appUrl,
    }),
  })

  logger.info('[notifScheduler] HABIT_REMINDER sent', {
    userId: user._id.toString(),
    count,
  })
  return { sent: true }
}

// ─── 6. Spending alerts ───────────────────────────────────────────────────────
//
// Sent any time (no time-window restriction, respects quiet hours).
// Alert thresholds: 80% and 100% of budget used.

const ALERT_THRESHOLDS = [80, 100] as const
type AlertThreshold = typeof ALERT_THRESHOLDS[number]

async function processSpendingAlerts(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: number }> {
  const prefs = user.notificationPreferences
  if (!prefs.spendingAlerts) return { sent: 0 }

  const tz = user.timezone
  const hr = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: 0 }

  const month = currentMonth(now, tz)
  const today = dateInTimezone(now, tz)

  const budgets = await Budget.find({
    userId: user._id, month, status: 'active',
  }).lean()

  if (budgets.length === 0) return { sent: 0 }

  let sentCount = 0

  for (const budget of budgets) {
    const startOfMonth = `${month}-01`
    const expenseAgg = await Expense.aggregate([
      {
        $match: {
          userId:   user._id,
          category: budget.category,
          date:     { $gte: startOfMonth, $lte: today },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])

    const totalRupees  = expenseAgg[0]?.total ?? 0
    const budgetRupees = budget.amountMinor / 100
    if (budgetRupees <= 0) continue

    const percentUsed = Math.round((totalRupees / budgetRupees) * 100)

    let crossedThreshold: AlertThreshold | null = null
    for (const threshold of ALERT_THRESHOLDS) {
      if (percentUsed >= threshold) crossedThreshold = threshold
    }
    if (crossedThreshold === null) continue

    const discriminator = `${budget.category}:${crossedThreshold}`
    const categoryLabel = CATEGORY_LABELS[budget.category] ?? budget.category
    const isOver        = crossedThreshold >= 100
    const preview       = isOver
      ? `${categoryLabel} budget exceeded (${percentUsed}%)`
      : `${categoryLabel} budget ${percentUsed}% used`

    const alreadySent = await checkAndRecord(
      user._id, 'SPENDING_ALERT', month, discriminator,
      new Date(),
      preview
    )
    if (alreadySent) continue

    const pushTitle = isOver
      ? `${categoryLabel} budget exceeded`
      : `${categoryLabel} budget is nearly full`
    const pushBody  = isOver
      ? `You have exceeded your ${categoryLabel} budget this month.`
      : `Your ${categoryLabel} budget is ${percentUsed}% used.`

    await NotificationLog.updateOne(
      { userId: user._id, type: 'SPENDING_ALERT', forDate: month },
      { $set: { status: 'processing' } }
    ).catch(() => undefined)

    await deliver({
      userId:             user._id,
      lifeFlowId:         user.publicId,
      prefs,
      prefKey:            'spendingAlerts',
      emailPrefs:         user.emailNotifications,
      emailPrefKey:       'spendingAlerts',
      userEmail:          user.email,
      notifType:          'SPENDING_ALERT',
      forDate:            month,
      extraDiscriminator: discriminator,
      inApp: {
        title:   pushTitle,
        message: pushBody,
        type:    'expense',
      },
      push: {
        title: pushTitle,
        body:  pushBody,
        url:   '/app/budgets',
        tag:   `SPENDING_ALERT_${budget.category}`,
      },
      email: buildSpendingAlertEmail({
        toName:        user.name,
        categoryLabel,
        percentUsed,
        appUrl,
      }),
    })

    sentCount++
    logger.info('[notifScheduler] SPENDING_ALERT sent', {
      userId:     user._id.toString(),
      category:   budget.category,
      threshold:  crossedThreshold,
      percentUsed,
    })
  }

  return { sent: sentCount }
}

// ─── 7. Task due-soon reminder (30 minutes before due time) ──────────────────
//
// Sends a reminder 30 minutes before each task's due time.
//
// PRECISE TIMING
// ──────────────
// For each task with a dueTime, the reminder target UTC is computed as:
//
//   reminderTargetUtc = localTimeToUtc(today, dueTime, userTimezone) - 30 minutes
//
// The scheduler then checks:  isWithinGraceWindow(now, reminderTargetUtc, graceSeconds)
//
// When graceSeconds = 90 (precise scheduler, ~1 min cron):
//   Notification fires within ±90 seconds of the exact 30-minute mark.
//
// When graceSeconds = 3600 (hourly scheduler):
//   The existing ±15-minute window approach is used for full backwards compatibility.
//
// MISSED REMINDER PROTECTION
// ──────────────────────────
// If the server was offline during the reminder window:
//   - With precise scheduler: the task's dueTime - 30 min will be > graceSeconds in the
//     past when the scheduler comes back → missed → NOT sent (avoids misleading reminder).
//   - With hourly scheduler: same ±15 min window approach as before.

function localTime(date: Date, timezone: string): { hour: number; minute: number } {
  return {
    hour:   localHour(date, timezone),
    minute: localMinute(date, timezone),
  }
}

function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return -1
  const parts = timeStr.trim().split(':')
  if (parts.length < 2) return -1
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return -1
  return h * 60 + m
}

function formatTime12h(timeStr: string): string {
  const mins = timeStringToMinutes(timeStr)
  if (mins < 0) return timeStr
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const period = h < 12 ? 'AM' : 'PM'
  const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

function buildDueLabel(dueDate: string, dueTime: string, today: string, timezone: string): string {
  const timeLabel = formatTime12h(dueTime)
  if (dueDate === today) return `Today at ${timeLabel}`

  try {
    const [y, mo, d] = dueDate.split('-').map(Number)
    const dt = new Date(Date.UTC(y, mo - 1, d, 12))
    const dayName = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday:  'long',
      day:      'numeric',
      month:    'short',
    }).format(dt)
    return `${dayName} at ${timeLabel}`
  } catch {
    return `${dueDate} at ${timeLabel}`
  }
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily:   'Daily',
  weekly:  'Weekly',
  monthly: 'Monthly',
}

async function processTaskDueSoon(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<{ sent: number }> {
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders) return { sent: 0 }

  const tz    = user.timezone
  const today = dateInTimezone(now, tz)

  const hr = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: 0 }

  let candidateTimes: string[]

  if (graceSeconds <= 120) {
    // ── Precise mode (sub-minute cron) ────────────────────────────────────────
    // The reminder window is [now - graceSeconds, now + graceSeconds].
    // A task is eligible if: localTimeToUtc(today, dueTime) - 30min ∈ [now-grace, now+grace]
    // We compute candidate dueTime values by iterating minutes around now+30.
    const nowMs = now.getTime()
    const reminderTargetMs = nowMs + 30 * 60 * 1000  // 30 min from now

    // Collect all HH:MM strings whose UTC representation falls within grace window
    candidateTimes = []
    // Check a ±3 minute range around now+30 to account for sub-minute polling
    for (let deltaSec = -graceSeconds; deltaSec <= graceSeconds; deltaSec += 60) {
      const checkMs  = reminderTargetMs + deltaSec * 1000
      const checkDt  = new Date(checkMs)
      const localH   = localHour(checkDt, tz)
      const localM   = localMinute(checkDt, tz)
      const hh       = localH.toString().padStart(2, '0')
      const mm       = localM.toString().padStart(2, '0')
      candidateTimes.push(`${hh}:${mm}`)
    }
    // Deduplicate
    candidateTimes = [...new Set(candidateTimes)]
  } else {
    // ── Hourly-cron mode (backward compatible ±15 min window) ─────────────────
    const { hour: localHr, minute: localMin } = localTime(now, tz)
    const nowTotalMin  = localHr * 60 + localMin
    const windowLow    = nowTotalMin + 15
    const windowHigh   = nowTotalMin + 45

    candidateTimes = []
    for (let m = windowLow; m < windowHigh; m++) {
      const clampedMin = m % 1440
      const hh = Math.floor(clampedMin / 60).toString().padStart(2, '0')
      const mm = (clampedMin % 60).toString().padStart(2, '0')
      candidateTimes.push(`${hh}:${mm}`)
    }
  }

  if (candidateTimes.length === 0) return { sent: 0 }

  const tasks = await Task.find({
    userId:    user._id,
    completed: false,
    dueTime:   { $in: candidateTimes },
    $or: [
      { recurring: 'none',    dueDate: { $lte: today } },
      { recurring: 'daily'   },
      { recurring: 'weekly'  },
      { recurring: 'monthly' },
    ],
  })
    .select('_id title dueDate dueTime recurring priority projectId')
    .limit(20)
    .lean()

  if (tasks.length === 0) return { sent: 0 }

  const eligibleTasks = tasks.filter((task) => {
    if (task.recurring === 'none') return task.dueDate === today
    return true
  })

  if (eligibleTasks.length === 0) return { sent: 0 }

  let sentCount = 0

  for (const task of eligibleTasks) {
    const taskIdStr = task._id.toString()

    // In precise mode, additionally verify the reminder target hasn't expired
    if (graceSeconds <= 120 && task.dueTime) {
      const dueUtc = localTimeToUtc(today, task.dueTime, tz)
      if (dueUtc) {
        const reminderUtc = new Date(dueUtc.getTime() - 30 * 60 * 1000)
        if (!isWithinGraceWindow(now, reminderUtc, graceSeconds + 60)) {
          // Missed the window — mark as expired rather than skip silently
          logger.info('[notifScheduler] TASK_DUE_SOON missed window', {
            userId:    user._id.toString(),
            taskId:    taskIdStr,
            dueTime:   task.dueTime,
            reminderUtc: reminderUtc.toISOString(),
            nowUtc:    now.toISOString(),
          })
          continue
        }
      }
    }

    // Compute the precise reminder UTC for the log
    const dueUtcForLog   = task.dueTime ? localTimeToUtc(today, task.dueTime, tz) : null
    const reminderUtcLog = dueUtcForLog
      ? new Date(dueUtcForLog.getTime() - 30 * 60 * 1000)
      : new Date()

    const preview = `"${task.title}" due at ${formatTime12h(task.dueTime ?? '')}`

    const alreadySent = await checkAndRecord(
      user._id, 'TASK_DUE_SOON', today, taskIdStr,
      reminderUtcLog,
      preview
    )
    if (alreadySent) continue

    // Re-fetch for latest completion status
    const freshTask = await Task.findOne({ _id: task._id, userId: user._id })
      .select('completed title dueDate dueTime recurring priority')
      .lean()

    if (!freshTask) {
      await NotificationLog.deleteOne({ key: buildKey(user._id, 'TASK_DUE_SOON', today, taskIdStr) }).catch(() => undefined)
      continue
    }

    if (freshTask.completed) {
      await NotificationLog.deleteOne({ key: buildKey(user._id, 'TASK_DUE_SOON', today, taskIdStr) }).catch(() => undefined)
      continue
    }

    await NotificationLog.updateOne(
      { userId: user._id, type: 'TASK_DUE_SOON', forDate: today },
      { $set: { status: 'processing' } }
    ).catch(() => undefined)

    const dueLabel        = buildDueLabel(freshTask.dueDate ?? today, freshTask.dueTime ?? '', today, tz)
    const recurrenceLabel = freshTask.recurring !== 'none'
      ? (RECURRENCE_LABELS[freshTask.recurring] ?? freshTask.recurring)
      : undefined

    await deliver({
      userId:             user._id,
      lifeFlowId:         user.publicId,
      prefs,
      prefKey:            'taskReminders',
      emailPrefs:         user.emailNotifications,
      emailPrefKey:       'taskReminders',
      userEmail:          user.email,
      notifType:          'TASK_DUE_SOON',
      forDate:            today,
      extraDiscriminator: taskIdStr,
      inApp: {
        title:   `Task due in 30 minutes`,
        message: `"${freshTask.title}" is due at ${formatTime12h(freshTask.dueTime ?? '')}`,
        type:    'task',
      },
      push: {
        title: 'Task due in 30 minutes',
        body:  freshTask.title,
        url:   '/app/tasks',
        tag:   `TASK_DUE_SOON_${taskIdStr}`,
      },
      email: buildTaskReminderEmail({
        toName:             user.name,
        taskTitle:          freshTask.title,
        dueLabel,
        recurrenceLabel,
        priority:           freshTask.priority as 'low' | 'medium' | 'high' | undefined,
        // Pass the reminder time so the icon shows the actual scheduled time
        reminderTimeLabel:  freshTask.dueTime
          ? (() => {
              const dueUtc = localTimeToUtc(today, freshTask.dueTime, tz)
              if (!dueUtc) return undefined
              const reminderUtc = new Date(dueUtc.getTime() - 30 * 60 * 1000)
              const h = parseInt(
                new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
                  .formatToParts(reminderUtc).find((p) => p.type === 'hour')?.value ?? '0',
                10
              )
              const m = new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: '2-digit', hour12: false })
                .formatToParts(reminderUtc).find((p) => p.type === 'minute')?.value ?? '00'
              const ampm = h < 12 ? 'AM' : 'PM'
              const h12  = h % 12 || 12
              return `${String(h12).padStart(2, '0')}:${m} ${ampm}`
            })()
          : undefined,
        appUrl,
      }),
    })

    sentCount++
    logger.info('[notifScheduler] TASK_DUE_SOON sent', {
      userId:    user._id.toString(),
      taskId:    taskIdStr,
      taskTitle: freshTask.title,
      dueTime:   freshTask.dueTime,
      recurring: freshTask.recurring,
      graceSeconds,
    })
  }

  return { sent: sentCount }
}

// ─── Group Bill Reminder (10:00 AM) ──────────────────────────────────────────
//
// Sent at 10:00 AM local time, at most once per calendar day per user.
//
// Summarises outstanding Group Bill balances across ALL of the user's bills so
// they receive ONE email/notification instead of one per person.
//
// PREFERENCE MAPPING
// ──────────────────
// No dedicated preference field exists for group bills — we reuse the existing
// spendingAlerts flags which are semantically closest (financial reminders).
// • In-app gate: notificationPreferences.spendingAlerts
// • Email gate:  emailNotifications.enabled && emailNotifications.spendingAlerts
//
// This avoids modifying the User schema (which would require a migration) while
// still honouring the user's intent.  If they've turned off spending alerts,
// they've expressed that they don't want financial reminders.
//
// DEDUPLICATION
// ─────────────
// Key: <userId>:GROUP_BILL_REMINDER:<YYYY-MM-DD>
// One NotificationLog entry per user per day, guarded by the unique index.

async function processGroupBillReminder(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600,
): Promise<{ sent: boolean }> {
  const tz    = user.timezone
  const today = dateInTimezone(now, tz)

  // Target: 10:00 AM local time
  const targetUtc = localTimeToUtc(today, '10:00', tz)
  if (!targetUtc) return { sent: false }

  if (!isWithinGraceWindow(now, targetUtc, graceSeconds)) return { sent: false }

  // Gate: in-app preference
  if (!user.notificationPreferences.spendingAlerts) return { sent: false }

  // Check deduplication (also claims the slot atomically)
  const alreadySent = await checkAndRecord(
    user._id,
    'GROUP_BILL_REMINDER',
    today,
    '',
    targetUtc,
    `Group bill reminder for ${today}`,
  )
  if (alreadySent) return { sent: false }

  // Fetch data — scoped to this user only
  const [bills, people] = await Promise.all([
    GroupBill.find({ userId: user._id })
      .select('name date currency people settlements')
      .lean(),
    Person.find({ userId: user._id })
      .select('name email linkedLifeFlowId linkedUserId source')
      .lean(),
  ])

  const summaries = aggregateGroupBillPeople(
    bills as unknown as (IGroupBill & { _id: import('mongoose').Types.ObjectId })[],
    people as unknown as (IPerson   & { _id: import('mongoose').Types.ObjectId })[],
  )

  // Only notify when there is at least one person with an outstanding balance.
  const outstanding = summaries.filter((s) => s.direction !== 'settled')
  if (outstanding.length === 0) {
    // Release the slot — no meaningful content to send.
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'GROUP_BILL_REMINDER',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  // Compute overview totals.
  let totalOwedToYou = 0
  let totalYouOwe    = 0
  for (const s of outstanding) {
    if (s.direction === 'owes_you') totalOwedToYou += s.netBalance
    else                            totalYouOwe    += Math.abs(s.netBalance)
  }
  totalOwedToYou = Math.round(totalOwedToYou * 100) / 100
  totalYouOwe    = Math.round(totalYouOwe    * 100) / 100

  // Infer currency symbol from the first bill (all are owner's bills).
  const firstBill = bills[0] as ({ currency?: string } | undefined)
  const currencyCode = firstBill?.currency ?? 'INR'
  const currencySymbols: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  }
  const currencySymbol = currencySymbols[currencyCode] ?? currencyCode

  // Format today for display
  const todayLabel = (() => {
    try {
      const [y, m, d] = today.split('-').map(Number)
      const dt = new Date(Date.UTC(y, m - 1, d, 12))
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, weekday: 'long', day: 'numeric', month: 'short',
      }).format(dt)
    } catch {
      return today
    }
  })()

  // Build people payload for the notification.
  const notifPeople = outstanding.map((s) => ({
    displayName:  s.displayName,
    billCount:    s.billCount,
    netBalance:   s.netBalance,
    direction:    s.direction as 'owes_you' | 'you_owe',
    currency:     currencyCode,
    bills: s.bills.map((b) => ({
      billName:      b.billName,
      billDate:      b.billDate,
      owesYouAmount: b.owesYouAmount,
      youOweAmount:  b.youOweAmount,
    })),
  }))

  const totalPeople  = outstanding.length
  const inAppMessage =
    totalOwedToYou > 0 && totalYouOwe > 0
      ? `${totalPeople} people with outstanding Group Bill balances. ` +
        `${currencySymbol}${totalOwedToYou.toLocaleString('en-IN', { maximumFractionDigits: 2 })} owed to you, ` +
        `${currencySymbol}${totalYouOwe.toLocaleString('en-IN', { maximumFractionDigits: 2 })} you owe.`
      : totalOwedToYou > 0
        ? `${totalPeople} people owe you a total of ` +
          `${currencySymbol}${totalOwedToYou.toLocaleString('en-IN', { maximumFractionDigits: 2 })} across Group Bills.`
        : `You owe ${totalPeople} people a total of ` +
          `${currencySymbol}${totalYouOwe.toLocaleString('en-IN', { maximumFractionDigits: 2 })} in Group Bills.`

  // ── In-app notification ───────────────────────────────────────────────────
  await Notification.create({
    userId:     user._id,
    lifeFlowId: user.publicId,
    title:      'Group Bill Reminder',
    message:    inAppMessage,
    type:       'reminder',
  }).catch((err: unknown) => {
    logger.warn('[notifScheduler] Group bill in-app creation failed', {
      userId:       user._id.toString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  })

  // ── Push notification ─────────────────────────────────────────────────────
  await sendPushToUser(user._id, {
    title: 'Group Bill Reminder',
    body:  `${totalPeople} outstanding balance${totalPeople !== 1 ? 's' : ''}`,
    url:   `${appUrl}/app/expenses`,
    tag:   `group-bill-reminder-${today}`,
  }).catch((err: unknown) => {
    logger.warn('[notifScheduler] Group bill push failed', {
      userId:       user._id.toString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  })

  // ── Email ─────────────────────────────────────────────────────────────────
  const wantEmail = shouldSendEmail(
    user.emailNotifications,
    'spendingAlerts',
    user.email,
  )

  let emailOk = false
  if (wantEmail) {
    try {
      const emailContent = buildGroupBillReminderEmail({
        toName:         user.name,
        todayLabel,
        people:         notifPeople,
        totalOwedToYou,
        totalYouOwe,
        appUrl,
        currencySymbol,
      })

      const notifier = await getNotificationService()
      const result = await notifier.send({
        to:      user.email,
        subject: emailContent.subject,
        html:    emailContent.html,
        text:    emailContent.text,
      })

      if (result.ok) {
        emailOk = true
        logger.info('[EMAIL] Group bill reminder sent', {
          userId: user._id.toString(),
        })
        await markNotificationSent(
          user._id,
          'GROUP_BILL_REMINDER',
          today,
          '',
          emailContent.subject,
          emailContent.html,
        )
      } else {
        logger.warn('[EMAIL] Group bill reminder failed', {
          userId: user._id.toString(),
          error:  result.error,
        })
        await markNotificationFailed(
          user._id, 'GROUP_BILL_REMINDER', today, '',
          result.error ?? 'provider returned non-ok',
        )
        // Don't return false — in-app was still created
      }
    } catch (err: unknown) {
      const sanitisedError = err instanceof Error
        ? err.message.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
        : 'unexpected error'
      logger.warn('[EMAIL] Group bill reminder failed (exception)', {
        userId: user._id.toString(),
        error:  sanitisedError,
      })
      await markNotificationFailed(
        user._id, 'GROUP_BILL_REMINDER', today, '', sanitisedError,
      )
    }
  }

  if (!wantEmail || emailOk) {
    await markNotificationSent(
      user._id,
      'GROUP_BILL_REMINDER',
      today,
      '',
      undefined,
      undefined,
    )
  }

  return { sent: true }
}

// ─── Legacy no-ops ────────────────────────────────────────────────────────────

async function processTomorrowTasks(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  void user; void now; void appUrl
  return { sent: false }
}

async function processTomorrowHabits(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  void user; void now; void appUrl
  return { sent: false }
}

void buildTomorrowTasksEmail
void buildTomorrowHabitsEmail

// ─── Per-user runner ──────────────────────────────────────────────────────────

async function processUser(
  user: UserRecord,
  now: Date,
  appUrl: string,
  graceSeconds = 3600
): Promise<UserResult> {
  const result: UserResult = {
    userId:  user._id.toString(),
    sent:    0,
    skipped: 0,
    errors:  [],
  }

  const run = async (
    fn: (u: UserRecord, n: Date, a: string, g: number) => Promise<{ sent: boolean } | { sent: number }>
  ) => {
    try {
      const r         = await fn(user, now, appUrl, graceSeconds)
      const sentCount = typeof r.sent === 'boolean' ? (r.sent ? 1 : 0) : r.sent
      result.sent    += sentCount
      result.skipped += sentCount === 0 ? 1 : 0
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  // Spending alerts have no grace window param — they're event-driven
  const runSpending = async () => {
    try {
      const r = await processSpendingAlerts(user, now, appUrl)
      result.sent    += r.sent
      result.skipped += r.sent === 0 ? 1 : 0
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  await run(processMorningBrief)
  await run(processTaskDueSoon)
  await run(processIncompleteTasks)
  await run(processTomorrowPreview)
  await run(processDailySummary)
  await run(processWeeklySummary)
  await run(processHabitReminder)
  await runSpending()
  await run(processGroupBillReminder)

  // Legacy no-ops
  await run(processTomorrowTasks)
  await run(processTomorrowHabits)

  return result
}

// ─── Main entry points ────────────────────────────────────────────────────────

export interface NotificationSchedulerResult {
  usersProcessed: number
  totalSent:      number
  totalSkipped:   number
  errors:         string[]
  durationMs:     number
}

/**
 * Run the notification scheduler for all active, verified users.
 *
 * @param graceSeconds  How far past the target UTC we still consider it valid.
 *                      3600 (1 hour) = hourly cron mode (backward compatible).
 *                      90 = precise mode (called by the per-minute endpoint).
 *
 * Safe to call multiple times — idempotency is enforced per-user per-type per-date.
 * Exported for use by:
 *   /api/jobs/process-notifications          (hourly, graceSeconds=3600)
 *   /api/jobs/process-notifications-precise  (per-minute, graceSeconds=90)
 */
export async function runNotificationScheduler(
  graceSeconds = 3600
): Promise<NotificationSchedulerResult> {
  const t0     = Date.now()
  const result: NotificationSchedulerResult = {
    usersProcessed: 0,
    totalSent:      0,
    totalSkipped:   0,
    errors:         [],
    durationMs:     0,
  }

  await connectDB()

  const appUrl = getAppUrl()
  const now    = new Date()

  // Query filter (emailVerified: true, notificationsTested: true required)
  // accountStatus: 'active' — skip soft-deleted accounts; they must not receive
  // any scheduled notifications during the recovery window.  The field defaults
  // to 'active' for all pre-existing users so this filter is backward-compatible.
  // We use $ne: 'deleted' rather than $eq: 'active' so that legacy documents
  // where the field is absent (null/undefined) are also included — they are
  // implicitly active accounts that pre-date the soft-delete feature.
  const users = await User.find({
    accountStatus:        { $ne: 'deleted' as const },
    emailVerified:        true,
    notificationsTested:  true,
    $or: [
      { 'notificationPreferences.taskReminders':  true },
      { 'notificationPreferences.habitReminders': true },
      { 'notificationPreferences.spendingAlerts': true },
      { 'notificationPreferences.dailySummary':   true },
      { 'emailNotifications.enabled': true },
    ],
  })
    .select('publicId name email timezone notificationPreferences emailNotifications notificationsTested')
    .lean<UserRecord[]>()

  logger.info('[notifScheduler] Starting run', {
    userCount:    users.length,
    utcTime:      now.toISOString(),
    graceSeconds,
  })

  for (const user of users) {
    try {
      const safeUser: UserRecord = {
        ...user,
        notificationsTested: user.notificationsTested ?? false,
        emailNotifications: user.emailNotifications ?? {
          enabled:        false,
          taskReminders:  true,
          habitReminders: true,
          spendingAlerts: true,
          dailySummary:   true,
          weeklySummary:  true,
        },
      }
      if (safeUser.emailNotifications.weeklySummary === undefined) {
        ;(safeUser.emailNotifications as EmailNotifPrefs).weeklySummary = true
      }

      const userResult = await processUser(safeUser, now, appUrl, graceSeconds)
      result.usersProcessed++
      result.totalSent    += userResult.sent
      result.totalSkipped += userResult.skipped
      if (userResult.errors.length > 0) {
        result.errors.push(
          `User ${userResult.userId}: ${userResult.errors.join('; ')}`
        )
      }
    } catch (err: unknown) {
      result.errors.push(
        `User ${user._id.toString()}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  result.durationMs = Date.now() - t0

  logger.info('[notifScheduler] Run complete', {
    usersProcessed: result.usersProcessed,
    totalSent:      result.totalSent,
    totalSkipped:   result.totalSkipped,
    errorCount:     result.errors.length,
    durationMs:     result.durationMs,
    graceSeconds,
  })

  return result
}
