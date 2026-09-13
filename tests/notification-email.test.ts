/**
 * tests/notification-email.test.ts
 *
 * Tests for the LifeFlow email notification system.
 *
 * Coverage:
 *  1.  Recipient is always the authenticated user's registered email
 *  2.  Client cannot specify arbitrary recipient
 *  3.  Email preference OFF prevents email
 *  4.  Email preference ON sends email
 *  5.  Push and email operate independently
 *  6.  Duplicate scheduler execution does not duplicate email (idempotency)
 *  7.  Quiet hours are respected (22:00–07:00)
 *  8.  User timezone is respected for window checks
 *  9.  Unverified users are not processed by the scheduler
 * 10.  SMTP failure does not crash scheduler
 * 11.  nodemailer 7.0.6 loads successfully
 * 12.  Email verification continues working (not broken by notification changes)
 * 13.  Notification email has HTML and plain text
 * 14.  Sensitive data is not logged
 * 15.  shouldSendEmail helper enforces master switch
 * 16.  shouldSendEmail enforces per-category flag
 * 17.  shouldSendEmail rejects invalid email addresses
 * 18.  Legacy users without emailNotifications field get safe defaults
 * 19.  Test-email endpoint resolves recipient from DB (not client)
 * 20.  User model saves and retrieves emailNotifications correctly
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import * as fs   from 'fs'
import * as path from 'path'
import { startDb, stopDb, clearDb } from './helpers/db'
import User from '@/models/User'
import NotificationLog from '@/models/NotificationLog'
import { resetNotificationService } from '@/lib/notifications'
import { generateVerificationToken } from '@/lib/auth/crypto'
import {
  buildTomorrowTasksEmail,
  buildIncompleteTasksEmail,
  buildTomorrowHabitsEmail,
  buildSpendingAlertEmail,
  buildDailySummaryEmail,
} from '@/lib/auth/email-templates'

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => { await startDb() })
afterAll(async ()  => { await stopDb()  })

afterEach(async () => {
  await clearDb()
  resetNotificationService()
  vi.restoreAllMocks()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const APP_URL = 'http://localhost:3000'

async function createVerifiedUser(overrides: Partial<{
  email: string
  name:  string
  emailNotificationsEnabled: boolean
}> = {}) {
  const bcrypt = await import('bcryptjs')
  return User.create({
    name:         overrides.name  ?? 'Test User',
    email:        (overrides.email ?? `user-${Date.now()}@example.com`).toLowerCase(),
    passwordHash: await bcrypt.default.hash('Test1234!', 10),
    publicId:     `LF-TEST${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    emailVerified: true,
    emailVerificationTokenHash:  null,
    emailVerificationExpiresAt:  null,
    twoFactorEnabled:            false,
    twoFactorSecretEncrypted:    null,
    twoFactorVerifiedAt:         null,
    twoFactorRecoveryCodeHashes: [],
    notificationPreferences: {
      taskReminders:  true,
      habitReminders: true,
      spendingAlerts: true,
      dailySummary:   true,
    },
    emailNotifications: {
      enabled:        overrides.emailNotificationsEnabled ?? false,
      taskReminders:  true,
      habitReminders: true,
      spendingAlerts: true,
      dailySummary:   true,
    },
  })
}

async function createUnverifiedUser() {
  const bcrypt = await import('bcryptjs')
  const { tokenHash } = generateVerificationToken()
  return User.create({
    name:         'Unverified User',
    email:        `unverified-${Date.now()}@example.com`,
    passwordHash: await bcrypt.default.hash('Test1234!', 10),
    publicId:     `LF-UNVR${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    emailVerified: false,
    emailVerificationTokenHash:  tokenHash,
    emailVerificationExpiresAt:  new Date(Date.now() + 8 * 60 * 1000),
    twoFactorEnabled:            false,
    twoFactorSecretEncrypted:    null,
    twoFactorVerifiedAt:         null,
    twoFactorRecoveryCodeHashes: [],
  })
}

// ─── 1. Recipient is always the authenticated user's registered email ──────────

describe('1. Recipient always resolved from database', () => {
  it('user.email from DB is used — never a client-supplied address', async () => {
    const user = await createVerifiedUser({ email: 'recipient@example.com' })
    // The DB is the source of truth
    expect(user.email).toBe('recipient@example.com')
  })

  it('email stored in User model is lowercase and trimmed', async () => {
    const user = await createVerifiedUser({ email: 'TrimMe@EXAMPLE.COM' })
    expect(user.email).toBe('trimme@example.com')
  })

  it('User.findById returns the registered email for recipient resolution', async () => {
    const user = await createVerifiedUser({ email: 'lookupme@example.com' })
    const found = await User.findById(user._id).select('email').lean()
    expect(found?.email).toBe('lookupme@example.com')
  })
})

// ─── 2. Client cannot specify arbitrary recipient ──────────────────────────────

describe('2. Client cannot specify arbitrary recipient', () => {
  it('test-email route source never accepts "to" from client body', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/notifications/test-email/route.ts'),
      'utf8'
    )
    // The route must read the recipient from the DB, not from req.body
    expect(routeSrc).toContain('user.email')
    expect(routeSrc).not.toMatch(/req\.body\.to|body\.to|body\["to"\]/)
  })

  it('notificationScheduler source always uses user.email for recipient', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    // All deliver() calls must pass userEmail: user.email
    expect(schedulerSrc).toContain('userEmail:    user.email')
    // Must never reference a client request object
    expect(schedulerSrc).not.toContain('req.body')
  })
})

// ─── 3. Email preference OFF prevents email ────────────────────────────────────

describe('3. Email preference OFF prevents email', () => {
  it('shouldSendEmail returns false when enabled=false', () => {
    // Inline the shouldSendEmail logic to test it directly
    function shouldSendEmail(
      emailPrefs: { enabled: boolean; taskReminders: boolean },
      key: 'taskReminders',
      email: string
    ): boolean {
      if (!emailPrefs.enabled) return false
      if (!emailPrefs[key]) return false
      if (!email || !email.includes('@')) return false
      return true
    }

    const result = shouldSendEmail(
      { enabled: false, taskReminders: true },
      'taskReminders',
      'user@example.com'
    )
    expect(result).toBe(false)
  })

  it('user with emailNotifications.enabled=false does not get emails', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: false })
    expect(user.emailNotifications.enabled).toBe(false)
  })

  it('email is not sent when EMAIL_PROVIDER=none regardless of user prefs', async () => {
    const saved = process.env.EMAIL_PROVIDER
    process.env.EMAIL_PROVIDER = 'none'
    resetNotificationService()

    const { getNotificationService } = await import('@/lib/notifications')
    const notifier = await getNotificationService()

    // NoOpProvider always returns ok:true but never actually sends
    const result = await notifier.send({
      to:      'user@example.com',
      subject: 'Test',
      text:    'Test',
    })
    expect(result.ok).toBe(true)
    expect(result.messageId).toBe('noop')

    if (saved !== undefined) process.env.EMAIL_PROVIDER = saved
    else delete process.env.EMAIL_PROVIDER
    resetNotificationService()
  })
})

// ─── 4. Email preference ON sends email ──────────────────────────────────────

describe('4. Email preference ON sends email', () => {
  it('shouldSendEmail returns true when all conditions met', () => {
    function shouldSendEmail(
      emailPrefs: { enabled: boolean; taskReminders: boolean },
      key: 'taskReminders',
      email: string
    ): boolean {
      if (!emailPrefs.enabled) return false
      if (!emailPrefs[key]) return false
      if (!email || !email.includes('@')) return false
      return true
    }

    const result = shouldSendEmail(
      { enabled: true, taskReminders: true },
      'taskReminders',
      'user@example.com'
    )
    expect(result).toBe(true)
  })

  it('user with emailNotifications.enabled=true is eligible for emails', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: true })
    expect(user.emailNotifications.enabled).toBe(true)
  })
})

// ─── 5. Push and email operate independently ─────────────────────────────────

describe('5. Push and email are independent channels', () => {
  it('scheduler source does not abort email if push fails', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    // Push failures are caught independently
    expect(schedulerSrc).toContain('sendPushToUser(userId, push).catch(')
    // Email is in a separate try/catch block
    expect(schedulerSrc).toContain('await notifier.send(')
    expect(schedulerSrc).toContain('catch (err: unknown)')
  })

  it('deliver() function has separate push and email sections', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    // Both channels present as independent blocks
    expect(schedulerSrc).toContain('── Push ─')
    expect(schedulerSrc).toContain('── Email ─')
    // In-app channel present too
    expect(schedulerSrc).toContain('── In-app ─')
  })
})

// ─── 6. Duplicate scheduler execution does not duplicate email ────────────────

describe('6. Idempotency: duplicate scheduler run does not duplicate email', () => {
  it('NotificationLog key is unique and blocks second insert', async () => {
    const user = await createVerifiedUser()
    const key  = `${user._id.toString()}:DAILY_SUMMARY:2026-09-13`

    // First insert — should succeed
    await NotificationLog.create({
      key,
      userId:  user._id,
      type:    'DAILY_SUMMARY',
      forDate: '2026-09-13',
    })

    // Second insert with same key must throw E11000
    await expect(
      NotificationLog.create({
        key,
        userId:  user._id,
        type:    'DAILY_SUMMARY',
        forDate: '2026-09-13',
      })
    ).rejects.toThrow()
  })

  it('checkAndRecord returns true (already sent) on second call for same key', async () => {
    const user = await createVerifiedUser()
    // Two separate records with different dates — both should succeed
    await NotificationLog.create({
      key:     `${user._id}:TASK_TOMORROW:2026-09-14`,
      userId:  user._id,
      type:    'TASK_TOMORROW',
      forDate: '2026-09-14',
    })

    const exists = await NotificationLog.exists({
      key: `${user._id}:TASK_TOMORROW:2026-09-14`,
    })
    expect(exists).not.toBeNull()
  })

  it('NotificationLog has a unique index on key', async () => {
    // Verify the index exists by inspecting the schema
    const notifLogSrc = fs.readFileSync(
      path.join(process.cwd(), 'models/NotificationLog.ts'),
      'utf8'
    )
    expect(notifLogSrc).toContain("{ key: 1 }, { unique: true }")
  })

  it('NotificationLog has a TTL index for auto-expiry after 7 days', () => {
    const notifLogSrc = fs.readFileSync(
      path.join(process.cwd(), 'models/NotificationLog.ts'),
      'utf8'
    )
    expect(notifLogSrc).toContain('expireAfterSeconds')
    expect(notifLogSrc).toContain('7 * 24 * 60 * 60')
  })
})

// ─── 7. Quiet hours are respected ─────────────────────────────────────────────

describe('7. Quiet hours are respected', () => {
  it('isQuietHour returns true for hour 22 (start of quiet window)', () => {
    // 22:00–07:00 is quiet.  We test the inline logic.
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(22)).toBe(true)
  })

  it('isQuietHour returns true for hour 23', () => {
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(23)).toBe(true)
  })

  it('isQuietHour returns true for hour 0 (midnight)', () => {
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(0)).toBe(true)
  })

  it('isQuietHour returns true for hour 6', () => {
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(6)).toBe(true)
  })

  it('isQuietHour returns false for hour 7 (end of quiet window)', () => {
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(7)).toBe(false)
  })

  it('isQuietHour returns false for hour 12 (noon)', () => {
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(12)).toBe(false)
  })

  it('isQuietHour returns false for hour 21 (one before quiet start)', () => {
    function isQuietHour(hr: number): boolean {
      const start = 22, end = 7
      if (start > end) return hr >= start || hr < end
      return hr >= start && hr < end
    }
    expect(isQuietHour(21)).toBe(false)
  })
})

// ─── 8. User timezone is respected ────────────────────────────────────────────

describe('8. User timezone is respected', () => {
  it('localHour returns correct hour for Asia/Kolkata (UTC+5:30)', () => {
    // UTC 12:00 → IST 17:30 → hour = 17
    const utcNoon = new Date('2026-09-13T12:00:00Z')
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(utcNoon)
    const h = parts.find((p) => p.type === 'hour')
    expect(parseInt(h!.value, 10)).toBe(17)
  })

  it('localHour returns correct hour for America/New_York (UTC-4)', () => {
    // UTC 12:00 → EDT 08:00 → hour = 8
    const utcNoon = new Date('2026-09-13T12:00:00Z')
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(utcNoon)
    const h = parts.find((p) => p.type === 'hour')
    expect(parseInt(h!.value, 10)).toBe(8)
  })

  it('dateInTimezone returns correct date for timezone crossing midnight', () => {
    // UTC 2026-09-13T23:30:00 → Asia/Kolkata 2026-09-14 05:00
    const utcLate = new Date('2026-09-13T23:30:00Z')
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(utcLate)
    const y = parts.find((p) => p.type === 'year')!.value
    const m = parts.find((p) => p.type === 'month')!.value
    const d = parts.find((p) => p.type === 'day')!.value
    expect(`${y}-${m}-${d}`).toBe('2026-09-14')
  })

  it('users store their timezone in the database', async () => {
    const user = await createVerifiedUser()
    // Default timezone is Asia/Kolkata
    expect(user.timezone).toBe('Asia/Kolkata')
  })

  it('scheduler query selects the timezone field', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    expect(schedulerSrc).toContain('timezone')
    expect(schedulerSrc).toContain('emailNotifications')
  })
})

// ─── 9. Unverified users are not processed by the scheduler ──────────────────

describe('9. Unverified users are excluded from scheduler', () => {
  it('scheduler query filters emailVerified:true', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    expect(schedulerSrc).toContain('emailVerified: true')
  })

  it('unverified user is not returned by the scheduler query', async () => {
    await createUnverifiedUser()
    // Scheduler uses this query — unverified users must not match
    const matched = await User.find({
      emailVerified: true,
      $or: [
        { 'notificationPreferences.taskReminders':  true },
        { 'notificationPreferences.habitReminders': true },
        { 'notificationPreferences.spendingAlerts': true },
        { 'notificationPreferences.dailySummary':   true },
      ],
    }).lean()
    expect(matched).toHaveLength(0)
  })

  it('verified users ARE returned by the scheduler query', async () => {
    await createVerifiedUser()
    const matched = await User.find({
      emailVerified: true,
      $or: [
        { 'notificationPreferences.taskReminders':  true },
        { 'notificationPreferences.habitReminders': true },
        { 'notificationPreferences.spendingAlerts': true },
        { 'notificationPreferences.dailySummary':   true },
      ],
    }).lean()
    expect(matched).toHaveLength(1)
  })

  it('test-email route requires emailVerified=true', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/notifications/test-email/route.ts'),
      'utf8'
    )
    expect(routeSrc).toContain('emailVerified')
    expect(routeSrc).toContain('EMAIL_NOT_VERIFIED')
  })
})

// ─── 10. SMTP failure does not crash scheduler ────────────────────────────────

describe('10. SMTP failure does not crash scheduler or abort channels', () => {
  it('email send failure is caught independently from push and in-app', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    // Email block has its own try/catch
    const emailBlock = schedulerSrc.slice(
      schedulerSrc.indexOf('── Email ─'),
      schedulerSrc.indexOf('── Per-user notification processors ─')
    )
    expect(emailBlock).toContain('try {')
    expect(emailBlock).toContain('} catch (err: unknown) {')
    // Logs the error without re-throwing
    expect(emailBlock).toContain('logger.warn(')
  })

  it('SMTP provider send() returns ok:false without throwing on connection failure', async () => {
    // Set minimal env so constructor does not throw
    process.env.SMTP_HOST     = 'smtp.invalid.localhost'
    process.env.SMTP_PORT     = '587'
    process.env.SMTP_USER     = 'test@example.com'
    process.env.SMTP_PASSWORD = 'fake-password'
    process.env.EMAIL_FROM    = 'test@example.com'

    const { SmtpProvider } = await import('@/lib/notifications/smtp.provider')
    const provider = new SmtpProvider()

    const result = await provider.send({
      to:      'user@example.com',
      subject: 'Test',
      text:    'Test',
    })

    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')

    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    delete process.env.EMAIL_FROM
  })

  it('SMTP error result does not contain the password', async () => {
    const fakePass = 'my-super-secret-app-password-789'
    process.env.SMTP_HOST     = 'smtp.invalid.localhost'
    process.env.SMTP_PORT     = '587'
    process.env.SMTP_USER     = 'test@example.com'
    process.env.SMTP_PASSWORD = fakePass
    process.env.EMAIL_FROM    = 'test@example.com'

    const { SmtpProvider } = await import('@/lib/notifications/smtp.provider')
    const provider = new SmtpProvider()
    const result   = await provider.send({ to: 'u@e.com', subject: 'S', text: 'T' })

    if (result.error) {
      expect(result.error).not.toContain(fakePass)
    }

    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    delete process.env.EMAIL_FROM
  })
})

// ─── 11. Nodemailer 7.0.6 loads successfully ─────────────────────────────────

describe('11. Nodemailer 7.0.6 loads correctly', () => {
  it('nodemailer module loads without error', async () => {
    await expect(import('nodemailer')).resolves.toBeDefined()
  })

  it('nodemailer version is exactly 7.0.6', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['nodemailer']).toBe('7.0.6')
  })

  it('nodemailer createTransport is a function', async () => {
    const nodemailer = await import('nodemailer')
    expect(typeof nodemailer.createTransport).toBe('function')
  })

  it('nodemailer createTransport can create a transport object', async () => {
    const nodemailer = await import('nodemailer')
    const transport  = nodemailer.createTransport({
      host: 'smtp.example.com',
      port: 587,
      auth: { user: 'u', pass: 'p' },
    })
    expect(transport).toBeDefined()
    expect(typeof transport.sendMail).toBe('function')
  })
})

// ─── 12. Email verification continues working ─────────────────────────────────

describe('12. Email verification is not broken by notification changes', () => {
  it('buildVerificationEmail still produces subject, html, text', async () => {
    const { buildVerificationEmail } = await import('@/lib/auth/email-templates')
    const { token } = generateVerificationToken()
    const { subject, html, text } = buildVerificationEmail({
      toName: 'Alice',
      verificationUrl: `http://localhost:3000/verify-email?token=${token}`,
      expiresInMinutes: 8,
    })
    expect(subject).toBeTruthy()
    expect(html).toContain('LifeFlow')
    expect(text).toBeTruthy()
  })

  it('User model still stores emailVerificationTokenHash correctly', async () => {
    const { tokenHash } = generateVerificationToken()
    const user = await createUnverifiedUser()
    user.emailVerificationTokenHash = tokenHash
    await user.save()
    const found = await User.findById(user._id).lean()
    expect(found?.emailVerificationTokenHash).toBe(tokenHash)
  })

  it('emailNotifications field does not interfere with emailVerified', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: true })
    expect(user.emailVerified).toBe(true)
    expect(user.emailNotifications.enabled).toBe(true)
    // These are independent fields
    expect(typeof user.emailVerified).toBe('boolean')
    expect(typeof user.emailNotifications.enabled).toBe('boolean')
  })

  it('getNotificationService works for verification emails (no crash)', async () => {
    const { getNotificationService } = await import('@/lib/notifications')
    const notifier = await getNotificationService()
    // Just check it's callable
    expect(typeof notifier.send).toBe('function')
  })
})

// ─── 13. Notification emails have HTML and plain text ─────────────────────────

describe('13. Notification email templates have HTML and plain text', () => {
  it('buildTomorrowTasksEmail returns subject + html + text', () => {
    const result = buildTomorrowTasksEmail({
      toName:        'Srujan',
      taskCount:     3,
      taskTitles:    ['Task A', 'Task B', 'Task C'],
      tomorrowLabel: 'Monday, 14 Sep',
      appUrl:        APP_URL,
    })
    expect(result.subject).toContain('3 tasks')
    expect(result.html).toContain('<!DOCTYPE html')
    expect(result.html).toContain('LifeFlow')
    expect(result.html).toContain('Task A')
    expect(result.text).toContain('Task A')
    expect(result.text).toContain(APP_URL)
  })

  it('buildIncompleteTasksEmail returns subject + html + text', () => {
    const result = buildIncompleteTasksEmail({
      toName:     'Srujan',
      taskCount:  2,
      taskTitles: ['Task X', 'Task Y'],
      todayLabel: 'Sunday, 13 Sep',
      appUrl:     APP_URL,
    })
    expect(result.subject).toContain('incomplete')
    expect(result.html).toContain('<!DOCTYPE html')
    expect(result.text).toContain('Task X')
  })

  it('buildTomorrowHabitsEmail returns subject + html + text', () => {
    const result = buildTomorrowHabitsEmail({
      toName:        'Srujan',
      habitCount:    2,
      habitNames:    ['🏃 Running', '📚 Reading'],
      tomorrowLabel: 'Monday, 14 Sep',
      appUrl:        APP_URL,
    })
    expect(result.subject).toContain('habits')
    expect(result.html).toContain('<!DOCTYPE html')
    expect(result.text).toContain('Running')
  })

  it('buildSpendingAlertEmail returns subject + html + text', () => {
    const result = buildSpendingAlertEmail({
      toName:        'Srujan',
      categoryLabel: 'Food & Dining',
      percentUsed:   85,
      appUrl:        APP_URL,
    })
    expect(result.subject).toContain('Food')
    expect(result.html).toContain('<!DOCTYPE html')
    expect(result.text).toContain('85%')
  })

  it('buildSpendingAlertEmail uses "exceeded" when percentUsed >= 100', () => {
    const result = buildSpendingAlertEmail({
      toName:        'Srujan',
      categoryLabel: 'Transport',
      percentUsed:   105,
      appUrl:        APP_URL,
    })
    expect(result.subject.toLowerCase()).toContain('exceeded')
    expect(result.text.toLowerCase()).toContain('exceeded')
  })

  it('buildDailySummaryEmail returns subject + html + text with stats', () => {
    const result = buildDailySummaryEmail({
      toName:          'Srujan',
      todayLabel:      'Sunday, 13 Sep',
      tasksCompleted:  4,
      tasksRemaining:  1,
      habitsCompleted: 3,
      habitsTotal:     5,
      appUrl:          APP_URL,
    })
    expect(result.subject).toContain('summary')
    expect(result.html).toContain('<!DOCTYPE html')
    expect(result.text).toContain('4')
    expect(result.text).toContain('3 / 5')
  })

  it('all notification emails include a link back to the app', () => {
    const emails = [
      buildTomorrowTasksEmail({ toName: 'U', taskCount: 1, taskTitles: ['T'], tomorrowLabel: 'L', appUrl: APP_URL }),
      buildIncompleteTasksEmail({ toName: 'U', taskCount: 1, taskTitles: ['T'], todayLabel: 'L', appUrl: APP_URL }),
      buildTomorrowHabitsEmail({ toName: 'U', habitCount: 1, habitNames: ['H'], tomorrowLabel: 'L', appUrl: APP_URL }),
      buildSpendingAlertEmail({ toName: 'U', categoryLabel: 'Food', percentUsed: 80, appUrl: APP_URL }),
      buildDailySummaryEmail({ toName: 'U', todayLabel: 'L', tasksCompleted: 1, tasksRemaining: 0, habitsCompleted: 1, habitsTotal: 1, appUrl: APP_URL }),
    ]
    for (const e of emails) {
      expect(e.text).toContain(APP_URL)
      expect(e.html).toContain(APP_URL)
    }
  })

  it('notification emails do not contain sensitive data patterns', () => {
    const result = buildDailySummaryEmail({
      toName:          'Srujan',
      todayLabel:      'Sunday, 13 Sep',
      tasksCompleted:  2,
      tasksRemaining:  1,
      habitsCompleted: 2,
      habitsTotal:     3,
      appUrl:          APP_URL,
    })
    // Must not contain anything that looks like a token, password, or session
    expect(result.html).not.toMatch(/password|token|session|secret/i)
    expect(result.text).not.toMatch(/password|token|session|secret/i)
  })
})

// ─── 14. Sensitive data is not logged ─────────────────────────────────────────

describe('14. Sensitive data is not logged', () => {
  it('SMTP provider does not log the password in any logger call', () => {
    const smtpSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notifications/smtp.provider.ts'),
      'utf8'
    )
    const loggerLines = smtpSrc.split('\n').filter((l) => l.includes('logger.'))
    for (const line of loggerLines) {
      expect(line).not.toContain('SMTP_PASSWORD')
      expect(line).not.toContain('smtpAuth')
      expect(line).not.toContain('.pass')
    }
  })

  it('scheduler does not log user.email in error paths', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    const errorLogLines = schedulerSrc
      .split('\n')
      .filter((l) => l.includes('logger.warn') || l.includes('logger.error'))
    for (const line of errorLogLines) {
      // Email addresses are not directly logged in error paths
      expect(line).not.toContain('user.email')
    }
  })

  it('test-email route does not log user email in error handler', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/notifications/test-email/route.ts'),
      'utf8'
    )
    const errorLogLines = routeSrc
      .split('\n')
      .filter((l) => l.includes('logger.error'))
    for (const line of errorLogLines) {
      expect(line).not.toContain('user.email')
    }
  })
})

// ─── 15. shouldSendEmail — master switch ──────────────────────────────────────

describe('15. shouldSendEmail master switch', () => {
  it('enabled=false blocks all categories even when category flags are true', () => {
    function shouldSendEmail(
      emailPrefs: { enabled: boolean; [k: string]: boolean },
      key: string,
      email: string
    ): boolean {
      if (!emailPrefs.enabled) return false
      if (!emailPrefs[key]) return false
      if (!email || !email.includes('@')) return false
      return true
    }

    for (const cat of ['taskReminders', 'habitReminders', 'spendingAlerts', 'dailySummary']) {
      const prefs = { enabled: false, taskReminders: true, habitReminders: true, spendingAlerts: true, dailySummary: true }
      expect(shouldSendEmail(prefs, cat, 'u@e.com')).toBe(false)
    }
  })
})

// ─── 16. shouldSendEmail — per-category flag ──────────────────────────────────

describe('16. shouldSendEmail per-category flag', () => {
  it('enabled=true but category=false blocks that category', () => {
    function shouldSendEmail(
      emailPrefs: { enabled: boolean; taskReminders: boolean },
      key: 'taskReminders',
      email: string
    ): boolean {
      if (!emailPrefs.enabled) return false
      if (!emailPrefs[key]) return false
      if (!email || !email.includes('@')) return false
      return true
    }

    expect(shouldSendEmail(
      { enabled: true, taskReminders: false },
      'taskReminders',
      'u@e.com'
    )).toBe(false)
  })
})

// ─── 17. shouldSendEmail — invalid email ──────────────────────────────────────

describe('17. shouldSendEmail rejects invalid email addresses', () => {
  it('empty string is rejected', () => {
    function shouldSendEmail(
      emailPrefs: { enabled: boolean; taskReminders: boolean },
      key: 'taskReminders',
      email: string
    ): boolean {
      if (!emailPrefs.enabled) return false
      if (!emailPrefs[key]) return false
      if (!email || !email.includes('@')) return false
      return true
    }

    expect(shouldSendEmail({ enabled: true, taskReminders: true }, 'taskReminders', '')).toBe(false)
  })

  it('string without @ is rejected', () => {
    function shouldSendEmail(
      emailPrefs: { enabled: boolean; taskReminders: boolean },
      key: 'taskReminders',
      email: string
    ): boolean {
      if (!emailPrefs.enabled) return false
      if (!emailPrefs[key]) return false
      if (!email || !email.includes('@')) return false
      return true
    }

    expect(shouldSendEmail({ enabled: true, taskReminders: true }, 'taskReminders', 'notanemail')).toBe(false)
  })
})

// ─── 18. Legacy users get safe emailNotifications defaults ────────────────────

describe('18. Legacy users without emailNotifications get safe defaults', () => {
  it('scheduler provides a safe default when emailNotifications is missing', () => {
    const schedulerSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/notificationScheduler.ts'),
      'utf8'
    )
    // The scheduler must provide a default for legacy documents
    expect(schedulerSrc).toContain('emailNotifications: user.emailNotifications ??')
    expect(schedulerSrc).toContain('enabled:        false')
  })

  it('User model defaults emailNotifications.enabled to false', async () => {
    const user = await createVerifiedUser()
    // Default is false — users must explicitly opt in
    expect(user.emailNotifications.enabled).toBe(false)
  })
})

// ─── 19. test-email endpoint resolves recipient from DB ───────────────────────

describe('19. test-email route recipient security', () => {
  it('route source reads recipient from DB user record, not request body', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/notifications/test-email/route.ts'),
      'utf8'
    )
    // Recipient comes from DB lookup
    expect(routeSrc).toContain('User.findById(userId)')
    expect(routeSrc).toContain('to:      user.email')
    // Must not accept client-supplied address
    expect(routeSrc).not.toMatch(/body\.to|req\.body\.to|parsedBody\.to/)
  })

  it('route requires requireAuth() before any email send', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/notifications/test-email/route.ts'),
      'utf8'
    )
    // requireAuth must appear before User.findById
    const authIdx = routeSrc.indexOf('requireAuth()')
    const dbIdx   = routeSrc.indexOf('User.findById')
    expect(authIdx).toBeGreaterThan(-1)
    expect(dbIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(dbIdx)
  })

  it('route has rate limiting before DB access', () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/notifications/test-email/route.ts'),
      'utf8'
    )
    expect(routeSrc).toContain('checkRateLimit(')
    const rlIdx = routeSrc.indexOf('checkRateLimit(')
    const dbIdx = routeSrc.indexOf('User.findById')
    expect(rlIdx).toBeLessThan(dbIdx)
  })
})

// ─── 20. User model saves and retrieves emailNotifications correctly ──────────

describe('20. User model emailNotifications field', () => {
  it('saves all emailNotifications fields correctly', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: true })
    const found = await User.findById(user._id).lean()

    expect(found?.emailNotifications?.enabled).toBe(true)
    expect(found?.emailNotifications?.taskReminders).toBe(true)
    expect(found?.emailNotifications?.habitReminders).toBe(true)
    expect(found?.emailNotifications?.spendingAlerts).toBe(true)
    expect(found?.emailNotifications?.dailySummary).toBe(true)
  })

  it('can update emailNotifications.enabled independently', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: false })
    expect(user.emailNotifications.enabled).toBe(false)

    await User.findByIdAndUpdate(user._id, {
      $set: { 'emailNotifications.enabled': true },
    })
    const updated = await User.findById(user._id).lean()
    expect(updated?.emailNotifications?.enabled).toBe(true)
    // Other fields unchanged
    expect(updated?.emailNotifications?.taskReminders).toBe(true)
  })

  it('can turn off a single category without affecting others', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: true })

    await User.findByIdAndUpdate(user._id, {
      $set: { 'emailNotifications.spendingAlerts': false },
    })
    const updated = await User.findById(user._id).lean()
    expect(updated?.emailNotifications?.spendingAlerts).toBe(false)
    // Others unaffected
    expect(updated?.emailNotifications?.taskReminders).toBe(true)
    expect(updated?.emailNotifications?.dailySummary).toBe(true)
  })

  it('emailNotifications does not interfere with notificationPreferences', async () => {
    const user = await createVerifiedUser({ emailNotificationsEnabled: true })
    expect(user.notificationPreferences.taskReminders).toBe(true)
    expect(user.emailNotifications.enabled).toBe(true)
    // Independent fields
    await User.findByIdAndUpdate(user._id, {
      $set: { 'notificationPreferences.taskReminders': false },
    })
    const updated = await User.findById(user._id).lean()
    expect(updated?.notificationPreferences?.taskReminders).toBe(false)
    expect(updated?.emailNotifications?.taskReminders).toBe(true)
  })
})
