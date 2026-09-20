/**
 * POST /api/jobs/cleanup-deleted-accounts
 * GET  /api/jobs/cleanup-deleted-accounts
 *
 * Permanently deletes user accounts whose 30-day recovery window has expired.
 *
 * DESIGN
 * ──────
 * Follows the same pattern as /api/jobs/process-notifications:
 *   - Accepts both GET and POST (Vercel Cron, EventBridge, crontab, etc.)
 *   - Protected by SCHEDULER_SECRET / CRON_SECRET
 *   - Returns 503 if neither secret is configured
 *   - Delegates all logic to lib/accountCleanup.ts
 *   - Safe to call any number of times — fully idempotent
 *   - Only processes accounts where:
 *       accountStatus = "deleted"
 *       scheduledPermanentDeletionAt <= now
 *
 * SCHEDULING RECOMMENDATIONS
 * ──────────────────────────
 * Run once daily.  A user who deletes their account at midnight will have
 * their data cleaned up within 24 hours after the 30-day window closes.
 *
 * Vercel Cron (vercel.json):
 *   { "path": "/api/jobs/cleanup-deleted-accounts", "schedule": "0 3 * * *" }
 *
 * EC2/Azure VM crontab (runs daily at 03:00 UTC):
 *   0 3 * * * curl -s -X POST https://<domain>/api/jobs/cleanup-deleted-accounts \
 *     -H "Authorization: Bearer $SCHEDULER_SECRET" > /dev/null
 *
 * SECURITY
 * ────────
 * Protected by the same SCHEDULER_SECRET / CRON_SECRET used for other jobs.
 * Never exposes user PII in responses — only counts and sanitised error messages.
 *
 * DATA SAFETY
 * ───────────
 * • NEVER runs on accounts with accountStatus = "active"
 * • NEVER runs on accounts still within the recovery window
 * • Cross-user Person records are unlinked (not deleted) — other users keep
 *   their contact entries but the link to the deleted LifeFlow account is cleared
 * • All operations are logged with userId (audit trail in server logs)
 * • If any single-user cleanup fails, the job continues to the next user
 *   (idempotent: re-running the job safely retries the failed user)
 */

import { NextRequest, NextResponse } from 'next/server'
import { runAccountCleanup } from '@/lib/accountCleanup'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getConfiguredSecret(): string | null {
  return process.env.SCHEDULER_SECRET || process.env.CRON_SECRET || null
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

  if (!getConfiguredSecret()) {
    logger.error('[jobs/cleanup-deleted-accounts] No scheduler secret configured')
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

  if (!isAuthorized(req)) {
    logger.warn('[jobs/cleanup-deleted-accounts] Unauthorized request', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing scheduler secret.' } },
      { status: 401 }
    )
  }

  try {
    const result = await runAccountCleanup()
    const durationMs = Date.now() - t0

    logger.info('[jobs/cleanup-deleted-accounts] Run complete', {
      accountsProcessed:    result.accountsProcessed,
      accountsPermanentlyDeleted: result.accountsPermanentlyDeleted,
      errorCount:           result.errors.length,
      durationMs,
    })

    return NextResponse.json({
      ok: true,
      result: {
        accountsProcessed:          result.accountsProcessed,
        accountsPermanentlyDeleted: result.accountsPermanentlyDeleted,
        errorCount:                 result.errors.length,
        errors:                     result.errors.slice(0, 20),
        durationMs,
      },
    })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[jobs/cleanup-deleted-accounts] Fatal error', { errorMessage })

    return NextResponse.json(
      {
        error: {
          code:    'INTERNAL_ERROR',
          message: 'Account cleanup failed. Check server logs.',
        },
      },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest)  { return handleRequest(req) }
export async function POST(req: NextRequest) { return handleRequest(req) }
