/**
 * POST /api/jobs/process-notifications
 * GET  /api/jobs/process-notifications
 *
 * Scheduled job endpoint that runs the notification scheduler for all users.
 *
 * DESIGN
 * ──────
 * Mirrors the pattern established by /api/jobs/process-subscriptions:
 *   - Accepts both GET and POST so all scheduler types work (Vercel Cron,
 *     AWS EventBridge, Azure Logic Apps, cron-job.org, curl, etc.)
 *   - Protected by SCHEDULER_SECRET / CRON_SECRET — same secret used by the
 *     subscription scheduler; no new secret needed.
 *   - Returns 503 if neither secret is configured.
 *   - Delegates all logic to lib/notificationScheduler.ts.
 *   - Safe to call any number of times — the scheduler is fully idempotent.
 *
 * AUTHENTICATION
 * ──────────────
 * Pass the secret via one of:
 *   Authorization: Bearer <SCHEDULER_SECRET>   (recommended)
 *   ?secret=<SCHEDULER_SECRET>                 (for schedulers that can't set headers)
 *
 * SCHEDULING RECOMMENDATIONS
 * ──────────────────────────
 * Run this job every hour so notifications are delivered within their
 * intended time windows (morning summary 08–10, evening task reminder 18–21,
 * etc.).  The scheduler's internal time-window checks ensure each notification
 * is sent exactly once per day regardless of how often this endpoint is called.
 *
 * Vercel Cron (vercel.json):
 *   { "path": "/api/jobs/process-notifications", "schedule": "0 * * * *" }
 *
 * AWS EventBridge / Azure Logic Apps:
 *   Schedule to call this URL every hour with the Authorization header.
 *
 * EC2 / Azure VM crontab (runs every hour):
 *   0 * * * * curl -s -X POST https://<your-domain>/api/jobs/process-notifications \
 *     -H "Authorization: Bearer $SCHEDULER_SECRET" > /dev/null
 *
 * ISOLATION FROM EMAIL VERIFICATION
 * ──────────────────────────────────
 * This route calls runNotificationScheduler() which only handles user-facing
 * reminders (tasks, habits, spending, daily summary).  It never touches
 * verification tokens, verification emails, or any auth flow.
 * Email verification remains exclusively owned by:
 *   POST /api/auth/signup
 *   POST /api/auth/resend-verification
 *   GET  /api/auth/verify-email
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

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now()

  // ── Config guard ────────────────────────────────────────────────────────────
  if (!getConfiguredSecret()) {
    logger.error('[jobs/process-notifications] No scheduler secret configured')
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
    logger.warn('[jobs/process-notifications] Unauthorized request', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing scheduler secret.' } },
      { status: 401 }
    )
  }

  // ── Run scheduler ───────────────────────────────────────────────────────────
  try {
    const result = await runNotificationScheduler()
    const durationMs = Date.now() - t0

    logger.info('[jobs/process-notifications] Run complete', {
      usersProcessed: result.usersProcessed,
      totalSent:      result.totalSent,
      totalSkipped:   result.totalSkipped,
      errorCount:     result.errors.length,
      durationMs,
    })

    return NextResponse.json(
      {
        ok: true,
        result: {
          usersProcessed: result.usersProcessed,
          totalSent:      result.totalSent,
          totalSkipped:   result.totalSkipped,
          errorCount:     result.errors.length,
          // Include sanitised errors (no secrets, no tokens, no user PII beyond userId)
          errors: result.errors.slice(0, 20), // cap at 20 to keep response size reasonable
          durationMs,
        },
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[jobs/process-notifications] Fatal error', { errorMessage })

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

// Export both GET and POST — mirrors process-subscriptions pattern
export async function GET(req: NextRequest)  { return handleRequest(req) }
export async function POST(req: NextRequest) { return handleRequest(req) }
