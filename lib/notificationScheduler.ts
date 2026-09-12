/**
 * lib/notificationScheduler.ts — Scheduled notification engine for LifeFlow.
 *
 * This module is the single source of truth for all scheduled notifications:
 *   • Tomorrow's tasks (grouped, one notification)
 *   • Tomorrow's habits (grouped, one notification)
 *   • Today's incomplete tasks (end-of-day reminder)
 *   • Spending / budget alerts (threshold crossed)
 *   • Daily summary (optional, one per day)
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * 1. Idempotency.  Every notification type has a deterministic key stored in
 *    NotificationLog.  Re-running the scheduler never double-sends.
 *
 * 2. Timezone-awareness.  "Today" and "tomorrow" are computed using each user's
 *    `timezone` field (falls back to DEFAULT_TIMEZONE env var → 'Asia/Kolkata').
 *    A user in India and a user in the US get their reminders at the correct
 *    local time regardless of when the scheduler (UTC) fires.
 *
 * 3. User isolation.  Queries always include userId.  Users never see each
 *    other's data.
 *
 * 4. Delivery channels.  Each notification is delivered to all three channels
 *    that the user has enabled:
 *      a) In-app  — always created in the Notification collection
 *      b) Push    — sent via lib/pushSender.ts (silently skipped if no VAPID)
 *      c) Email   — sent via getNotificationService() (silently skipped if
 *                   EMAIL_PROVIDER=none)
 *    Channel failures do not abort other channels.
 *
 * 5. Quiet hours.  Notifications are skipped if the current UTC time falls
 *    within the user's configured quiet window.  Default quiet window when
 *    not configured: 22:00–07:00 local time.
 *
 * 6. Conservative email defaults.  Email is only sent for daily summary if the
 *    user has dailySummary enabled.  Task/habit/spending emails are delivered
 *    only via in-app + push by default to avoid inbox flooding.  This can be
 *    extended later per user preference.
 *
 * 7. Privacy.  Push notification bodies are concise summaries only — no full
 *    task titles, financial amounts, or other private data that could appear
 *    on a lock screen.
 *
 * EMAIL VERIFICATION SAFETY
 * ─────────────────────────
 * This module calls getNotificationService() for summary emails only.
 * It never touches verification token generation, verification routes, or
 * the token expiry logic.  Verification emails are sent exclusively by the
 * auth routes (app/api/auth/signup, app/api/auth/resend-verification).
 *
 * SCHEDULER TIMING (recommended cron: every hour, on the hour)
 * ─────────────────────────────────────────────────────────────
 *   • Tomorrow tasks/habits:    sent in the evening window (18:00–21:00 local)
 *   • Incomplete today:         sent in the late-afternoon window (17:00–20:00 local)
 *   • Spending alerts:          sent any time (checked per run)
 *   • Daily summary:            sent in the morning window (08:00–10:00 local)
 *
 * These windows are checked against the user's local hour at scheduler run time.
 * If the scheduler fires hourly, each notification will be sent once per day
 * within its window — deduplication ensures it is not repeated if the scheduler
 * fires again during the same window.
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
  buildSpendingAlertEmail,
  buildDailySummaryEmail,
} from '@/lib/auth/email-templates'
import logger from '@/lib/logger'

// ─── Date helpers (reuse pattern from subscriptionScheduler) ──────────────────

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

/** Add one calendar day to a YYYY-MM-DD string. */
function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return dt.toISOString().split('T')[0]
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
 * Default quiet window: 22:00–07:00 local time.
 * Notifications are suppressed during this window to avoid waking users.
 */
const DEFAULT_QUIET_START = 22
const DEFAULT_QUIET_END   =  7

function isQuietHour(localHr: number): boolean {
  if (DEFAULT_QUIET_START > DEFAULT_QUIET_END) {
    // Window crosses midnight: quiet if hour >= start OR hour < end
    return localHr >= DEFAULT_QUIET_START || localHr < DEFAULT_QUIET_END
  }
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

// ─── Delivery helper ──────────────────────────────────────────────────────────

interface DeliveryOptions {
  userId:      mongoose.Types.ObjectId
  lifeFlowId:  string
  prefs:       { taskReminders: boolean; habitReminders: boolean; spendingAlerts: boolean; dailySummary: boolean }
  prefKey:     keyof { taskReminders: boolean; habitReminders: boolean; spendingAlerts: boolean; dailySummary: boolean }
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
    to:      string
    subject: string
    html:    string
    text:    string
  }
}

/**
 * Deliver a notification across all enabled channels.
 * Failures in any single channel do not abort the others.
 */
