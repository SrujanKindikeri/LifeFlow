/**
 * POST /api/admin/run-scheduler
 * GET  /api/admin/run-scheduler
 *
 * Admin/developer-only endpoint that runs the full notification scheduler
 * immediately and returns detailed per-channel statistics.
 *
 * This is the same pipeline as /api/jobs/process-notifications-precise but:
 *   - Protected by DIAGNOSTIC_SECRET instead of SCHEDULER_SECRET
 *   - Returns richer diagnostics including per-user breakdown (no PII)
 *   - Usable for production diagnosis without needing the scheduler secret
 *
 * USE CASES
 * ─────────
 * • Verify the scheduler works without waiting for the next cron cycle
 * • Diagnose why notifications aren't firing for specific users
 * • Confirm SMTP connectivity end-to-end (a real email will be sent if due)
 * • Check database query performance
 *
 * SECURITY
 * ────────
 * Protected by DIAGNOSTIC_SECRET env var.
 * Returns 503 if not configured.
 * Never exposes SMTP credentials, user emails, or session secrets.
 *
 * RESPONSE SHAPE
 * ──────────────
 * {
 *   ok: true,
 *   graceSeconds: 90,
 *   result: {
 *     usersProcessed:   number,
 *     totalSent:        number,
 *     totalSkipped:     number,
 *     errorCount:       number,
 *     errors:           string[],  // sanitised, max 20
 *     durationMs:       number,
 *   },
 *   config: {
 *     emailProvider:    string,
 *     smtpConfigured:   boolean,
 *     vapidConfigured:  boolean,
 *     graceSeconds:     number,
 *   }
 * }
 */

import { NextRequest, NextResponse }       from 'next/server'
import { runNotificationScheduler }        from '@/lib/notificationScheduler'
import logger                              from '@/lib/logger'

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

function getGraceSeconds(req: NextRequest): number {
  // Allow override via query param for testing different grace windows
  const raw = parseInt(req.nextUrl.searchParams.get('graceSeconds') ?? '90', 10)
  if (isNaN(raw) || raw < 30) return 90
  if (raw > 7200) return 7200   // cap at 2 hours
  return raw
}

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now()

  if (!getConfiguredSecret()) {
    return NextResponse.json(
      {
        error: {
          code:    'SERVICE_UNAVAILABLE',
          message: 'Set DIAGNOSTIC_SECRET to enable this endpoint.',
        },
      },
      { status: 503 }
    )
  }

  if (!isAuthorized(req)) {
    logger.warn('[admin/run-scheduler] Unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing diagnostic secret.' } },
      { status: 401 }
    )
  }

  const graceSeconds = getGraceSeconds(req)

  logger.info('[admin/run-scheduler] Manual scheduler run triggered', { graceSeconds })

  try {
    const result = await runNotificationScheduler(graceSeconds)
    const durationMs = Date.now() - t0

    logger.info('[admin/run-scheduler] Manual run complete', {
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
        ranAt:       new Date().toISOString(),
        graceSeconds,
        result: {
          usersProcessed: result.usersProcessed,
          totalSent:      result.totalSent,
          totalSkipped:   result.totalSkipped,
          errorCount:     result.errors.length,
          // Sanitised error messages only — no credentials, no PII
          errors:         result.errors.slice(0, 20),
          durationMs,
        },
        config: {
          emailProvider:   process.env.EMAIL_PROVIDER ?? 'none',
          smtpConfigured:  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
          vapidConfigured: !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
          graceSeconds,
          defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata',
        },
      },
      { status: 200 }
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[admin/run-scheduler] Fatal error', { errorMessage })

    return NextResponse.json(
      {
        error: {
          code:    'INTERNAL_ERROR',
          message: 'Scheduler run failed. Check server logs for details.',
        },
      },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest)  { return handleRequest(req) }
export async function POST(req: NextRequest) { return handleRequest(req) }
