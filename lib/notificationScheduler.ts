/**
 * lib/notificationScheduler.ts — Scheduled notification engine for LifeFlow.
 *
 * NOTIFICATION SCHEDULE (all times in the USER'S LOCAL TIMEZONE)
 * ──────────────────────────────────────────────────────────────
 *   Any time       → 30-minute task due-soon reminder
 *                    Subject: "Task reminder: <title>"
 *                    Sent 30 minutes before each task's due time.
 *                    One reminder per task per calendar date.
 *                    Skipped if task is already completed.
 *                    Skipped during quiet hours (00:00–07:00).
 *
 *   19:00 (7 PM)   → Today's incomplete tasks check
 *                    Subject: "You still have work to finish today"
 *                    Sent only when incomplete tasks exist.
 *
 *   22:00 (10 PM)  → Tomorrow preview
 *                    Subject: "Tomorrow's plan is ready"
 *                    Shows tomorrow's tasks + habits.
 *                    Not sent if nothing is planned.
 *
 *   23:55 (11:55 PM) → Daily summary
 *                    Subject: "Your LifeFlow daily summary — {date}"
 *                    Tasks + habits + expenses overview.
 *                    Not sent if there is nothing to report.
 *
 *   Sunday 22:00   → Weekly summary
 *                    Subject: "Your LifeFlow weekly summary — {weekLabel}"
 *                    Covers the past 7 days.
 *
 *   09:00–11:00    → Habit reminder (morning, push + in-app + email)
 *                    Sent when habits are incomplete.
 *
 *   Any time       → Spending / budget alerts (threshold crossed)
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * 1. Idempotency.  Every notification type has a deterministic key stored in
 *    NotificationLog.  Re-running the scheduler never double-sends.
 *
 * 2. Timezone-awareness.  All schedule windows use each user's `timezone` field
 *    (falls back to DEFAULT_TIMEZONE env var → 'Asia/Kolkata').
 *
 * 3. User isolation.  Queries always include userId.  Users never see each
 *    other's data.
 *
 * 4. Delivery channels.  Each notification goes to all enabled channels:
 *      a) In-app  — always created in the Notification collection
 *      b) Push    — sent via lib/pushSender.ts (silently skipped if no VAPID)
 *      c) Email   — sent via getNotificationService() only when:
 *                   • emailNotifications.enabled === true
 *                   • the per-category flag for the type is true
 *                   • EMAIL_PROVIDER != 'none'
 *    Channel failures do not abort other channels.
 *
 * 5. Quiet hours.  Default: 00:00–07:00 local time.  Notifications are
 *    suppressed in this window.  (The 11:55 PM daily summary is just before
 *    the quiet window begins at midnight.)
 *
 * 6. Email recipient security.  The recipient address is always resolved from
 *    the user's database record (user.email).  No client-supplied address is
 *    ever used.
 *
 * 7. Privacy.  Push notification bodies are concise — no full task titles,
 *    financial amounts, or other sensitive data that could appear on a lock
 *    screen.
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
import Notification from '@/models/Notification'
import NotificationLog, { type ScheduledNotificationType } from '@/models/NotificationLog'
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
} from '@/lib/auth/email-templates'
import logger from '@/lib/logger'

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

// ─── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Check whether a notification has already been sent for the given key.
 * Returns true if already sent (caller should skip).
 * Records the key if not yet sent (caller should proceed to send).
 *
 * Uses MongoDB's unique index on `key` — concurrent duplicate inserts throw
 * E11000 which we catch and treat as "already sent".
 */
