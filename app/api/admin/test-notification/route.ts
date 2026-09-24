/**
 * POST /api/admin/test-notification
 *
 * Admin/developer-only endpoint that schedules a REAL notification for delivery
 * in approximately 20 seconds, using the actual production notification pipeline.
 *
 * This is NOT a fake test path — it creates a real NotificationLog entry and
 * the notification worker picks it up and delivers it through the full pipeline:
 *
 *   POST here
 *     → NotificationLog created with scheduledAt = now + 20s, status='pending'
 *     → worker polls process-notifications-precise
 *     → scheduler finds the log entry within grace window
 *     → email + in-app + push attempted
 *     → NotificationLog updated to 'sent_to_smtp'
 *
 * The test uses the MORNING_BRIEF type so the full email template is exercised.
 * It bypasses the regular time-window checks by directly inserting a log record
 * and scheduling a forced run via the /api/jobs/process-notifications-precise
 * endpoint after the delay.
 *
 * SECURITY
 * ────────
 * Protected by DIAGNOSTIC_SECRET env var.
 * The test email is ALWAYS sent to the specified userId's registered email
 * from the database — never to an arbitrary address.
 * SMTP credentials are never logged or returned.
 *
 * USAGE
 * ─────
 * curl -X POST https://<domain>/api/admin/test-notification \
 *   -H "Authorization: Bearer $DIAGNOSTIC_SECRET" \
 *   -H "Content-Type: application/json" \
 *   -d '{"userId": "<mongoId>", "delaySeconds": 20}'
 *
 * Or without userId to target the first eligible user:
 *   -d '{"delaySeconds": 20}'
 */

import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB }   from '@/lib/db'
import User            from '@/models/User'
import NotificationLog from '@/models/NotificationLog'
import logger          from '@/lib/logger'
import { getAppUrl }  from '@/lib/env'

export const dynamic = 'force-dynamic'

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!getConfiguredSecret()) {
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Set DIAGNOSTIC_SECRET to enable this endpoint.' } },
      { status: 503 }
    )
  }

  if (!isAuthorized(req)) {
    logger.warn('[admin/test-notification] Unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing diagnostic secret.' } },
      { status: 401 }
    )
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { userId?: string; delaySeconds?: number } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const delaySeconds = Math.max(5, Math.min(300, body.delaySeconds ?? 20))

  await connectDB()

  // ── Resolve target user ────────────────────────────────────────────────────
  // Always sourced from DB — never from client
  let user: {
    _id: mongoose.Types.ObjectId
    name: string
    email: string
    timezone: string
    notificationsTested: boolean
    emailNotifications: { enabled: boolean }
  } | null = null

  if (body.userId && mongoose.Types.ObjectId.isValid(body.userId)) {
    user = await User.findById(body.userId)
      .select('name email timezone notificationsTested emailNotifications')
      .lean()
  }

  if (!user) {
    // Fall back to first eligible user
    user = await User.findOne({
      accountStatus:       { $ne: 'deleted' },
      emailVerified:       true,
      notificationsTested: true,
      'emailNotifications.enabled': true,
    })
      .select('name email timezone notificationsTested emailNotifications')
      .lean()
  }

  if (!user) {
    return NextResponse.json(
      {
        error: {
          code:    'NO_ELIGIBLE_USER',
          message: 'No eligible user found. Ensure at least one user has notificationsTested=true and emailNotifications.enabled=true.',
        },
      },
      { status: 404 }
    )
  }

  const userId    = user._id
  const scheduledAt = new Date(Date.now() + delaySeconds * 1000)

  // ── Build the test key ─────────────────────────────────────────────────────
  // Use a unique discriminator so repeated calls don't conflict
  const testDiscriminator = `admin-test-${Date.now()}`
  const today = new Date().toISOString().split('T')[0]
  const key   = `${userId.toString()}:MORNING_BRIEF:${today}:${testDiscriminator}`

  // ── Insert the pending log entry directly ──────────────────────────────────
  // The scheduler worker will pick this up within its next poll cycle
  // once scheduledAt <= now (within the grace window).
  //
  // We insert directly rather than going through the normal checkAndRecord()
  // path so we can control the scheduledAt timestamp precisely.
  try {
    await NotificationLog.create({
      key,
      userId,
      type:           'MORNING_BRIEF',
      forDate:        today,
      scheduledAt,
      status:         'pending',
      contentPreview: `Admin test notification — scheduled for T+${delaySeconds}s`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: `Failed to create test log entry: ${msg.slice(0, 200)}` } },
      { status: 500 }
    )
  }

  logger.info('[admin/test-notification] Test notification scheduled', {
    userId:      userId.toString(),
    scheduledAt: scheduledAt.toISOString(),
    delaySeconds,
    key,
  })

  // ── Optionally trigger the scheduler endpoint after the delay ──────────────
  // This fires a background task — we don't await it so the HTTP response
  // returns immediately.  The worker will also pick it up naturally.
  const appUrl          = getAppUrl()
  const schedulerSecret = process.env.SCHEDULER_SECRET || process.env.CRON_SECRET || ''

  if (schedulerSecret) {
    setTimeout(async () => {
      try {
        await fetch(`${appUrl}/api/jobs/process-notifications-precise`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${schedulerSecret}`,
            'Content-Type':  'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        })
        logger.info('[admin/test-notification] Triggered scheduler after delay', { delaySeconds })
      } catch (err) {
        logger.warn('[admin/test-notification] Could not trigger scheduler (worker will pick up naturally)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, delaySeconds * 1000)
  }

  return NextResponse.json(
    {
      ok:           true,
      message:      `Test notification scheduled for ${delaySeconds}s from now. The worker will deliver it automatically.`,
      scheduledAt:  scheduledAt.toISOString(),
      delaySeconds,
      targetUserId: userId.toString(),
      // Never return the target email address to the client
      logKey:       key,
      pipeline: [
        `T+0s      NotificationLog created (status=pending)`,
        `T+${delaySeconds}s  worker detects scheduledAt <= now`,
        `T+${delaySeconds}–${delaySeconds + 5}s  email attempted via SMTP`,
        `T+${delaySeconds + 5}s  NotificationLog updated to sent_to_smtp`,
        `T+${delaySeconds + 5}s  in-app Notification created`,
      ],
    },
    { status: 200 }
  )
}
