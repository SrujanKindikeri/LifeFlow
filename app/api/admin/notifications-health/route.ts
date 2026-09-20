/**
 * GET /api/admin/notifications-health
 *
 * Notification system health dashboard endpoint.
 *
 * Returns a real-time snapshot of every component in the notification pipeline:
 *   - Database connectivity
 *   - SMTP transport connectivity (live TCP/TLS verify, no email sent)
 *   - Nodemailer version
 *   - Worker status (inferred from last scheduler run timestamp)
 *   - NotificationLog status counts (pending / processing / sent_to_smtp / failed)
 *   - Per-type breakdown of sent notifications (last 7 days)
 *   - Last successful / failed delivery timestamps + email subject
 *   - Snapshot pipeline health (confirms emailSubject/emailBodySnapshot are populated)
 *   - Eligible user count
 *
 * SECURITY
 * ────────
 * Protected by DIAGNOSTIC_SECRET env var.
 * Returns 503 if DIAGNOSTIC_SECRET is not configured.
 * Never exposes SMTP credentials, session secrets, VAPID keys, or any PII.
 *
 * IDEMPOTENT — read-only, no writes.
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
    return { ok: false, message: `EMAIL_PROVIDER=${provider} (not smtp — skipping SMTP check)` }
  }

  const host = process.env.SMTP_HOST ?? ''
  const user = process.env.SMTP_USER ?? ''
  const pass = process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? ''
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)

  if (!host || !user || !pass) {
    return { ok: false, message: 'SMTP not fully configured (missing SMTP_HOST / SMTP_USER / SMTP_PASSWORD)' }
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
      .replace(/auth[=:\s]+\S+/gi, '[REDACTED]')
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

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!getConfiguredSecret()) {
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Set DIAGNOSTIC_SECRET to enable this endpoint.' } },
      { status: 503 }
    )
  }

  if (!isAuthorized(req)) {
    logger.warn('[notifications-health] Unauthorized', { ip: req.headers.get('x-forwarded-for') ?? 'unknown' })
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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // ── Parallel checks + aggregations ────────────────────────────────────────
  const [
    smtpResult,
    statusCounts,
    typeBreakdown,
    lastSent,
    lastFailed,
    eligibleUsers,
    mostRecentLog,
    recentEmailsWithSubject,
  ] = await Promise.all([
    checkSmtp(),

    // Status counts (last 7 days)
    dbOk
      ? NotificationLog.aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: sevenDaysAgo } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
      : Promise.resolve([]),

    // Per-type sent breakdown (last 7 days)
    dbOk
      ? NotificationLog.aggregate<{ _id: string; count: number }>([
          { $match: { status: 'sent_to_smtp', createdAt: { $gte: sevenDaysAgo } } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
      : Promise.resolve([]),

    // Most recent successful send
    dbOk
      ? NotificationLog.findOne({ status: 'sent_to_smtp' })
          .sort({ sentAt: -1 })
          .select('sentAt type emailSubject')
          .lean()
      : Promise.resolve(null),

    // Most recent failure
    dbOk
      ? NotificationLog.findOne({ status: 'failed' })
          .sort({ updatedAt: -1 })
          .select('updatedAt type')
          .lean()
      : Promise.resolve(null),

    // Eligible user count
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

    // Most recent log entry of any status (worker liveness)
    dbOk
      ? NotificationLog.findOne().sort({ createdAt: -1 }).select('createdAt status').lean()
      : Promise.resolve(null),

    // Recent emails with subject snapshot (proves pipeline is populating new fields)
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
  ])

  // ── Status counts ──────────────────────────────────────────────────────────
  const counts: Record<string, number> = { pending: 0, processing: 0, sent_to_smtp: 0, failed: 0 }
  for (const row of statusCounts) counts[row._id] = row.count

  // ── Per-type labels ────────────────────────────────────────────────────────
  const TYPE_LABELS: Record<string, string> = {
    MORNING_BRIEF:         'Morning Daily Brief',
    TASK_DUE_SOON:         'Task Reminder',
    TASK_INCOMPLETE_TODAY: 'Incomplete Tasks',
    TASK_TOMORROW:         'Tomorrow Preview',
    HABIT_REMINDER:        'Habit Reminder',
    HABIT_TOMORROW:        'Tomorrow Habits',
    DAILY_SUMMARY:         'Daily Summary',
    WEEKLY_SUMMARY:        'Weekly Summary',
    SPENDING_ALERT:        'Spending Alert',
  }

  const sentByType = Object.fromEntries(
    typeBreakdown.map((r) => [r._id, { label: TYPE_LABELS[r._id] ?? r._id, count: r.count }])
  )

  // ── Worker liveness heuristic ──────────────────────────────────────────────
  let workerStatus = 'UNKNOWN'
  let lastRunUtc: string | null = null

  if (dbOk && mostRecentLog) {
    const createdAt  = (mostRecentLog as { createdAt: Date }).createdAt
    lastRunUtc       = createdAt.toISOString()
    const ageMinutes = (Date.now() - createdAt.getTime()) / 60_000
    workerStatus     = ageMinutes < 10
      ? `RUNNING (last activity ${Math.round(ageMinutes * 10) / 10}m ago)`
      : `POSSIBLY STOPPED (last activity ${Math.round(ageMinutes)}m ago)`
  } else if (dbOk) {
    workerStatus = 'NO ACTIVITY YET'
  }

  // ── Snapshot pipeline health ───────────────────────────────────────────────
  type EmailDoc = { type?: string; emailSubject?: string | null; sentAt?: Date }
  const snapshotDocs   = recentEmailsWithSubject as EmailDoc[]
  const snapshotOk     = snapshotDocs.length > 0

  // ── Config flags ───────────────────────────────────────────────────────────
  const schedulerSecretSet  = !!(process.env.SCHEDULER_SECRET || process.env.CRON_SECRET)
  const diagnosticSecretSet = !!process.env.DIAGNOSTIC_SECRET
  const emailProvider       = process.env.EMAIL_PROVIDER ?? 'none'
  const smtpConfigured      = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)
  const vapidConfigured     = !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  const defaultTimezone     = process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata'
  const graceSeconds        = parseInt(process.env.PRECISE_GRACE_SECONDS ?? '90', 10)

  const durationMs = Date.now() - t0

  logger.info('[notifications-health] Health check completed', { dbOk, smtpOk: smtpResult.ok, eligibleUsers, durationMs })

  type LastSentDoc   = { sentAt?: Date; type?: string; emailSubject?: string | null }
  type LastFailedDoc = { updatedAt?: Date; type?: string }

  return NextResponse.json({
    ok:        dbOk && smtpResult.ok,
    checkedAt: new Date().toISOString(),
    durationMs,

    components: {
      database: {
        status:  dbOk ? 'CONNECTED' : 'FAILED',
        message: dbMsg,
      },
      smtp: {
        status:     smtpResult.ok ? 'CONNECTED' : 'FAILED',
        message:    smtpResult.message,
        host:       process.env.SMTP_HOST ?? '(not set)',
        port:       process.env.SMTP_PORT ?? '587',
        configured: smtpConfigured,
      },
      nodemailer: {
        version: getNodemailerVersion(),
      },
      worker: {
        status:     workerStatus,
        lastRunUtc,
      },
      snapshotPipeline: {
        ok:      snapshotOk,
        message: snapshotOk
          ? `${snapshotDocs.length} recent email(s) have emailSubject snapshots stored`
          : 'No emails with subject snapshots yet — expected after first send post-deploy',
        recentEmails: snapshotDocs.map((e) => ({
          type:         e.type         ?? null,
          emailSubject: e.emailSubject ?? null,
          sentAt:       e.sentAt       ? e.sentAt.toISOString() : null,
        })),
      },
    },

    configuration: {
      emailProvider,
      smtpConfigured,
      vapidConfigured,
      schedulerSecretSet,
      diagnosticSecretSet,
      defaultTimezone,
      graceSeconds,
    },

    notificationLog: {
      last7Days: {
        pending:    counts.pending,
        processing: counts.processing,
        sent:       counts.sent_to_smtp,
        failed:     counts.failed,
      },
      sentByType,
      lastSuccessfulDelivery: lastSent
        ? {
            sentAt:       (lastSent as LastSentDoc).sentAt?.toISOString()   ?? null,
            type:         (lastSent as LastSentDoc).type                    ?? null,
            emailSubject: (lastSent as LastSentDoc).emailSubject            ?? null,
          }
        : null,
      lastFailedDelivery: lastFailed
        ? {
            failedAt: (lastFailed as LastFailedDoc).updatedAt?.toISOString() ?? null,
            type:     (lastFailed as LastFailedDoc).type                     ?? null,
          }
        : null,
    },

    users: {
      eligibleForNotifications: eligibleUsers,
    },
  }, { status: 200 })
}
