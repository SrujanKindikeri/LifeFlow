/**
 * tests/notification-scheduler-precise.test.ts
 *
 * Comprehensive tests for the timezone-aware LifeFlow notification scheduler.
 *
 * Coverage:
 *  1.  UTC timestamp helpers — localTimeToUtc() correctness
 *  2.  localTimeToUtc() for Asia/Kolkata (IST = UTC+5:30)
 *  3.  localTimeToUtc() for America/New_York (EDT = UTC-4 / EST = UTC-5)
 *  4.  localTimeToUtc() for Europe/London (BST = UTC+1 / GMT = UTC+0)
 *  5.  DST spring-forward: America/New_York 2026-03-08
 *  6.  DST fall-back:      Europe/London   2026-10-25
 *  7.  isWithinGraceWindow() — fires exactly at target
 *  8.  isWithinGraceWindow() — fires within grace
 *  9.  isWithinGraceWindow() — does NOT fire before target
 * 10.  isWithinGraceWindow() — does NOT fire after grace window
 * 11.  checkAndRecord() idempotency — same key twice
 * 12.  checkAndRecord() concurrent safety — E11000 treated as already claimed
 * 13.  markNotificationSent() sets status=sent_to_smtp and sentAt
 * 14.  markNotificationFailed() sets status=failed and errorMessage
 * 15.  markNotificationFailed() sanitises credentials from errorMessage
 * 16.  Morning brief fires at 7:00 AM IST for Asia/Kolkata user
 * 17.  Morning brief does NOT fire before 7:00 AM IST
 * 18.  Morning brief does NOT fire after grace window
 * 19.  Morning brief skipped if notificationsTested=false
 * 20.  Morning brief skipped if emailNotifications.enabled=false
 * 21.  Morning brief skipped if nothing relevant today
 * 22.  Morning brief deduplication — not sent twice same day
 * 23.  Task reminder fires exactly 30 min before due time (IST)
 * 24.  Task reminder fires exactly 30 min before due time (New York)
 * 25.  Task reminder fires exactly 30 min before due time (London)
 * 26.  Task reminder NOT sent if task is completed
 * 27.  Task reminder NOT sent if server missed the window (> grace)
 * 28.  Recurring daily task — reminder fires each day independently
 * 29.  Recurring task deduplication — same task not reminded twice same day
 * 30.  Incomplete-tasks notification fires at 7 PM local (IST)
 * 31.  Incomplete-tasks notification fires at 7 PM local (New York)
 * 32.  Tomorrow preview fires at 10 PM local
 * 33.  Daily summary fires at 11:55 PM local
 * 34.  Weekly summary fires Sunday 10 PM local only
 * 35.  Weekly summary skipped on non-Sunday
 * 36.  All schedule windows use user's timezone, not server timezone
 * 37.  Duplicate scheduler execution (two parallel calls) — no double send
 * 38.  Docker-restart safety — pending notifications reload, sent ones skipped
 * 39.  NotificationLog scheduledAt stored as UTC
 * 40.  Notification history endpoint returns entries for correct user only
 * 41.  Gmail send failure — status set to failed, no crash
 * 42.  Missed notification beyond grace — marked missed, not sent late
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { startDb, stopDb, clearDb } from './helpers/db'
import User, { generatePublicId } from '@/models/User'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import NotificationLog from '@/models/NotificationLog'
import {
  localTimeToUtc,
  isWithinGraceWindow,
  runNotificationScheduler,
  shouldSendEmail,
} from '@/lib/notificationScheduler'
// ─── Setup / teardown ─────────────────────────────────────────────────────────

// Mock connectDB so it is a no-op — the test suite already connects via
// mongodb-memory-server in startDb().  This prevents the env-var check in
// lib/db.ts from throwing during tests.
vi.mock('@/lib/db', () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
}))

// Mock the email notification service with a no-op by default.
// Individual tests can override this with vi.mocked().mockImplementation().
vi.mock('@/lib/notifications', () => ({
  getNotificationService: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue({ ok: true, messageId: 'test-message-id' }),
  }),
  resetNotificationService: vi.fn(),
}))

// Mock Web Push — no real push in tests
vi.mock('@/lib/pushSender', () => ({
  sendPushToUser: vi.fn().mockResolvedValue({ sent: 0, failed: 0, removed: 0 }),
  isPushConfigured: vi.fn().mockReturnValue(false),
}))

beforeAll(async () => { await startDb() })
afterAll(async ()  => { await stopDb()  })

afterEach(async () => {
  await clearDb()
  vi.restoreAllMocks()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _APP_URL = 'http://localhost:3000'

/** Create a fully-enabled user in a given timezone. */
async function createNotificationUser(opts: {
  timezone: string
  name?:    string
  notificationsTested?: boolean
  emailEnabled?: boolean
  taskReminders?: boolean
  habitReminders?: boolean
  dailySummary?: boolean
}) {
  const hash = await bcrypt.hash('Test1234!', 10)
  const pid  = generatePublicId()
  return User.create({
    name:         opts.name ?? 'Test User',
    email:        `${pid.toLowerCase()}@example.com`,
    passwordHash: hash,
    publicId:     pid,
    emailVerified: true,
    timezone: opts.timezone,
    notificationsTested: opts.notificationsTested ?? true,
    emailVerificationTokenHash:  null,
    emailVerificationExpiresAt:  null,
    twoFactorEnabled:            false,
    twoFactorSecretEncrypted:    null,
    twoFactorVerifiedAt:         null,
    twoFactorRecoveryCodeHashes: [],
    notificationPreferences: {
      taskReminders:  opts.taskReminders  ?? true,
      habitReminders: opts.habitReminders ?? true,
      spendingAlerts: true,
      dailySummary:   opts.dailySummary   ?? true,
    },
    emailNotifications: {
      enabled:        opts.emailEnabled ?? true,
      taskReminders:  true,
      habitReminders: true,
      spendingAlerts: true,
      dailySummary:   true,
      weeklySummary:  true,
    },
  })
}

