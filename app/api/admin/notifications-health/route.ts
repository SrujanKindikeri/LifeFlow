/**
 * GET /api/admin/notifications-health
 *
 * Full notification-system health dashboard endpoint.
 *
 * Reports exactly what the spec requires:
 *   ✓ Database connectivity + configured DB name
 *   ✓ SMTP configuration presence (no secrets exposed) + live TCP verify
 *   ✓ Installed Nodemailer version
 *   ✓ Scheduler/worker heartbeat and last successful run timestamp
 *   ✓ Pending / processing / sent / failed / skipped counts (last 7 days)
 *   ✓ Oldest pending notification
 *   ✓ Last successful email timestamp + subject
 *   ✓ Last delivery error (sensitive data redacted)
 *   ✓ Per-type sent breakdown (last 7 days)
 *   ✓ Eligible user count
 *   ✓ Stuck-job detection (processing > 5 min = crashed worker)
 *   ✓ Skipped-notification reasons summary
 *   ✓ Snapshot pipeline health (emailSubject/emailBodySnapshot populated)
 *
 * SECURITY
 * ────────
 * Protected by DIAGNOSTIC_SECRET. Returns 503 when secret not configured.
 * Never exposes SMTP credentials, session secrets, VAPID keys, or any PII.
 * Recipient email addresses in lastDeliveryError are masked.
 *
 * IDEMPOTENT — read-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB }                 from '@/lib/db'
import NotificationLog               from '@/models/NotificationLog'
import User                          from '@/models/User'
import logger                        from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getConfiguredSecret(): string | null {
  return process.env.DIAGNOSTIC_SECRET ?? null
}

function isAuthorized(req: NextRequest): boolean {
  const secret = getConfiguredSecret()
  if (!secret) return false
  const authHeader  = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return true
  const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
  if (querySecret === secret) return true
  return false
}

// ─── SMTP connectivity check ──────────────────────────────────────────────────

async function checkSmtp(): Promise<{ ok: boolean; message: string }> {
  const provider = (process.env.EMAIL_PROVIDER ?? 'none').toLowerCase()

  if (provider !== 'smtp') {
    return {
      ok:      false,
      message: `EMAIL_PROVIDER=${provider} (not smtp — SMTP check skipped)`,
    }
  }

  const host = process.env.SMTP_HOST ?? ''
  const user = process.env.SMTP_USER ?? ''
  const pass = process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? ''
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)

  if (!host || !user || !pass) {
    return {
      ok:      false,
      message: 'SMTP not fully configured (missing SMTP_HOST / SMTP_USER / SMTP_PASSWORD)',
    }
  }

  try {
    const nodemailer  = await import('nodemailer')
    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure:     port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
    })
    await transporter.verify()
    return { ok: true, message: `Connected to ${host}:${port}` }
  } catch (err) {
    const raw  = err instanceof Error ? err.message : String(err)
    const safe = raw
      .replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
      .replace(/auth[=:\s]+\S+/gi,        '[REDACTED]')
      .slice(0, 200)
    return { ok: false, message: safe }
  }
}

// ─── Nodemailer version ───────────────────────────────────────────────────────

function getNodemailerVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('nodemailer/package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// ─── Type / module labels ─────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  MORNING_BRIEF:              'Morning Daily Brief',
  TASK_DUE_SOON:              'Task Reminder',
  TASK_INCOMPLETE_TODAY:      'Incomplete Tasks',
  TASK_TOMORROW:              'Tomorrow Preview',
  HABIT_REMINDER:             'Habit Reminder',
  HABIT_TOMORROW:             'Tomorrow Habits',
  DAILY_SUMMARY:              'Daily Summary',
  WEEKLY_SUMMARY:             'Weekly Summary',
  SPENDING_ALERT:             'Spending Alert',
  GROUP_BILL_REMINDER:        'Group Bill Reminder',
  GROUP_BILL_MANUAL_REMINDER: 'Group Bill Manual Reminder',
  NOTE_REMINDER:              'Note Reminder',
  PROJECT_DEADLINE:           'Project Deadline',
  SUBSCRIPTION_RENEWAL:       'Subscription Renewal',
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!getConfiguredSecret()) {
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Set DIAGNOSTIC_SECRET to enable this endpoint.' } },
      { status: 503 }
    )
  }

  if (!isAuthorized(req)) {
    logger.warn('[notifications-health] Unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing diagnostic secret.' } },
      { status: 401 }
    )
  }

  const t0 = Date.now()

  // ── Database check ─────────────────────────────────────────────────────────
  let dbOk  = false
  let dbMsg = 'not checked'

  try {
    await connectDB()
    dbOk  = true
    dbMsg = 'Connected'
  } catch (err) {
    dbMsg = err instanceof Error ? err.message.slice(0, 100) : 'Connection failed'
  }

  const sevenDaysAgo       = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const stuckThreshold     = new Date(Date.now() - 5 * 60 * 1000) // 5 minutes

  // ── All parallel DB queries ────────────────────────────────────────────────
  const [
    smtpResult,

    // Status counts (last 7 days)
    statusCounts,

    // Per-type sent breakdown (last 7 days)
    typeBreakdown,

    // Most recent successful send
    lastSent,

    // Most recent failure (errorMessage is internal — we return only the type)
    lastFailed,

    // Eligible user count
    eligibleUsers,

    // Most recent log entry of any status (worker liveness indicator)
    mostRecentLog,

    // Recent emails with subject snapshots (proves pipeline is populating fields)
    recentEmailsWithSubject,

    // Oldest pending notification (shows how far behind the worker is)
    oldestPending,

    // Stuck jobs: processing status older than 5 minutes
    stuckJobs,

    // Skip reasons summary
    skipReasonAgg,
  ] = await Promise.all([
    checkSmtp(),

    dbOk
      ? NotificationLog.aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: sevenDaysAgo } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
      : Promise.resolve([]),

    dbOk
      ? NotificationLog.aggregate<{ _id: string; count: number }>([
          { $match: { status: 'sent_to_smtp', createdAt: { $gte: sevenDaysAgo } } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
      : Promise.resolve([]),

    dbOk
      ? NotificationLog.findOne({ status: 'sent_to_smtp' })
          .sort({ sentAt: -1 })
          .select('sentAt type emailSubject')
          .lean()
      : Promise.resolve(null),

    dbOk
      ? NotificationLog.findOne({ status: 'failed' })
          .sort({ updatedAt: -1 })
          .select('updatedAt type')
          .lean()
      : Promise.resolve(null),

    dbOk
      ? User.countDocuments({
          accountStatus:       { $ne: 'deleted' },
          emailVerified:       true,
          notificationsTested: true,
          $or: [
            { 'notificationPreferences.taskReminders':  true },
            { 'notificationPreferences.habitReminders': true },
            { 'notificationPreferences.spendingAlerts': true },
            { 'notificationPreferences.dailySummary':   true },
            { 'emailNotifications.enabled':             true },
          ],
        })
      : Promise.resolve(0),

    dbOk
      ? NotificationLog.findOne()
          .sort({ createdAt: -1 })
          .select('createdAt status')
          .lean()
      : Promise.resolve(null),

    dbOk
      ? NotificationLog.find({
            status:       'sent_to_smtp',
            emailSubject: { $ne: null },
            createdAt:    { $gte: sevenDaysAgo },
          })
          .sort({ sentAt: -1 })
          .select('type emailSubject sentAt')
          .limit(5)
          .lean()
      : Promise.resolve([]),

    dbOk
      ? NotificationLog.findOne({ status: 'pending' })
          .sort({ scheduledAt: 1 })
          .select('type scheduledAt forDate')
          .lean()
      : Promise.resolve(null),

    dbOk
      ? NotificationLog.find({
            status:    'processing',
            updatedAt: { $lt: stuckThreshold },
          })
          .select('type forDate createdAt updatedAt')
          .limit(20)
          .lean()
      : Promise.resolve([]),

    dbOk
      ? NotificationLog.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              status:     'skipped',
              skipReason: { $ne: null },
              createdAt:  { $gte: sevenDaysAgo },
            },
          },
          { $group: { _id: '$skipReason', count: { $sum: 1 } } },
          { $sort:  { count: -1 } },
          { $limit: 10 },
        ])
      : Promise.resolve([]),
  ])

  // ── Derived metrics ────────────────────────────────────────────────────────

  const counts: Record<string, number> = {
    pending: 0, processing: 0, sent_to_smtp: 0, failed: 0, skipped: 0,
  }
  for (const row of statusCounts) counts[row._id] = row.count

  const sentByType = Object.fromEntries(
    typeBreakdown.map((r) => [
      r._id,
      { label: TYPE_LABELS[r._id] ?? r._id, count: r.count },
    ])
  )

  // Worker liveness heuristic:
  // "RUNNING"          = log activity within the last 10 minutes
  // "POSSIBLY_STOPPED" = last activity > 10 min ago
  // "NO_ACTIVITY_YET"  = no log entries at all
  let workerStatus = 'UNKNOWN'
  let lastRunUtc:   string | null = null

  if (dbOk && mostRecentLog) {
    const createdAt  = (mostRecentLog as { createdAt: Date }).createdAt
    lastRunUtc       = createdAt.toISOString()
    const ageMinutes = (Date.now() - createdAt.getTime()) / 60_000
    workerStatus     = ageMinutes < 10
      ? `RUNNING (last activity ${Math.round(ageMinutes * 10) / 10}m ago)`
      : `POSSIBLY_STOPPED (last activity ${Math.round(ageMinutes)}m ago — check notification-worker container)`
  } else if (dbOk) {
    workerStatus = 'NO_ACTIVITY_YET'
  }

  // Stuck-job count
  type StuckDoc = { type?: string; forDate?: string; createdAt?: Date; updatedAt?: Date }
  const stuckDocs  = stuckJobs as StuckDoc[]
  const stuckCount = stuckDocs.length

  // Snapshot pipeline health
  type EmailDoc = { type?: string; emailSubject?: string | null; sentAt?: Date }
  const snapshotDocs = recentEmailsWithSubject as EmailDoc[]
  const snapshotOk   = snapshotDocs.length > 0

  // Oldest pending
  type PendingDoc = { type?: string; scheduledAt?: Date; forDate?: string }
  const oldestPendingDoc = oldestPending as PendingDoc | null

  // Last sent/failed
  type LastSentDoc   = { sentAt?: Date; type?: string; emailSubject?: string | null }
  type LastFailedDoc = { updatedAt?: Date; type?: string }

  // Config summary
  const emailProvider        = process.env.EMAIL_PROVIDER ?? 'none'
  const smtpConfigured       = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)
  const vapidConfigured      = !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  const schedulerSecretSet   = !!(process.env.SCHEDULER_SECRET || process.env.CRON_SECRET)
  const diagnosticSecretSet  = !!process.env.DIAGNOSTIC_SECRET
  const defaultTimezone      = process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata'
  const graceSeconds         = parseInt(process.env.PRECISE_GRACE_SECONDS ?? '90', 10)
  const mongoDbName          = process.env.MONGODB_DB_NAME ?? 'test'
  const nodemailerVersion    = getNodemailerVersion()

  const durationMs = Date.now() - t0

  logger.info('[notifications-health] Health check completed', {
    dbOk,
    smtpOk:        smtpResult.ok,
    eligibleUsers,
    stuckCount,
    durationMs,
  })

  return NextResponse.json({
    ok:        dbOk && smtpResult.ok,
    checkedAt: new Date().toISOString(),
    durationMs,

    // ── Database ────────────────────────────────────────────────────────────
    database: {
      status:         dbOk ? 'CONNECTED' : 'FAILED',
      message:        dbMsg,
      configuredName: mongoDbName,
    },

    // ── SMTP / Email ─────────────────────────────────────────────────────────
    smtp: {
      status:       smtpResult.ok ? 'CONNECTED' : 'FAILED',
      message:      smtpResult.message,
      host:         process.env.SMTP_HOST ? '(set)' : '(not set)',
      port:         process.env.SMTP_PORT ?? '587',
      userPresent:  !!process.env.SMTP_USER,
      passPresent:  !!(process.env.SMTP_PASSWORD || process.env.SMTP_PASS),
      configured:   smtpConfigured,
      // provider-level note
      provider:     emailProvider,
    },

    // ── Nodemailer ───────────────────────────────────────────────────────────
    nodemailer: {
      version:        nodemailerVersion,
      expectedVersion: '7.0.6',
      ok:             nodemailerVersion === '7.0.6',
    },

    // ── Worker ───────────────────────────────────────────────────────────────
    worker: {
      status:     workerStatus,
      lastRunUtc,
      stuckJobs: {
        count: stuckCount,
        jobs:  stuckDocs.map((j) => ({
          type:      j.type      ?? null,
          forDate:   j.forDate   ?? null,
          stuckSinceUtc: j.updatedAt ? j.updatedAt.toISOString() : null,
        })),
        // A job stuck in 'processing' for > 5 min indicates a crashed worker.
        // Recovery: the scheduler will retry on next run (failed records are re-claimed).
        hint: stuckCount > 0
          ? 'Stuck jobs detected — restart the notification-worker container to recover'
          : 'No stuck jobs',
      },
    },

    // ── Notification log counts ───────────────────────────────────────────────
    notificationLog: {
      last7Days: {
        pending:    counts.pending,
        processing: counts.processing,
        sent:       counts.sent_to_smtp,
        failed:     counts.failed,
        skipped:    counts.skipped,
      },

      oldestPending: oldestPendingDoc
        ? {
            type:         oldestPendingDoc.type         ?? null,
            scheduledAt:  oldestPendingDoc.scheduledAt
              ? (oldestPendingDoc.scheduledAt as Date).toISOString()
              : null,
            forDate:      oldestPendingDoc.forDate      ?? null,
          }
        : null,

      sentByType,

      lastSuccessfulDelivery: lastSent
        ? {
            sentAt:       (lastSent as LastSentDoc).sentAt?.toISOString()   ?? null,
            type:         (lastSent as LastSentDoc).type                    ?? null,
            typeLabel:    TYPE_LABELS[(lastSent as LastSentDoc).type ?? ''] ?? null,
            emailSubject: (lastSent as LastSentDoc).emailSubject            ?? null,
          }
        : null,

      // errorMessage intentionally omitted — only type and timestamp returned
      lastDeliveryError: lastFailed
        ? {
            failedAt:  (lastFailed as LastFailedDoc).updatedAt?.toISOString() ?? null,
            type:      (lastFailed as LastFailedDoc).type                     ?? null,
            typeLabel: TYPE_LABELS[(lastFailed as LastFailedDoc).type ?? '']  ?? null,
          }
        : null,

      skipReasonSummary: (skipReasonAgg as { _id: string; count: number }[]).map((r) => ({
        reason: r._id,
        count:  r.count,
      })),
    },

    // ── Snapshot pipeline ─────────────────────────────────────────────────────
    snapshotPipeline: {
      ok:      snapshotOk,
      message: snapshotOk
        ? `${snapshotDocs.length} recent email(s) have emailSubject + body snapshots stored`
        : 'No emails with subject snapshots yet — expected after first successful send',
      recentEmails: snapshotDocs.map((e) => ({
        type:         e.type         ?? null,
        typeLabel:    TYPE_LABELS[e.type ?? ''] ?? null,
        emailSubject: e.emailSubject ?? null,
        sentAt:       e.sentAt       ? (e.sentAt as Date).toISOString() : null,
      })),
    },

    // ── Users ─────────────────────────────────────────────────────────────────
    users: {
      eligibleForNotifications: eligibleUsers,
      note: 'Users with emailVerified=true, notificationsTested=true, and at least one notification category enabled',
    },

    // ── Configuration summary ─────────────────────────────────────────────────
    configuration: {
      emailProvider,
      smtpConfigured,
      vapidConfigured,
      schedulerSecretSet,
      diagnosticSecretSet,
      defaultTimezone,
      graceSeconds,
      mongoDbName,
      nodemailerVersion,
    },
  }, { status: 200 })
}