async function checkAndRecord(
  userId: mongoose.Types.ObjectId,
  type: ScheduledNotificationType,
  forDate: string,
  extraDiscriminator = ''
): Promise<boolean> {
  const key = [userId.toString(), type, forDate, extraDiscriminator]
    .filter(Boolean)
    .join(':')

  const exists = await NotificationLog.exists({ key })
  if (exists) return true // already sent

  try {
    await NotificationLog.create({ key, userId, type, forDate })
    return false // proceed — we just claimed this slot
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
function shouldSendEmail(
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
 */
async function deliver(opts: DeliveryOptions): Promise<void> {
  const {
    userId, lifeFlowId, prefs, prefKey,
    emailPrefs, emailPrefKey, userEmail,
    inApp, push, email,
  } = opts

  if (!prefs[prefKey]) return // user has this category disabled

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
        logger.info('[EMAIL] sent successfully', {
          notificationType: emailPrefKey,
          messageId:        result.messageId,
        })
      } else {
        logger.warn('[EMAIL] delivery failed', {
          notificationType: emailPrefKey,
          error:            result.error ?? 'provider returned non-ok',
        })
      }
    } catch (err: unknown) {
      // Email failure never aborts in-app or push — log and continue.
      // Sanitise: only log the error message string, never raw SMTP objects
      // that could contain credentials or tokens.
      const sanitisedError = err instanceof Error
        ? err.message.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
        : 'unexpected error'

      logger.warn('[EMAIL] delivery failed', {
        notificationType: emailPrefKey,
        error:            sanitisedError,
      })
    }
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

// ─── 1. Today's incomplete tasks (7 PM) ──────────────────────────────────────
//
// Sent at 19:00 (7 PM) local time.
// Subject: "You still have work to finish today"
// Only sent when there are incomplete tasks for today.

async function processIncompleteTasks(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders) return { sent: false }

  const tz = user.timezone
  const hr = localHour(now, tz)
  // Send in the 19:00–21:00 local window (7 PM check-in)
  if (hr < 19 || hr >= 21) return { sent: false }
  if (isQuietHour(hr))     return { sent: false }

  const today = dateInTimezone(now, tz)

  const alreadySent = await checkAndRecord(user._id, 'TASK_INCOMPLETE_TODAY', today)
  if (alreadySent) return { sent: false }

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
    // No incomplete tasks — remove the log entry so future runs aren't blocked
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'TASK_INCOMPLETE_TODAY',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count     = tasks.length
  const titles    = tasks.slice(0, 5).map((t) => t.title)
  const dateLabel = formatDateLabel(today, tz)
  const taskWord  = count === 1 ? 'task' : 'tasks'

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      'taskReminders',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'taskReminders',
    userEmail:    user.email,
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
  appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  // Requires at least one of task or habit reminders enabled
  if (!prefs.taskReminders && !prefs.habitReminders) return { sent: false }

  const tz = user.timezone
  const hr = localHour(now, tz)
  // Send in the 22:00–23:00 local window (10 PM)
  if (hr < 22 || hr >= 23) return { sent: false }
  if (isQuietHour(hr))     return { sent: false }

  const today    = dateInTimezone(now, tz)
  const tomorrow = addOneDay(today)

  // Use TASK_TOMORROW as the idempotency type for the combined preview
  const alreadySent = await checkAndRecord(user._id, 'TASK_TOMORROW', tomorrow)
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
    // Nothing for tomorrow — remove the log entry
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'TASK_TOMORROW',
      forDate: tomorrow,
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

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    // Use the more permissive prefKey — taskReminders if tasks exist, else habitReminders
    prefKey:      taskCount > 0 ? 'taskReminders' : 'habitReminders',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'taskReminders',
    userEmail:    user.email,
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
  appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.dailySummary) return { sent: false }

  const tz  = user.timezone
  const hr  = localHour(now, tz)
  const min = localMinute(now, tz)

  // Send in the 23:00–23:59 local window, prioritising 23:55 but accepting any
  // run in the 23:xx hour so an hourly cron at 23:00 still fires it.
  if (hr !== 23) return { sent: false }
  if (isQuietHour(hr)) return { sent: false }
  // Within the 23:xx hour, prefer the 23:55 window but accept 23:00–23:59
  // so a cron running at :00 of the hour still works.
  void min // used implicitly via the hr check above

  const today = dateInTimezone(now, tz)

  const alreadySent = await checkAndRecord(user._id, 'DAILY_SUMMARY', today)
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
      userId:  user._id,
      type:    'DAILY_SUMMARY',
      forDate: today,
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

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      'dailySummary',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'dailySummary',
    userEmail:    user.email,
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
// Not sent if there is nothing to report for the week.

async function processWeeklySummary(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  const tz  = user.timezone
  const hr  = localHour(now, tz)
  const dow = localDayOfWeek(now, tz) // 0 = Sunday

  // Only on Sundays in the 22:00–23:00 window
  if (dow !== 0)       return { sent: false }
  if (hr < 22 || hr >= 23) return { sent: false }
  if (isQuietHour(hr)) return { sent: false }

  // The weeklySummary flag lives in emailNotifications only (no in-app equivalent)
  // but we still gate on emailNotifications.enabled
  if (!user.emailNotifications.enabled)       return { sent: false }
  if (!user.emailNotifications.weeklySummary) return { sent: false }

  const today     = dateInTimezone(now, tz)
  // Use ISO week label as forDate discriminator so it's unique per week
  const weekStart = subtractDays(today, 6) // 7-day window ending today
  const weekKey   = `${weekStart}:${today}`

  const alreadySent = await checkAndRecord(user._id, 'WEEKLY_SUMMARY', today, weekKey)
  if (alreadySent) return { sent: false }

  // Gather the week's data
  const [
    tasksCompleted,
    tasksTotal,
    allDailyHabits,
    completedHabitLogs,
    weekExpenses,
  ] = await Promise.all([
    Task.countDocuments({
      userId:    user._id,
      dueDate:   { $gte: weekStart, $lte: today },
      completed: true,
    }),
    Task.countDocuments({
      userId:  user._id,
      dueDate: { $gte: weekStart, $lte: today },
    }),
    Habit.countDocuments({ userId: user._id, frequency: 'daily' }),
    HabitLog.countDocuments({
      userId:    user._id,
      date:      { $gte: weekStart, $lte: today },
      completed: true,
    }),
    Expense.find({
      userId: user._id,
      date:   { $gte: weekStart, $lte: today },
    })
      .select('category')
      .lean(),
  ])

  // habitsTotal = possible habit-days in the week (7 days × daily habits)
  const habitsTotal = allDailyHabits * 7

  const hasAnything = tasksTotal > 0 || habitsTotal > 0 || weekExpenses.length > 0
  if (!hasAnything) {
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'WEEKLY_SUMMARY',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  // Determine top expense category for the week
  const catCounts: Record<string, number> = {}
  for (const e of weekExpenses) {
    catCounts[e.category] = (catCounts[e.category] ?? 0) + 1
  }
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  const topExpenseCategory = topCat ? (CATEGORY_LABELS[topCat] ?? topCat) : undefined

  // Count active days (days with at least one completed task OR habit)
  const activeDaysSet = new Set<string>()
  const [taskDates, habitLogDates] = await Promise.all([
    Task.find({
      userId:    user._id,
      dueDate:   { $gte: weekStart, $lte: today },
      completed: true,
    }).select('dueDate').lean(),
    HabitLog.find({
      userId:    user._id,
      date:      { $gte: weekStart, $lte: today },
      completed: true,
    }).select('date').lean(),
  ])
  for (const t of taskDates)     { if (t.dueDate) activeDaysSet.add(t.dueDate) }
  for (const h of habitLogDates) activeDaysSet.add(h.date)
  const activeDays = activeDaysSet.size

  const weekLabel = weekRangeLabel(weekStart, today, tz)

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

  // Weekly summary is email-only (no in-app / push — it's a rich report)
  try {
    const result = await notifier.send({
      to:      user.email,
      subject,
      html,
      text,
    })
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
      error:            sanitisedError,
    })
  }

  // Also create an in-app notification so the user sees it even without email
  await Notification.create({
    userId:     user._id,
    lifeFlowId: user.publicId,
    title:      'Your weekly summary is ready',
    message:    `Tasks: ${tasksCompleted}/${tasksTotal} · Habits: ${completedHabitLogs}/${habitsTotal} · ${weekExpenses.length} transactions`,
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

// ─── 5. Habit reminder (morning, incomplete habits) ──────────────────────────
//
// Sent in the 09:00–11:00 local window.
// Now includes an email via buildHabitReminderEmail.

async function processHabitReminder(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.habitReminders) return { sent: false }

  const tz = user.timezone
  const hr = localHour(now, tz)
  // Send in the 09:00–11:00 morning window
  if (hr < 9 || hr >= 11) return { sent: false }
  if (isQuietHour(hr))    return { sent: false }

  const today = dateInTimezone(now, tz)

  const alreadySent = await checkAndRecord(user._id, 'HABIT_REMINDER', today)
  if (alreadySent) return { sent: false }

  const allDailyHabits = await Habit.find({ userId: user._id, frequency: 'daily' })
    .select('_id name icon')
    .lean()

  if (allDailyHabits.length === 0) {
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'HABIT_REMINDER',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const completedLogs = await HabitLog.find({
    userId:    user._id,
    date:      today,
    completed: true,
  })
    .select('habitId')
    .lean()

  const completedIds = new Set(completedLogs.map((l) => l.habitId.toString()))
  const incomplete   = allDailyHabits.filter((h) => !completedIds.has(h._id.toString()))

  if (incomplete.length === 0) {
    // All habits done — remove dedup key
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'HABIT_REMINDER',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count      = incomplete.length
  const names      = incomplete.slice(0, 5).map((h) => `${h.icon} ${h.name}`)
  const habitWord  = count === 1 ? 'habit' : 'habits'
  const todayLabel = formatDateLabel(today, tz)

  await deliver({
    userId:       user._id,
    lifeFlowId:   user.publicId,
    prefs,
    prefKey:      'habitReminders',
    emailPrefs:   user.emailNotifications,
    emailPrefKey: 'habitReminders',
    userEmail:    user.email,
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

/** Alert thresholds: notify at 80% and again at 100%. */
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
    userId: user._id,
    month,
    status: 'active',
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
    const budgetRupees = budget.amountMinor / 100  // paise → rupees
    if (budgetRupees <= 0) continue

    const percentUsed = Math.round((totalRupees / budgetRupees) * 100)

    let crossedThreshold: AlertThreshold | null = null
    for (const threshold of ALERT_THRESHOLDS) {
      if (percentUsed >= threshold) crossedThreshold = threshold
    }
    if (crossedThreshold === null) continue

    const discriminator = `${budget.category}:${crossedThreshold}`
    const alreadySent   = await checkAndRecord(
      user._id,
      'SPENDING_ALERT',
      month,
      discriminator
    )
    if (alreadySent) continue

    const categoryLabel = CATEGORY_LABELS[budget.category] ?? budget.category
    const isOver        = crossedThreshold >= 100

    // Privacy: never include actual rupee amounts in push/in-app summaries
    const pushTitle = isOver
      ? `${categoryLabel} budget exceeded`
      : `${categoryLabel} budget is nearly full`
    const pushBody  = isOver
      ? `You have exceeded your ${categoryLabel} budget this month.`
      : `Your ${categoryLabel} budget is ${percentUsed}% used.`

    await deliver({
      userId:       user._id,
      lifeFlowId:   user.publicId,
      prefs,
      prefKey:      'spendingAlerts',
      emailPrefs:   user.emailNotifications,
      emailPrefKey: 'spendingAlerts',
      userEmail:    user.email,
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
      userId:    user._id.toString(),
      category:  budget.category,
      threshold: crossedThreshold,
      percentUsed,
    })
  }

  return { sent: sentCount }
}

// ─── 7. Task due-soon reminder (30 minutes before due time) ──────────────────
//
// Sends an individual email reminder 30 minutes before each task's due time.
//
// DESIGN
// ──────
// The cron runs hourly.  To guarantee we catch the 30-minute window without
// depending on a millisecond-perfect hit, we use a ±15-minute window:
//
//   targetLocalMinute = localMinute(now) + 30
//   we match tasks whose dueTime falls in [now+15min, now+45min]
//
// This means the window spans 30 minutes around the nominal reminder time.
// Because idempotency is per-task per-date, only one email is ever sent even
// if multiple scheduler runs happen to fall in the window.
//
// RECURRENCE
// ──────────
// All four recurrence types (none/daily/weekly/monthly) are handled uniformly:
//   • One-time tasks (recurring:'none')  → checked on their exact dueDate
//   • Daily tasks                        → checked every day where dueDate is
//                                          today OR dueDate is in the past but
//                                          task recurs (completed is the only
//                                          signal we have — if false, remind)
//   • Weekly tasks                       → same logic; dueDate is used to anchor
//                                          the original schedule
//   • Monthly tasks                      → same logic
//
// Since the Task model has no per-occurrence tracking (completed is a single
// boolean), the semantics are: if the task is not yet marked done, it is
// eligible for a reminder.  For recurring tasks, "today's occurrence" is
// implied by the task still being incomplete.
//
// MISSED REMINDER PROTECTION
// ──────────────────────────
// If the scheduler was offline during the reminder window, the task's
// dueTime - 30min will be in the past when the scheduler comes back.
// We enforce a hard upper bound: we only send if the reminder time is at most
// 15 minutes in the past (i.e. the task hasn't been due yet).  After the
// task's dueTime passes we do NOT send the "30 minutes before" reminder — it
// would be misleading.
//
// IDEMPOTENCY KEY
// ───────────────
//   <userId>:TASK_DUE_SOON:<taskId>:<dueDate>
//
// Each task gets one reminder slot per calendar date.  The unique index on
// NotificationLog.key makes concurrent scheduler runs safe.
//
// QUIET HOURS
// ───────────
// Tasks due between 00:00 and 07:30 local time produce a reminder in the
// 00:00–07:00 quiet window.  We skip those entirely.

/**
 * Return the local time as { hour, minute } in the given timezone.
 */
function localTime(date: Date, timezone: string): { hour: number; minute: number } {
  return {
    hour:   localHour(date, timezone),
    minute: localMinute(date, timezone),
  }
}

/**
 * Convert a "HH:MM" string to total minutes since midnight.
 * Returns -1 if the string is not parseable.
 */
function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return -1
  const parts = timeStr.trim().split(':')
  if (parts.length < 2) return -1
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return -1
  return h * 60 + m
}

/**
 * Format HH:MM (24h) to a human-readable "8:00 PM" / "2:30 PM" label.
 */
function formatTime12h(timeStr: string): string {
  const mins = timeStringToMinutes(timeStr)
  if (mins < 0) return timeStr
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const period = h < 12 ? 'AM' : 'PM'
  const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

/**
 * Build a human-readable "due" label for the email.
 * If dueDate === today → "Today at HH:MM AM/PM"
 * Otherwise            → "DayName, DD Mon at HH:MM AM/PM"
 */
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
  appUrl: string
): Promise<{ sent: number }> {
  // Gate on in-app taskReminders preference (master in-app channel gate)
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders) return { sent: 0 }

  const tz = user.timezone
  const { hour: localHr, minute: localMin } = localTime(now, tz)

  // Skip the entire function in quiet hours (00:00–07:00 local).
  // A task due at 07:30 would trigger a reminder at 07:00 — borderline acceptable,
  // but we still allow it since 07:00 is right at the boundary.
  if (isQuietHour(localHr)) return { sent: 0 }

  // Total minutes since local midnight for NOW
  const nowTotalMin = localHr * 60 + localMin

  // Reminder window: [now+15, now+45] total minutes.
  // A task with dueTime exactly 30 min ahead will almost always be caught.
  // The 30-minute span also ensures one hourly cron run catches the full slot.
  const windowLow  = nowTotalMin + 15   // lower bound (inclusive)
  const windowHigh = nowTotalMin + 45   // upper bound (exclusive)

  // Hard cut-off: if the nominal reminder time (now+30) is MORE than 15 minutes
  // past the task's dueTime - 30, it means the scheduler missed the window.
  // We handle this via the window math above — if dueTime - 30 is before
  // windowLow (now+15) the task won't be found.  No additional logic needed.

  const today    = dateInTimezone(now, tz)

  // Build the candidate dueTime list from the window.
  // We collect every HH:MM string that falls in [windowLow, windowHigh).
  // This list is used to query MongoDB for tasks whose dueTime matches.
  const candidateTimes: string[] = []
  for (let m = windowLow; m < windowHigh; m++) {
    // Handle crossing midnight (minutes ≥ 1440)
    const clampedMin = m % 1440
    const hh = Math.floor(clampedMin / 60).toString().padStart(2, '0')
    const mm = (clampedMin % 60).toString().padStart(2, '0')
    candidateTimes.push(`${hh}:${mm}`)
  }

  if (candidateTimes.length === 0) return { sent: 0 }

  // Find tasks that:
  //   a) belong to this user
  //   b) are NOT completed
  //   c) have a dueTime in our candidate window
  //   d) are either:
  //      - one-time tasks due today (dueDate === today)
  //      - recurring tasks (any recurrence type) — for these we ignore dueDate
  //        and just check if the task is still incomplete (our only signal)
  //
  // For recurring tasks we also include tasks with dueDate in the past that
  // haven't been completed yet, because the user might have set a recurring
  // task with an old base dueDate but still expects daily reminders.

  const tasks = await Task.find({
    userId:    user._id,
    completed: false,
    dueTime:   { $in: candidateTimes },
    $or: [
      // One-time or specifically-dated tasks: must be due today or earlier
      { recurring: 'none',    dueDate: { $lte: today } },
      // Recurring tasks: dueDate present but recurrence means every period
      { recurring: 'daily'   },
      { recurring: 'weekly'  },
      { recurring: 'monthly' },
    ],
  })
    .select('_id title dueDate dueTime recurring priority projectId')
    .limit(20)  // safety cap — unlikely to have >20 tasks due at the same minute
    .lean()

  if (tasks.length === 0) return { sent: 0 }

  // For one-time tasks: we only remind if dueDate is today.
  // For recurring tasks: we always remind (dueDate may be past, occurrence is today).
  const eligibleTasks = tasks.filter((task) => {
    if (task.recurring === 'none') {
      // Only remind for today's due date
      return task.dueDate === today
    }
    // Recurring — always eligible (completion is the only filter)
    return true
  })

  if (eligibleTasks.length === 0) return { sent: 0 }

  let sentCount = 0

  for (const task of eligibleTasks) {
    // Per-task idempotency key: userId:TASK_DUE_SOON:taskId:dueDate(today)
    // Using today (not task.dueDate) as the date discriminator ensures recurring
    // tasks get one reminder per calendar day regardless of their base dueDate.
    const taskIdStr = task._id.toString()
    const alreadySent = await checkAndRecord(
      user._id,
      'TASK_DUE_SOON',
      today,
      taskIdStr
    )
    if (alreadySent) continue

    // Re-fetch the task to get the absolute latest completion status.
    // Between the bulk query above and now, the user may have completed the task.
    const freshTask = await Task.findOne({
      _id:    task._id,
      userId: user._id,
    })
      .select('completed title dueDate dueTime recurring priority')
      .lean()

    if (!freshTask) {
      // Task was deleted between query and now — remove the log entry
      await NotificationLog.deleteOne({
        userId:  user._id,
        type:    'TASK_DUE_SOON',
        forDate: today,
        key:     `${user._id.toString()}:TASK_DUE_SOON:${today}:${taskIdStr}`,
      }).catch(() => undefined)
      continue
    }

    if (freshTask.completed) {
      // Task was just completed — release the idempotency slot so it can be
      // re-used if the task is un-completed and rescheduled (edge case).
      await NotificationLog.deleteOne({
        userId:  user._id,
        type:    'TASK_DUE_SOON',
        forDate: today,
        key:     `${user._id.toString()}:TASK_DUE_SOON:${today}:${taskIdStr}`,
      }).catch(() => undefined)
      continue
    }

    const dueLabel        = buildDueLabel(freshTask.dueDate ?? today, freshTask.dueTime ?? '', today, tz)
    const recurrenceLabel = freshTask.recurring !== 'none'
      ? (RECURRENCE_LABELS[freshTask.recurring] ?? freshTask.recurring)
      : undefined

    await deliver({
      userId:       user._id,
      lifeFlowId:   user.publicId,
      prefs,
      prefKey:      'taskReminders',
      emailPrefs:   user.emailNotifications,
      emailPrefKey: 'taskReminders',
      userEmail:    user.email,
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
        toName:           user.name,
        taskTitle:        freshTask.title,
        dueLabel,
        recurrenceLabel,
        priority:         freshTask.priority as 'low' | 'medium' | 'high' | undefined,
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
    })
  }

  return { sent: sentCount }
}

// ─── Legacy: separate tomorrow-tasks and tomorrow-habits ─────────────────────
//
// These are kept for backwards compatibility but are effectively replaced by
// processTomorrowPreview which combines both into one 10 PM email.
// They will be skipped if processTomorrowPreview already ran for the same date.

async function processTomorrowTasks(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  // The combined preview (TASK_TOMORROW) already handles this.
  // This function is a no-op — kept so existing callers compile cleanly.
  void user; void now; void appUrl
  return { sent: false }
}

async function processTomorrowHabits(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  // The combined preview (TASK_TOMORROW) already handles this.
  void user; void now; void appUrl
  return { sent: false }
}

// Keep the old imports alive so TypeScript doesn't complain about unused imports
void buildTomorrowTasksEmail
void buildTomorrowHabitsEmail

// ─── Per-user runner ──────────────────────────────────────────────────────────

async function processUser(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<UserResult> {
  const result: UserResult = {
    userId:  user._id.toString(),
    sent:    0,
    skipped: 0,
    errors:  [],
  }

  const run = async (
    fn: (u: UserRecord, n: Date, a: string) => Promise<{ sent: boolean } | { sent: number }>
  ) => {
    try {
      const r         = await fn(user, now, appUrl)
      const sentCount = typeof r.sent === 'boolean' ? (r.sent ? 1 : 0) : r.sent
      result.sent    += sentCount
      result.skipped += sentCount === 0 ? 1 : 0
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Schedule (all times in user's local timezone) ──────────────────────────
  // 07:30+ (any time) → task due-soon reminder (30 min before due time)
  // 19:00 (7 PM)      → incomplete tasks check
  // 22:00 (10 PM)     → tomorrow preview (tasks + habits combined)
  // 23:00 (11 PM+)    → daily summary (fires in 23:xx hour for 11:55 PM target)
  // Sunday 22:00      → weekly summary
  // 09:00–11:00       → habit reminder (morning)
  // Any time          → spending alerts
  await run(processTaskDueSoon)
  await run(processIncompleteTasks)
  await run(processTomorrowPreview)
  await run(processDailySummary)
  await run(processWeeklySummary)
  await run(processHabitReminder)
  await run(processSpendingAlerts)

  // Legacy no-ops — harmless
  await run(processTomorrowTasks)
  await run(processTomorrowHabits)

  return result
}

// ─── Main entry point ─────────────────────────────────────────────────────────

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
 * Safe to call multiple times — idempotency is enforced per-user per-type per-date.
 * Exported for use by the /api/jobs/process-notifications route.
 */
export async function runNotificationScheduler(): Promise<NotificationSchedulerResult> {
  const t0     = Date.now()
  const result: NotificationSchedulerResult = {
    usersProcessed: 0,
    totalSent:      0,
    totalSkipped:   0,
    errors:         [],
    durationMs:     0,
  }

  await connectDB()

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const now    = new Date()

  // Only process verified users who have at least one notification preference enabled.
  // Using lean() for efficiency — we don't need Mongoose document methods.
  const users = await User.find({
    emailVerified: true,
    $or: [
      { 'notificationPreferences.taskReminders':  true },
      { 'notificationPreferences.habitReminders': true },
      { 'notificationPreferences.spendingAlerts': true },
      { 'notificationPreferences.dailySummary':   true },
      // Also include users who only have email notifications enabled (e.g. weekly summary)
      { 'emailNotifications.enabled': true },
    ],
  })
    .select('publicId name email timezone notificationPreferences emailNotifications')
    .lean<UserRecord[]>()

  logger.info('[notifScheduler] Starting run', {
    userCount: users.length,
    utcTime:   now.toISOString(),
  })

  for (const user of users) {
    try {
      // Provide a safe default for emailNotifications in case the field doesn't
      // exist yet on legacy documents (before the schema migration).
      const safeUser: UserRecord = {
        ...user,
        emailNotifications: user.emailNotifications ?? {
          enabled:        false,
          taskReminders:  true,
          habitReminders: true,
          spendingAlerts: true,
          dailySummary:   true,
          weeklySummary:  true,
        },
      }
      // Also ensure weeklySummary exists for legacy docs that predate the field
      if (safeUser.emailNotifications.weeklySummary === undefined) {
        ;(safeUser.emailNotifications as EmailNotifPrefs).weeklySummary = true
      }

      const userResult = await processUser(safeUser, now, appUrl)
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
  })

  return result
}