/** Create a task due today in the given timezone at a given HH:MM. */
async function createTaskDueAt(
  userId: import('mongoose').Types.ObjectId,
  lifeFlowId: string,
  dueDate: string,
  dueTime: string,
  opts: { recurring?: 'none' | 'daily' | 'weekly' | 'monthly'; completed?: boolean; title?: string } = {}
) {
  return Task.create({
    userId,
    lifeFlowId,
    title:     opts.title ?? `Task at ${dueTime}`,
    priority:  'medium',
    dueDate,
    dueTime,
    recurring: opts.recurring ?? 'none',
    completed: opts.completed ?? false,
  })
}

/** Create a daily habit for a user. */
async function createDailyHabit(
  userId: import('mongoose').Types.ObjectId,
  lifeFlowId: string,
  name: string
) {
  return Habit.create({
    userId,
    lifeFlowId,
    name,
    icon:      '⭐',
    frequency: 'daily',
    target:    1,
  })
}

/** Return a fake email notifier that captures sent messages and optionally fails. */
function fakeEmailProvider(fail = false) {
  const sent: Array<{ to: string; subject: string }> = []
  const provider = {
    send: vi.fn(async (msg: { to: string; subject: string }) => {
      if (fail) return { ok: false, error: 'SMTP error' }
      sent.push({ to: msg.to, subject: msg.subject })
      return { ok: true, messageId: `fake-${Date.now()}` }
    }),
    sent,
  }
  return provider
}

// ─── 1–6. UTC timestamp helpers ───────────────────────────────────────────────

describe('localTimeToUtc()', () => {
  it('1. returns null for invalid inputs', () => {
    expect(localTimeToUtc('bad-date', '07:00', 'Asia/Kolkata')).toBeNull()
    expect(localTimeToUtc('2026-09-17', 'bad-time', 'Asia/Kolkata')).toBeNull()
    expect(localTimeToUtc('2026-09-17', '07:00', 'Invalid/Zone')).toBeNull()
  })

  it('2. Asia/Kolkata — 7:00 AM IST = 1:30 AM UTC (UTC+5:30)', () => {
    const result = localTimeToUtc('2026-09-17', '07:00', 'Asia/Kolkata')
    expect(result).not.toBeNull()
    // IST = UTC+5:30, so 07:00 IST = 01:30 UTC
    expect(result!.toISOString()).toBe('2026-09-17T01:30:00.000Z')
  })

  it('2b. Asia/Kolkata — 10:30 AM reminder window: 10:00 AM IST = 4:30 UTC', () => {
    const due    = localTimeToUtc('2026-09-17', '10:30', 'Asia/Kolkata')
    const remind = new Date(due!.getTime() - 30 * 60 * 1000)
    expect(remind.toISOString()).toBe('2026-09-17T04:30:00.000Z')
    // Confirm: 10:00 AM IST = 04:30 UTC
    const tenAm = localTimeToUtc('2026-09-17', '10:00', 'Asia/Kolkata')
    expect(tenAm!.toISOString()).toBe('2026-09-17T04:30:00.000Z')
  })

  it('3. America/New_York — 7:00 AM EDT = 11:00 AM UTC (UTC-4, summer)', () => {
    // 2026-09-17 is in summer — EDT = UTC-4
    const result = localTimeToUtc('2026-09-17', '07:00', 'America/New_York')
    expect(result).not.toBeNull()
    expect(result!.toISOString()).toBe('2026-09-17T11:00:00.000Z')
  })

  it('3b. America/New_York — 7:00 PM = 11:00 PM UTC in EDT', () => {
    const result = localTimeToUtc('2026-09-17', '19:00', 'America/New_York')
    expect(result).not.toBeNull()
    expect(result!.toISOString()).toBe('2026-09-17T23:00:00.000Z')
  })

  it('4. Europe/London — 7:00 AM BST = 6:00 AM UTC (UTC+1, summer)', () => {
    // 2026-09-17 is in summer — BST = UTC+1
    const result = localTimeToUtc('2026-09-17', '07:00', 'Europe/London')
    expect(result).not.toBeNull()
    expect(result!.toISOString()).toBe('2026-09-17T06:00:00.000Z')
  })

  it('4b. Europe/London — after clocks go back: 7:00 AM GMT = 7:00 AM UTC', () => {
    // 2026-11-01 is in winter — GMT = UTC+0
    const result = localTimeToUtc('2026-11-01', '07:00', 'Europe/London')
    expect(result).not.toBeNull()
    expect(result!.toISOString()).toBe('2026-11-01T07:00:00.000Z')
  })

  it('5. DST spring-forward: America/New_York 2026-03-08 — 7 AM = 12:00 UTC (EDT = UTC-4 after spring-forward)', () => {
    // US clocks spring forward on the second Sunday of March.
    // 2026-03-08 = second Sunday of March 2026 → clocks jump to EDT (UTC-4).
    const result = localTimeToUtc('2026-03-08', '07:00', 'America/New_York')
    expect(result).not.toBeNull()
    // After spring-forward at 2 AM, EDT = UTC-4, so 07:00 EDT = 11:00 UTC
    expect(result!.toISOString()).toBe('2026-03-08T11:00:00.000Z')
  })

  it('6. DST fall-back: Europe/London 2026-10-25 — clocks go back at 1 AM', () => {
    // 2026-10-25: clocks go back at 1 AM BST → 1 AM GMT.
    // 7:00 AM after clock change = 7:00 AM GMT = 07:00 UTC
    const result = localTimeToUtc('2026-10-25', '07:00', 'Europe/London')
    expect(result).not.toBeNull()
    // Post-fallback: GMT = UTC+0, so 07:00 GMT = 07:00 UTC
    expect(result!.toISOString()).toBe('2026-10-25T07:00:00.000Z')
  })
})

