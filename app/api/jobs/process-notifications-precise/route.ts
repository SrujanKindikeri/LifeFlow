/**
 * POST /api/jobs/process-notifications-precise
 * GET  /api/jobs/process-notifications-precise
 *
 * Precise notification scheduler endpoint — designed to be called every
 * 1–5 minutes so notifications fire within seconds of their scheduled UTC time.
 *
 * DESIGN DIFFERENCE FROM /api/jobs/process-notifications
 * ────────────────────────────────────────────────────────
 * The standard hourly endpoint uses a ±60-minute grace window, meaning a
 * notification scheduled at 7:00 AM is delivered any time between 7:00 and
 * 8:00 AM.  This endpoint passes graceSeconds=90, meaning:
 *
 *   • A notification fires at most 90 seconds after its exact scheduled UTC.
 *   • If the server was offline during the 90-second window, the notification
 *     is treated as MISSED (not sent late — that would be misleading).
 *   • Deduplication is identical — the unique MongoDB key ensures the same
 *     notification is never sent twice even if this endpoint is called
 *     concurrently from multiple workers.
 *
 * EXAMPLE TIMING
 * ──────────────
 * User: Asia/Kolkata, task due 10:30 AM IST → reminder at 10:00 AM IST
 *   10:00:00 AM IST = 04:30:00 UTC
 *   Endpoint called at 04:30:05 UTC → within grace → notification fires ✓
 *   Endpoint called at 04:29:50 UTC → before target → not yet ✗
 *   Endpoint called at 04:32:00 UTC → 120s after → missed → not sent ✗
 *
 * MISSED NOTIFICATION POLICY
 * ──────────────────────────
 * Task due-soon reminders: if the server was down during the 90-second window,
 * the reminder is silently skipped.  The 7 PM incomplete-tasks summary will
 * surface any uncompleted tasks that evening.
 *
 * Daily/weekly summaries: a separate 90-second window at 7 AM, 7 PM, 10 PM,
 * 11:55 PM, Sunday 10 PM respectively.  The hourly endpoint serves as a
 * safety net if the precise endpoint misses a window.
 *
 * AUTHENTICATION
 * ──────────────
 * Uses the same SCHEDULER_SECRET / CRON_SECRET as the hourly endpoint.
 * No new secret required.
 *
 * CRON SETUP (EC2 / Docker / cron-job.org)
 * ─────────────────────────────────────────
 * Run every minute:
 *   * * * * * curl -s -X POST https://<domain>/api/jobs/process-notifications-precise \
 *     -H "Authorization: Bearer $SCHEDULER_SECRET" > /dev/null
 *
 * Or every 5 minutes (slightly less precise but still suitable):
 *   * /5 * * * * curl -s ...
 *
 * NOTE: Vercel Cron supports minimum 1-minute intervals on Pro plans.
 * On Hobby plans (1-hour minimum), use only the standard hourly endpoint.
 *
 * IDEMPOTENCY
 * ───────────
 * Fully idempotent.  Concurrent calls from multiple workers are safe via
 * MongoDB's unique key index.  Docker restarts, EC2 reboots, and scheduler
 * crashes do not cause duplicate sends.
 *
 * ISOLATION FROM EMAIL VERIFICATION
 * ──────────────────────────────────
 * This route never touches verification tokens, verification emails, or any
 * auth flow.  Email verification is exclusively owned by auth routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runNotificationScheduler } from '@/lib/notificationScheduler'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getConfiguredSecret(): string | null {
  return (
    process.env.SCHEDULER_SECRET ||
    process.env.CRON_SECRET ||
    null
  )
}

function isAuthorized(req: NextRequest): boolean {
  const secret = getConfiguredSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return true

  const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
  if (querySecret === secret) return true

  return false
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Grace window for the precise endpoint.
 *
 * 90 seconds: notifications fire within 90 s of their scheduled UTC time.
 * If the cron runs every 60 s, a notification is guaranteed to fire within
 * the window as long as the server is up.  If the cron runs every 5 min,
 * the grace window should be raised to 330 s to avoid misses.
 *
 * Controlled by the PRECISE_GRACE_SECONDS environment variable so operators
 * can tune it without a deploy.  Default: 90.
 */
function getGraceSeconds(): number {
  const raw = parseInt(process.env.PRECISE_GRACE_SECONDS ?? '90', 10)
  if (isNaN(raw) || raw < 30) return 90
  if (raw > 600) return 600  // cap at 10 minutes
  return raw
}

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now()

  // ── Config guard ────────────────────────────────────────────────────────────
  if (!getConfiguredSecret()) {
    logger.error('[jobs/process-notifications-precise] No scheduler secret configured')
    return NextResponse.json(
      {
        error: {
          code:    'SERVICE_UNAVAILABLE',
          message: 'Scheduler secret not configured. Set SCHEDULER_SECRET or CRON_SECRET.',
        },
      },
      { status: 503 }
    )
  }

  // ── Auth guard ──────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    logger.warn('[jobs/process-notifications-precise] Unauthorized request', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing scheduler secret.' } },
      { status: 401 }
    )
  }

  const graceSeconds = getGraceSeconds()

  // ── Run scheduler with precise grace window ─────────────────────────────────
  try {
    const result = await runNotificationScheduler(graceSeconds)
    const durationMs = Date.now() - t0

    logger.info('[jobs/process-notifications-precise] Run complete', {
      usersProcessed: result.usersProcessed,
      totalSent:      result.totalSent,
      totalSkipped:   result.totalSkipped,
      errorCount:     result.errors.length,
      graceSeconds,
      durationMs,
    })

    return NextResponse.json(
      {
        ok: true,
        graceSeconds,
        result: {
          usersProcessed: result.usersProcessed,
          totalSent:      result.totalSent,
          totalSkipped:   result.totalSkipped,
          errorCount:     result.errors.length,
          errors:         result.errors.slice(0, 20),
          durationMs,
        },
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[jobs/process-notifications-precise] Fatal error', { errorMessage })

    return NextResponse.json(
      {
        error: {
          code:    'INTERNAL_ERROR',
          message: 'Notification scheduler failed. Check server logs.',
        },
      },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest)  { return handleRequest(req) }
export async function POST(req: NextRequest) { return handleRequest(req) }