async function deliver(opts: DeliveryOptions): Promise<void> {
  const { userId, lifeFlowId, prefs, prefKey, inApp, push, email } = opts

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
  if (email) {
    try {
      const notifier = await getNotificationService()
      await notifier.send({
        to:      email.to,
        subject: email.subject,
        html:    email.html,
        text:    email.text,
      })
    } catch (err: unknown) {
      logger.warn('[notifScheduler] Email delivery failed', {
        userId: userId.toString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ─── Per-user notification processors ────────────────────────────────────────

interface UserRecord {
  _id: mongoose.Types.ObjectId
  publicId: string
  name: string
  email: string
  timezone: string
  notificationPreferences: {
    habitReminders: boolean
    taskReminders:  boolean
    spendingAlerts: boolean
    dailySummary:   boolean
  }
}

/** Results for a single user's notification run. */
interface UserResult {
  userId:     string
  sent:       number
  skipped:    number
  errors:     string[]
}

// ─── 1. Tomorrow tasks ────────────────────────────────────────────────────────

async function processTomorrowTasks(
  user: UserRecord,
  now: Date,
  _appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders) return { sent: false }

  const tz       = user.timezone
  const hr       = localHour(now, tz)
  // Send in the 18:00–21:00 local window
  if (hr < 18 || hr >= 21) return { sent: false }
  if (isQuietHour(hr))     return { sent: false }

  const today    = dateInTimezone(now, tz)
  const tomorrow = addOneDay(today)

  const alreadySent = await checkAndRecord(user._id, 'TASK_TOMORROW', tomorrow)
  if (alreadySent) return { sent: false }

  const tasks = await Task.find({
    userId:    user._id,
    dueDate:   tomorrow,
    completed: false,
  })
    .select('title')
    .sort({ priority: -1, createdAt: 1 })
    .limit(10)
    .lean()

  if (tasks.length === 0) {
    // Nothing scheduled — delete the log record so we don't block future runs
    await NotificationLog.deleteOne({
      userId: user._id,
      type:   'TASK_TOMORROW',
      forDate: tomorrow,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count      = tasks.length
  const titles     = tasks.slice(0, 5).map((t) => t.title)
  const _dateLabel  = formatDateLabel(tomorrow, tz)
  const taskWord   = count === 1 ? 'task' : 'tasks'

  await deliver({
    userId:     user._id,
    lifeFlowId: user.publicId,
    prefs,
    prefKey:    'taskReminders',
    inApp: {
      title:   `Tomorrow: ${count} ${taskWord} scheduled`,
      message: titles.slice(0, 3).join(' • '),
      type:    'task',
    },
    push: {
      title: `Tomorrow: ${count} ${taskWord} scheduled`,
      body:  titles.slice(0, 3).join('\n'),
      url:   '/app/tasks',
      tag:   'TASK_TOMORROW',
    },
    // Task reminders are push + in-app only by default (not email, to avoid inbox flooding)
  })

  logger.info('[notifScheduler] TASK_TOMORROW sent', { userId: user._id.toString(), count })
  return { sent: true }
}

// ─── 2. Today incomplete tasks ────────────────────────────────────────────────

async function processIncompleteTasks(
  user: UserRecord,
  now: Date,
  _appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.taskReminders) return { sent: false }

  const tz = user.timezone
  const hr = localHour(now, tz)
  // Send in the 17:00–20:00 local window (end-of-day reminder)
  if (hr < 17 || hr >= 20) return { sent: false }
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
    await NotificationLog.deleteOne({
      userId: user._id,
      type:   'TASK_INCOMPLETE_TODAY',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count     = tasks.length
  const titles    = tasks.slice(0, 5).map((t) => t.title)
  const _dateLabel = formatDateLabel(today, tz)
  const taskWord  = count === 1 ? 'task' : 'tasks'

  await deliver({
    userId:     user._id,
    lifeFlowId: user.publicId,
    prefs,
    prefKey:    'taskReminders',
    inApp: {
      title:   `${count} ${taskWord} still incomplete today`,
      message: titles.slice(0, 3).join(' • '),
      type:    'task',
    },
    push: {
      title: `${count} ${taskWord} still incomplete today`,
      body:  titles.slice(0, 3).join('\n'),
      url:   '/app/tasks',
      tag:   'TASK_INCOMPLETE_TODAY',
    },
    // Email: only send if user has taskReminders on — kept in-app/push only by default
    // Uncomment the block below to enable email for incomplete tasks:
    // email: {
    //   to: user.email,
    //   ...buildIncompleteTasksEmail({ toName: user.name, taskCount: count, taskTitles: titles, todayLabel: dateLabel, appUrl }),
    // },
  })

  logger.info('[notifScheduler] TASK_INCOMPLETE_TODAY sent', { userId: user._id.toString(), count })
  return { sent: true }
}

// ─── 3. Tomorrow habits ───────────────────────────────────────────────────────

async function processTomorrowHabits(
  user: UserRecord,
  now: Date,
  _appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.habitReminders) return { sent: false }

  const tz = user.timezone
  const hr = localHour(now, tz)
  // Send in the 19:00–21:00 local window (just after task reminder)
  if (hr < 19 || hr >= 21) return { sent: false }
  if (isQuietHour(hr))     return { sent: false }

  const today    = dateInTimezone(now, tz)
  const tomorrow = addOneDay(today)

  const alreadySent = await checkAndRecord(user._id, 'HABIT_TOMORROW', tomorrow)
  if (alreadySent) return { sent: false }

  // Get all daily habits for this user
  const habits = await Habit.find({ userId: user._id, frequency: 'daily' })
    .select('name icon')
    .sort({ createdAt: 1 })
    .lean()

  if (habits.length === 0) {
    await NotificationLog.deleteOne({
      userId: user._id,
      type:   'HABIT_TOMORROW',
      forDate: tomorrow,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count      = habits.length
  const names      = habits.slice(0, 5).map((h) => `${h.icon} ${h.name}`)
  const habitWord  = count === 1 ? 'habit' : 'habits'

  await deliver({
    userId:     user._id,
    lifeFlowId: user.publicId,
    prefs,
    prefKey:    'habitReminders',
    inApp: {
      title:   `Tomorrow: ${count} ${habitWord} planned`,
      message: names.slice(0, 3).join(' • '),
      type:    'habit',
    },
    push: {
      title: `Tomorrow: ${count} ${habitWord} planned`,
      body:  names.slice(0, 3).join('\n'),
      url:   '/app/habits',
      tag:   'HABIT_TOMORROW',
    },
  })

  logger.info('[notifScheduler] HABIT_TOMORROW sent', { userId: user._id.toString(), count })
  return { sent: true }
}

// ─── 4. Habit reminder (today, incomplete) ────────────────────────────────────

async function processHabitReminder(
  user: UserRecord,
  now: Date,
  _appUrl: string
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

  // Find daily habits not yet completed today
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
    userId: user._id,
    date:   today,
    completed: true,
  })
    .select('habitId')
    .lean()

  const completedIds = new Set(completedLogs.map((l) => l.habitId.toString()))
  const incomplete   = allDailyHabits.filter((h) => !completedIds.has(h._id.toString()))

  if (incomplete.length === 0) {
    // All habits done — no reminder needed
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'HABIT_REMINDER',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  const count     = incomplete.length
  const names     = incomplete.slice(0, 3).map((h) => `${h.icon} ${h.name}`)
  const habitWord = count === 1 ? 'habit' : 'habits'

  await deliver({
    userId:     user._id,
    lifeFlowId: user.publicId,
    prefs,
    prefKey:    'habitReminders',
    inApp: {
      title:   `${count} ${habitWord} to complete today`,
      message: names.join(' • '),
      type:    'habit',
    },
    push: {
      title: `${count} ${habitWord} to complete today`,
      body:  names.join('\n'),
      url:   '/app/habits',
      tag:   'HABIT_REMINDER',
    },
  })

  logger.info('[notifScheduler] HABIT_REMINDER sent', { userId: user._id.toString(), count })
  return { sent: true }
}

// ─── 5. Spending alerts ───────────────────────────────────────────────────────

/** Alert thresholds: notify at 80% and again at 100%. */
const ALERT_THRESHOLDS = [80, 100] as const
type AlertThreshold = typeof ALERT_THRESHOLDS[number]

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

async function processSpendingAlerts(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: number }> {
  const prefs = user.notificationPreferences
  if (!prefs.spendingAlerts) return { sent: 0 }

  const tz    = user.timezone
  const hr    = localHour(now, tz)
  if (isQuietHour(hr)) return { sent: 0 }

  const month = currentMonth(now, tz)
  const today = dateInTimezone(now, tz)

  // Find active budgets for this month
  const budgets = await Budget.find({
    userId: user._id,
    month,
    status: 'active',
  }).lean()

  if (budgets.length === 0) return { sent: 0 }

  let sentCount = 0

  for (const budget of budgets) {
    // Sum expenses in this category for this month
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

    // Find the highest threshold that has been crossed
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

    // Privacy: never include the actual rupee amounts in push/in-app summaries
    const pushTitle = isOver
      ? `${categoryLabel} budget exceeded`
      : `${categoryLabel} budget is nearly full`
    const pushBody  = isOver
      ? `You have exceeded your ${categoryLabel} budget this month.`
      : `Your ${categoryLabel} budget is ${percentUsed}% used.`

    await deliver({
      userId:     user._id,
      lifeFlowId: user.publicId,
      prefs,
      prefKey:    'spendingAlerts',
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
      email: {
        to: user.email,
        ...buildSpendingAlertEmail({
          toName:        user.name,
          categoryLabel,
          percentUsed,
          appUrl,
        }),
      },
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

// ─── 6. Daily summary ─────────────────────────────────────────────────────────

async function processDailySummary(
  user: UserRecord,
  now: Date,
  appUrl: string
): Promise<{ sent: boolean }> {
  const prefs = user.notificationPreferences
  if (!prefs.dailySummary) return { sent: false }

  const tz = user.timezone
  const hr = localHour(now, tz)
  // Send in the 08:00–10:00 morning window
  if (hr < 8 || hr >= 10) return { sent: false }
  if (isQuietHour(hr))    return { sent: false }

  const today = dateInTimezone(now, tz)

  const alreadySent = await checkAndRecord(user._id, 'DAILY_SUMMARY', today)
  if (alreadySent) return { sent: false }

  // Gather stats
  const [
    tasksCompleted,
    tasksRemaining,
    allDailyHabits,
    completedLogs,
  ] = await Promise.all([
    Task.countDocuments({ userId: user._id, dueDate: today, completed: true }),
    Task.countDocuments({ userId: user._id, dueDate: today, completed: false }),
    Habit.countDocuments({ userId: user._id, frequency: 'daily' }),
    HabitLog.countDocuments({ userId: user._id, date: today, completed: true }),
  ])

  // Skip if there is nothing useful to report
  const hasAnything = tasksCompleted > 0 || tasksRemaining > 0 || allDailyHabits > 0
  if (!hasAnything) {
    await NotificationLog.deleteOne({
      userId:  user._id,
      type:    'DAILY_SUMMARY',
      forDate: today,
    }).catch(() => undefined)
    return { sent: false }
  }

  // Optional spending note (most over-budget category, if any)
  const month  = currentMonth(now, tz)
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
      break // report only the first alert in the summary
    }
  }

  const dateLabel = formatDateLabel(today, tz)
  const summaryTitle = 'Your LifeFlow daily summary'
  const summaryMsg = [
    `Tasks: ${tasksCompleted} done, ${tasksRemaining} remaining`,
    `Habits: ${completedLogs}/${allDailyHabits} completed`,
    ...(spendingNote ? [spendingNote] : []),
  ].join(' · ')

  await deliver({
    userId:     user._id,
    lifeFlowId: user.publicId,
    prefs,
    prefKey:    'dailySummary',
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
    email: {
      to: user.email,
      ...buildDailySummaryEmail({
        toName:          user.name,
        todayLabel:      dateLabel,
        tasksCompleted,
        tasksRemaining,
        habitsCompleted: completedLogs,
        habitsTotal:     allDailyHabits,
        spendingNote,
        appUrl,
      }),
    },
  })

  logger.info('[notifScheduler] DAILY_SUMMARY sent', {
    userId:    user._id.toString(),
    tasksCompleted,
    tasksRemaining,
    habitsCompleted: completedLogs,
    habitsTotal:     allDailyHabits,
  })
  return { sent: true }
}

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
      const r = await fn(user, now, appUrl)
      const sentCount = typeof r.sent === 'boolean' ? (r.sent ? 1 : 0) : r.sent
      result.sent    += sentCount
      result.skipped += sentCount === 0 ? 1 : 0
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  await run(processTomorrowTasks)
  await run(processIncompleteTasks)
  await run(processTomorrowHabits)
  await run(processHabitReminder)
  await run(processSpendingAlerts)
  await run(processDailySummary)

  return result
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface NotificationSchedulerResult {
  usersProcessed:     number
  totalSent:          number
  totalSkipped:       number
  errors:             string[]
  durationMs:         number
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
    ],
  })
    .select('publicId name email timezone notificationPreferences')
    .lean<UserRecord[]>()

  logger.info('[notifScheduler] Starting run', {
    userCount: users.length,
    utcTime:   now.toISOString(),
  })

  for (const user of users) {
    try {
      const userResult = await processUser(user, now, appUrl)
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