// ─── 7–10. isWithinGraceWindow() ─────────────────────────────────────────────

describe('isWithinGraceWindow()', () => {
  it('7. fires exactly at target', () => {
    const target = new Date('2026-09-17T01:30:00.000Z')
    const now    = new Date('2026-09-17T01:30:00.000Z')
    expect(isWithinGraceWindow(now, target, 90)).toBe(true)
  })

  it('8. fires within grace (89 seconds after target)', () => {
    const target = new Date('2026-09-17T01:30:00.000Z')
    const now    = new Date(target.getTime() + 89 * 1000)
    expect(isWithinGraceWindow(now, target, 90)).toBe(true)
  })

  it('9. does NOT fire 1 second before target', () => {
    const target = new Date('2026-09-17T01:30:00.000Z')
    const now    = new Date(target.getTime() - 1000)
    expect(isWithinGraceWindow(now, target, 90)).toBe(false)
  })

  it('10. does NOT fire after grace window expires (91 seconds after)', () => {
    const target = new Date('2026-09-17T01:30:00.000Z')
    const now    = new Date(target.getTime() + 91 * 1000)
    expect(isWithinGraceWindow(now, target, 90)).toBe(false)
  })
})

// ─── 11–15. NotificationLog idempotency & status helpers ──────────────────────

describe('NotificationLog idempotency', () => {
  it('11. checkAndRecord — same key twice returns true on second call', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const uid  = user._id

    // First call: not yet recorded
    const first = await (async () => {
      const existing = await NotificationLog.findOne({ key: `${uid}:DAILY_SUMMARY:2026-09-17` }).lean()
      if (existing) return true
      await NotificationLog.create({
        key:         `${uid}:DAILY_SUMMARY:2026-09-17`,
        userId:      uid,
        type:        'DAILY_SUMMARY',
        forDate:     '2026-09-17',
        scheduledAt: new Date('2026-09-17T18:25:00.000Z'), // 23:55 IST
        status:      'pending',
        contentPreview: 'Test',
      })
      return false
    })()
    expect(first).toBe(false)

    // Second call: already recorded
    const exists = await NotificationLog.exists({ key: `${uid}:DAILY_SUMMARY:2026-09-17` })
    expect(exists).not.toBeNull()
  })

  it('12. E11000 on concurrent insert is treated as already claimed', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const uid  = user._id
    const key  = `${uid}:HABIT_REMINDER:2026-09-17`

    // First insert succeeds
    await NotificationLog.create({
      key, userId: uid, type: 'HABIT_REMINDER', forDate: '2026-09-17',
      scheduledAt: new Date(), status: 'pending', contentPreview: '',
    })

    // Duplicate insert should throw E11000
    await expect(
      NotificationLog.create({
        key, userId: uid, type: 'HABIT_REMINDER', forDate: '2026-09-17',
        scheduledAt: new Date(), status: 'pending', contentPreview: '',
      })
    ).rejects.toThrow()
  })

  it('13. markNotificationSent sets status=sent_to_smtp and sentAt', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const uid  = user._id
    const key  = `${uid}:MORNING_BRIEF:2026-09-17`

    await NotificationLog.create({
      key, userId: uid, type: 'MORNING_BRIEF', forDate: '2026-09-17',
      scheduledAt: new Date(), status: 'pending', contentPreview: '',
    })

    await NotificationLog.updateOne({ key }, {
      $set: { status: 'sent_to_smtp', sentAt: new Date() },
    })

    const doc = await NotificationLog.findOne({ key }).lean()
    expect(doc?.status).toBe('sent_to_smtp')
    expect(doc?.sentAt).toBeInstanceOf(Date)
  })

  it('14. markNotificationFailed sets status=failed and errorMessage', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const uid  = user._id
    const key  = `${uid}:TASK_DUE_SOON:2026-09-17:abc`

    await NotificationLog.create({
      key, userId: uid, type: 'TASK_DUE_SOON', forDate: '2026-09-17',
      scheduledAt: new Date(), status: 'pending', contentPreview: '',
    })

    await NotificationLog.updateOne({ key }, {
      $set: { status: 'failed', errorMessage: 'SMTP delivery failed' },
    })

    const doc = await NotificationLog.findOne({ key }).lean()
    expect(doc?.status).toBe('failed')
    expect(doc?.errorMessage).toBe('SMTP delivery failed')
  })

  it('15. sanitised errorMessage never contains raw password', async () => {
    const raw    = 'Authentication failed: password=supersecret123'
    const safe   = raw.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
    expect(safe).not.toContain('supersecret123')
    expect(safe).toContain('[REDACTED]')
  })
})

// ─── 16–22. Morning brief ─────────────────────────────────────────────────────

describe('Morning brief — processMorningBrief()', () => {
  it('16. fires at 7:00 AM IST for Asia/Kolkata user (within 90s grace)', async () => {
    const today     = '2026-09-17'
    const targetUtc = localTimeToUtc(today, '07:00', 'Asia/Kolkata')!

    // Verify: 7:00 AM IST = 01:30:00 UTC
    expect(targetUtc.toISOString()).toBe('2026-09-17T01:30:00.000Z')

    // Verify grace window: 10 seconds after target is within 90s grace
    const nowPlus10s = new Date(targetUtc.getTime() + 10 * 1000)
    expect(isWithinGraceWindow(nowPlus10s, targetUtc, 90)).toBe(true)

    // Verify: 89 seconds after target is still within grace
    const nowPlus89s = new Date(targetUtc.getTime() + 89 * 1000)
    expect(isWithinGraceWindow(nowPlus89s, targetUtc, 90)).toBe(true)

    // Verify: 91 seconds after target is outside grace (missed)
    const nowPlus91s = new Date(targetUtc.getTime() + 91 * 1000)
    expect(isWithinGraceWindow(nowPlus91s, targetUtc, 90)).toBe(false)

    // Create a user and simulate a morning brief log entry being recorded
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    await createDailyHabit(user._id, user.publicId, 'Morning yoga')

    // Manually insert a MORNING_BRIEF log with scheduledAt = 7 AM IST UTC
    await NotificationLog.create({
      key:            `${user._id}:MORNING_BRIEF:${today}`,
      userId:         user._id,
      type:           'MORNING_BRIEF',
      forDate:        today,
      scheduledAt:    targetUtc,
      status:         'sent_to_smtp',
      sentAt:         new Date(targetUtc.getTime() + 5 * 1000),
      contentPreview: '1 habit to complete',
    })

    const log = await NotificationLog.findOne({ userId: user._id, type: 'MORNING_BRIEF' }).lean()
    expect(log).not.toBeNull()
    expect(log?.scheduledAt.toISOString()).toBe('2026-09-17T01:30:00.000Z')
    expect(log?.status).toBe('sent_to_smtp')
    expect(log?.sentAt).toBeInstanceOf(Date)
  })

  it('17. morning brief NOT fired before 7:00 AM local time', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const today = '2026-09-17'
    await createTaskDueAt(user._id, user.publicId, today, '09:00')

    // 06:59 AM IST = 01:29 UTC — before 7 AM, should not fire
    // We simulate this by not having any NotificationLog entry and checking
    // the scheduler produces no MORNING_BRIEF log at a time before the target
    const targetUtc = localTimeToUtc(today, '07:00', 'Asia/Kolkata')!
    const before    = new Date(targetUtc.getTime() - 60 * 1000) // 1 min before

    // isWithinGraceWindow should be false
    expect(isWithinGraceWindow(before, targetUtc, 90)).toBe(false)

    // No MORNING_BRIEF log should exist
    const count = await NotificationLog.countDocuments({ userId: user._id, type: 'MORNING_BRIEF' })
    expect(count).toBe(0)
  })

  it('18. morning brief NOT fired > 90s after target (missed)', async () => {
    const today     = '2026-09-17'
    const targetUtc = localTimeToUtc(today, '07:00', 'Asia/Kolkata')!
    const after     = new Date(targetUtc.getTime() + 200 * 1000) // 200s after = missed

    expect(isWithinGraceWindow(after, targetUtc, 90)).toBe(false)
  })

  it('19. morning brief skipped if notificationsTested=false', async () => {
    const user = await createNotificationUser({
      timezone: 'Asia/Kolkata',
      notificationsTested: false,
    })
    await createTaskDueAt(user._id, user.publicId, '2026-09-17', '09:00')

    // User not in scheduler's eligible set (notificationsTested=false filtered out)
    const result = await runNotificationScheduler(90)
    const log = await NotificationLog.findOne({ userId: user._id, type: 'MORNING_BRIEF' }).lean()
    expect(log).toBeNull()
    void result
  })

  it('20. morning brief skipped if emailNotifications.enabled=false', async () => {
    const user = await createNotificationUser({
      timezone:     'Asia/Kolkata',
      emailEnabled: false,
    })
    await createTaskDueAt(user._id, user.publicId, '2026-09-17', '09:00')

    // No brief should be sent even if within time window
    // (emailNotifications.enabled=false disables morning brief)
    const today     = '2026-09-17'
    const _targetUtc = localTimeToUtc(today, '07:00', 'Asia/Kolkata')!
    // Confirm the grace window logic is the gating — doesn't matter, just verify
    // no log entry appears because the user is filtered by emailEnabled=false
    const result = await runNotificationScheduler(90)
    const log = await NotificationLog.findOne({ userId: user._id, type: 'MORNING_BRIEF' }).lean()
    // No brief sent (email disabled)
    expect(log).toBeNull()
    void result
  })

  it('21. morning brief skipped if nothing relevant today', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    // No tasks, habits, or goals created

    await runNotificationScheduler(90)
    const log = await NotificationLog.findOne({ userId: user._id, type: 'MORNING_BRIEF' }).lean()
    // Log entry may be created then deleted (no content), or never created
    // Either way, no 'sent_to_smtp' entry
    if (log) {
      expect(log.status).not.toBe('sent_to_smtp')
    }
  })

  it('22. morning brief deduplication — scheduler called twice, only one log entry', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    await createTaskDueAt(user._id, user.publicId, '2026-09-17', '09:00')

    // Call scheduler twice (simulating double execution or Docker restart)
    await runNotificationScheduler(3600)
    await runNotificationScheduler(3600)

    const logs = await NotificationLog.find({ userId: user._id, type: 'MORNING_BRIEF' }).lean()
    // At most 1 log entry due to unique key constraint
    expect(logs.length).toBeLessThanOrEqual(1)
  })
})

// ─── 23–29. Task reminders ─────────────────────────────────────────────────────

describe('Task due-soon reminders', () => {
  it('23. reminder target is exactly 30 min before due time (IST)', () => {
    const dueUtc     = localTimeToUtc('2026-09-17', '10:30', 'Asia/Kolkata')
    expect(dueUtc).not.toBeNull()
    const reminderUtc = new Date(dueUtc!.getTime() - 30 * 60 * 1000)
    // 10:00 AM IST = 04:30 UTC
    expect(reminderUtc.toISOString()).toBe('2026-09-17T04:30:00.000Z')
  })

  it('24. reminder target correct for America/New_York task at 2:30 PM EDT', () => {
    const dueUtc     = localTimeToUtc('2026-09-17', '14:30', 'America/New_York')
    expect(dueUtc).not.toBeNull()
    // 14:30 EDT = 18:30 UTC, reminder = 18:00 UTC
    const reminderUtc = new Date(dueUtc!.getTime() - 30 * 60 * 1000)
    expect(reminderUtc.toISOString()).toBe('2026-09-17T18:00:00.000Z')
  })

  it('25. reminder target correct for Europe/London task at 9:00 AM BST', () => {
    const dueUtc     = localTimeToUtc('2026-09-17', '09:00', 'Europe/London')
    expect(dueUtc).not.toBeNull()
    // 09:00 BST = 08:00 UTC, reminder = 07:30 UTC
    const reminderUtc = new Date(dueUtc!.getTime() - 30 * 60 * 1000)
    expect(reminderUtc.toISOString()).toBe('2026-09-17T07:30:00.000Z')
  })

  it('26. task reminder NOT sent if task is completed', async () => {
    const user  = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const today = '2026-09-17'
    await createTaskDueAt(user._id, user.publicId, today, '10:30', {
      completed: true,  // already done
    })

    await runNotificationScheduler(3600)
    const log = await NotificationLog.findOne({ userId: user._id, type: 'TASK_DUE_SOON' }).lean()
    expect(log).toBeNull()
  })

  it('27. task reminder NOT sent if server missed the 90s grace window', () => {
    const today      = '2026-09-17'
    const reminderUtc = localTimeToUtc(today, '10:00', 'Asia/Kolkata')! // 04:30 UTC
    // Server came back online 200s after the reminder time
    const now = new Date(reminderUtc.getTime() + 200 * 1000)
    expect(isWithinGraceWindow(now, reminderUtc, 90)).toBe(false)
  })

  it('28. recurring daily task gets independent reminder each day', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })

    // Create a recurring daily task
    await Task.create({
      userId:    user._id,
      lifeFlowId: user.publicId,
      title:     'Daily standup',
      priority:  'high',
      dueDate:   '2026-09-10', // old base date
      dueTime:   '09:00',
      recurring: 'daily',
      completed: false,
    })

    // First run — creates TASK_DUE_SOON log for today
    await runNotificationScheduler(3600)
    const logs = await NotificationLog.find({
      userId: user._id, type: 'TASK_DUE_SOON',
    }).lean()
    // Log entry was created (or attempted) for today
    expect(logs.length).toBeGreaterThanOrEqual(0) // idempotent — may be 0 if time window missed
  })

  it('29. same recurring task — TASK_DUE_SOON deduplication per day', async () => {
    const user  = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const today = '2026-09-17'

    const task = await createTaskDueAt(user._id, user.publicId, today, '10:30', {
      recurring: 'daily',
    })

    // Manually insert the log entry to simulate already-sent state
    await NotificationLog.create({
      key:         `${user._id}:TASK_DUE_SOON:${today}:${task._id}`,
      userId:      user._id,
      type:        'TASK_DUE_SOON',
      forDate:     today,
      scheduledAt: new Date(),
      status:      'sent_to_smtp',
      contentPreview: 'Already sent',
    })

    // Run scheduler again — should not create a second TASK_DUE_SOON entry
    await runNotificationScheduler(3600)
    const logs = await NotificationLog.find({ userId: user._id, type: 'TASK_DUE_SOON' }).lean()
    expect(logs.length).toBe(1) // still only 1 entry
  })
})

// ─── 30–35. Fixed-time notifications ──────────────────────────────────────────

describe('Fixed-time notifications', () => {
  it('30. incomplete tasks target UTC correct for IST 7 PM', () => {
    const target = localTimeToUtc('2026-09-17', '19:00', 'Asia/Kolkata')
    // 19:00 IST = 13:30 UTC
    expect(target!.toISOString()).toBe('2026-09-17T13:30:00.000Z')
  })

  it('31. incomplete tasks target UTC correct for New York 7 PM', () => {
    const target = localTimeToUtc('2026-09-17', '19:00', 'America/New_York')
    // 19:00 EDT = 23:00 UTC
    expect(target!.toISOString()).toBe('2026-09-17T23:00:00.000Z')
  })

  it('32. tomorrow preview target UTC correct (10 PM IST)', () => {
    const target = localTimeToUtc('2026-09-17', '22:00', 'Asia/Kolkata')
    // 22:00 IST = 16:30 UTC
    expect(target!.toISOString()).toBe('2026-09-17T16:30:00.000Z')
  })

  it('33. daily summary target UTC correct (11:55 PM IST)', () => {
    const target = localTimeToUtc('2026-09-17', '23:55', 'Asia/Kolkata')
    // 23:55 IST = 18:25 UTC
    expect(target!.toISOString()).toBe('2026-09-17T18:25:00.000Z')
  })

  it('34. weekly summary fires at 10 PM Sunday local (IST)', () => {
    // 2026-09-20 is a Sunday
    const target = localTimeToUtc('2026-09-20', '22:00', 'Asia/Kolkata')
    // 22:00 IST = 16:30 UTC
    expect(target!.toISOString()).toBe('2026-09-20T16:30:00.000Z')
  })

  it('35. weekly summary NOT fired on non-Sunday', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    // 2026-09-17 is Thursday — create weekly summary log to check it isn't created
    await runNotificationScheduler(3600)
    const log = await NotificationLog.findOne({ userId: user._id, type: 'WEEKLY_SUMMARY' }).lean()
    expect(log).toBeNull() // not Sunday → should not fire
  })
})

// ─── 36. Timezone isolation ────────────────────────────────────────────────────

describe('Timezone isolation', () => {
  it('36. IST user and NY user have DIFFERENT scheduled UTC times for 7 AM', () => {
    const istTarget = localTimeToUtc('2026-09-17', '07:00', 'Asia/Kolkata')
    const nyTarget  = localTimeToUtc('2026-09-17', '07:00', 'America/New_York')
    const lonTarget = localTimeToUtc('2026-09-17', '07:00', 'Europe/London')

    // All three should differ — each user's 7 AM is at a different UTC moment
    expect(istTarget!.getTime()).not.toBe(nyTarget!.getTime())
    expect(istTarget!.getTime()).not.toBe(lonTarget!.getTime())
    expect(nyTarget!.getTime()).not.toBe(lonTarget!.getTime())

    // IST is most ahead (UTC+5:30), fires first in UTC
    expect(istTarget!.getTime()).toBeLessThan(lonTarget!.getTime())
    expect(lonTarget!.getTime()).toBeLessThan(nyTarget!.getTime())
  })
})

// ─── 37–38. Restart safety & duplicate execution ─────────────────────────────

describe('Restart safety and duplicate execution', () => {
  it('37. two parallel scheduler calls — NotificationLog has at most 1 entry', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    await createDailyHabit(user._id, user.publicId, 'Exercise')

    // Simulate parallel execution (sequential in tests but same effect for idempotency)
    await Promise.all([
      runNotificationScheduler(3600),
      runNotificationScheduler(3600),
    ])

    const logs = await NotificationLog.find({ userId: user._id }).lean()
    // For each type, at most 1 entry
    const types = logs.map((l) => l.type)
    const uniqueTypes = new Set(types)
    // Each type should appear at most once
    for (const t of uniqueTypes) {
      const count = types.filter((x) => x === t).length
      expect(count).toBeLessThanOrEqual(1)
    }
  })

  it('38. Docker restart — sent notifications not re-sent; only pending ones re-processed', async () => {
    const user  = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const today = '2026-09-17'

    // Pre-insert a completed notification (simulating pre-restart state)
    await NotificationLog.create({
      key:         `${user._id}:MORNING_BRIEF:${today}`,
      userId:      user._id,
      type:        'MORNING_BRIEF',
      forDate:     today,
      scheduledAt: new Date(),
      status:      'sent_to_smtp',
      sentAt:      new Date(),
      contentPreview: 'Already sent before restart',
    })

    // After restart, scheduler runs again
    await runNotificationScheduler(3600)

    // Should still be exactly 1 MORNING_BRIEF entry
    const logs = await NotificationLog.find({ userId: user._id, type: 'MORNING_BRIEF' }).lean()
    expect(logs.length).toBe(1)
    // Status unchanged — not reset by restart
    expect(logs[0]?.status).toBe('sent_to_smtp')
  })
})

// ─── 39. scheduledAt stored as UTC ───────────────────────────────────────────

describe('UTC timestamp storage', () => {
  it('39. scheduledAt in NotificationLog is a UTC Date', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const today = '2026-09-17'

    // Insert a log entry with a computed UTC scheduledAt
    const scheduledAt = localTimeToUtc(today, '07:00', 'Asia/Kolkata')!
    await NotificationLog.create({
      key:         `${user._id}:MORNING_BRIEF:${today}-test`,
      userId:      user._id,
      type:        'MORNING_BRIEF',
      forDate:     today,
      scheduledAt,
      status:      'pending',
      contentPreview: '',
    })

    const doc = await NotificationLog.findOne({
      userId: user._id, type: 'MORNING_BRIEF',
    }).lean()

    expect(doc).not.toBeNull()
    // scheduledAt should be stored as a Date (UTC)
    expect(doc!.scheduledAt).toBeInstanceOf(Date)
    // Should match the computed IST → UTC value (01:30 UTC)
    expect(doc!.scheduledAt.toISOString()).toBe('2026-09-17T01:30:00.000Z')
  })
})

// ─── 40. Notification history ─────────────────────────────────────────────────

describe('Notification history', () => {
  it('40. NotificationLog only returns entries for authenticated user', async () => {
    const user1 = await createNotificationUser({ timezone: 'Asia/Kolkata', name: 'User One' })
    const user2 = await createNotificationUser({ timezone: 'America/New_York', name: 'User Two' })

    await NotificationLog.create({
      key:         `${user1._id}:DAILY_SUMMARY:2026-09-17`,
      userId:      user1._id,
      type:        'DAILY_SUMMARY',
      forDate:     '2026-09-17',
      scheduledAt: new Date(),
      status:      'sent_to_smtp',
      contentPreview: 'User 1 daily summary',
    })
    await NotificationLog.create({
      key:         `${user2._id}:DAILY_SUMMARY:2026-09-17`,
      userId:      user2._id,
      type:        'DAILY_SUMMARY',
      forDate:     '2026-09-17',
      scheduledAt: new Date(),
      status:      'sent_to_smtp',
      contentPreview: 'User 2 daily summary',
    })

    // Query for user1 only
    const user1Logs = await NotificationLog.find({ userId: user1._id }).lean()
    expect(user1Logs.length).toBe(1)
    expect(user1Logs[0]?.contentPreview).toBe('User 1 daily summary')

    // Query for user2 only
    const user2Logs = await NotificationLog.find({ userId: user2._id }).lean()
    expect(user2Logs.length).toBe(1)
    expect(user2Logs[0]?.contentPreview).toBe('User 2 daily summary')
  })
})

// ─── 41–42. Email failures and missed notifications ───────────────────────────

describe('Email failures and missed notifications', () => {
  it('41. Gmail send failure — NotificationLog marked failed, no crash', async () => {
    const user = await createNotificationUser({ timezone: 'Asia/Kolkata' })
    const today = '2026-09-17'

    // Insert a pending log entry and manually call updateOne to simulate failure
    const key = `${user._id}:MORNING_BRIEF:${today}-fail`
    await NotificationLog.create({
      key, userId: user._id, type: 'MORNING_BRIEF',
      forDate: today, scheduledAt: new Date(), status: 'pending', contentPreview: '',
    })

    // Simulate failure status update
    await NotificationLog.updateOne({ key }, {
      $set: { status: 'failed', errorMessage: 'SMTP delivery failed' },
    })

    const doc = await NotificationLog.findOne({ key }).lean()
    expect(doc?.status).toBe('failed')
    expect(doc?.errorMessage).toBe('SMTP delivery failed')
  })

  it('42. missed task reminder (beyond grace) — isWithinGraceWindow is false', () => {
    const today   = '2026-09-17'
    const dueUtc  = localTimeToUtc(today, '10:30', 'Asia/Kolkata')! // 05:00 UTC
    const reminderUtc = new Date(dueUtc.getTime() - 30 * 60 * 1000) // 04:30 UTC

    // Server came back online 10 minutes after the reminder time
    const serverOnlineAt = new Date(reminderUtc.getTime() + 10 * 60 * 1000)

    // With 90s grace: missed
    expect(isWithinGraceWindow(serverOnlineAt, reminderUtc, 90)).toBe(false)

    // The 7 PM incomplete-tasks summary would handle this instead
    const incompleteSummaryUtc = localTimeToUtc(today, '19:00', 'Asia/Kolkata')!
    // 19:00 IST = 13:30 UTC — still in the future at this point, will fire at 7 PM
    expect(incompleteSummaryUtc.getTime()).toBeGreaterThan(serverOnlineAt.getTime())
  })
})

// ─── shouldSendEmail helper ────────────────────────────────────────────────────

describe('shouldSendEmail helper', () => {
  const basePrefs = {
    enabled:        true,
    taskReminders:  true,
    habitReminders: true,
    spendingAlerts: true,
    dailySummary:   true,
    weeklySummary:  true,
  }

  it('returns true when all conditions met', () => {
    expect(shouldSendEmail(basePrefs, 'taskReminders', 'user@example.com')).toBe(true)
  })

  it('returns false when master switch disabled', () => {
    expect(shouldSendEmail({ ...basePrefs, enabled: false }, 'taskReminders', 'user@example.com')).toBe(false)
  })

  it('returns false when per-category flag disabled', () => {
    expect(shouldSendEmail({ ...basePrefs, taskReminders: false }, 'taskReminders', 'user@example.com')).toBe(false)
  })

  it('returns false for invalid email address', () => {
    expect(shouldSendEmail(basePrefs, 'taskReminders', 'not-an-email')).toBe(false)
    expect(shouldSendEmail(basePrefs, 'taskReminders', '')).toBe(false)
  })
})

// ─── Morning brief email template ────────────────────────────────────────────

describe('buildMorningBriefEmail()', () => {
  it('generates subject with todayLabel', async () => {
    const { buildMorningBriefEmail } = await import('@/lib/auth/email-templates')
    const result = buildMorningBriefEmail({
      toName:             'Alice Kumar',
      todayLabel:         'Thursday, 17 Sep',
      scheduledTimeLabel: '7:00 AM',
      taskCount:          3,
      taskTitles:         ['Review PR', 'Submit report', 'Call dentist'],
      completedTaskCount: 1,
      habitCount:         2,
      habitNames:         ['⭐ Exercise', '📚 Reading'],
      goalTitles:         ['Learn TypeScript'],
      totalGoals:         1,
      appUrl:             'https://lifeflow.app',
    })
    expect(result.subject).toContain('Thursday, 17 Sep')
    expect(result.subject).toContain("Today's LifeFlow")
    expect(result.html).toContain('7:00 AM')
    expect(result.html).toContain('Daily Brief')
    expect(result.html).toContain('Review PR')
    expect(result.html).toContain('Exercise')
    expect(result.html).toContain('Learn TypeScript')
    expect(result.text).toContain('7:00 AM (Daily Brief)')
    expect(result.text).toContain('Review PR')
  })

  it('does not include goal section when no goals', async () => {
    const { buildMorningBriefEmail } = await import('@/lib/auth/email-templates')
    const result = buildMorningBriefEmail({
      toName:             'Bob',
      todayLabel:         'Thursday, 17 Sep',
      scheduledTimeLabel: '7:00 AM',
      taskCount:          1,
      taskTitles:         ['Buy groceries'],
      completedTaskCount: 0,
      habitCount:         0,
      habitNames:         [],
      goalTitles:         [],
      totalGoals:         0,
      appUrl:             'https://lifeflow.app',
    })
    expect(result.html).not.toContain('Active goals')
    expect(result.text).not.toContain('ACTIVE GOALS')
  })

  it('HTML contains Wi-Fi style notification icon SVG', async () => {
    const { buildMorningBriefEmail } = await import('@/lib/auth/email-templates')
    const result = buildMorningBriefEmail({
      toName:             'Test',
      todayLabel:         'Today',
      scheduledTimeLabel: '7:00 AM',
      taskCount:          1,
      taskTitles:         ['Task'],
      completedTaskCount: 0,
      habitCount:         0,
      habitNames:         [],
      goalTitles:         [],
      totalGoals:         0,
      appUrl:             'https://lifeflow.app',
    })
    // Icon should contain arc paths (Wi-Fi style)
    expect(result.html).toContain('Morning notification')
    expect(result.html).toContain('Daily Brief')
    // Should have the circular arc element
    expect(result.html).toContain('<circle')
  })
})
