/**
 * POST /api/jobs/process-subscriptions
 *
 * Provider-neutral scheduled job endpoint for automatic subscription expense creation.
 *
 * DESIGN
 * ──────
 * The scheduler (Vercel Cron, AWS EventBridge, Azure Logic Apps, cron-job.org,
 * or any HTTP scheduler) calls this endpoint. All business logic lives in
 * lib/subscriptionScheduler.ts — this file is only a thin, authenticated HTTP
 * wrapper around runSubscriptionScheduler().
 *
 * Supports both GET and POST so it works with all scheduler types:
 *   - Vercel Cron sends GET requests
 *   - AWS EventBridge HTTP targets can send POST or GET
 *   - Azure Logic Apps HTTP action defaults to POST
 *   - curl/cron-job.org can use either
 *
 * AUTHENTICATION
 * ──────────────
 * Requests must include the scheduler secret via one of:
 *   Authorization: Bearer <SCHEDULER_SECRET>   (recommended)
 *   Authorization: Bearer <CRON_SECRET>         (alias)
 *   ?secret=<SCHEDULER_SECRET>                  (for schedulers that can't set headers)
 *
 * If neither SCHEDULER_SECRET nor CRON_SECRET is configured, returns 503
 * so misconfigured deployments fail loudly rather than silently.
 *
 * IDEMPOTENCY
 * ───────────
 * Safe to call any number of times — the underlying scheduler uses a unique
 * MongoDB index on (sourceSubscriptionId, subscriptionBillingDate) to prevent
 * duplicate expense creation even if two scheduler instances run simultaneously.
 *
 * VERCEL CRON
 * ───────────
 * Add to vercel.json:
 *   { "crons": [{ "path": "/api/jobs/process-subscriptions", "schedule": "0 * * * *" }] }
 * Vercel automatically adds the Authorization header using CRON_SECRET.
 *
 * AWS EVENTBRIDGE
 * ───────────────
 * Create a rule with a schedule expression (e.g. "rate(1 hour)") targeting
 * an API Gateway endpoint or App Runner service URL pointing to this route.
 * Pass the secret in the Authorization header or as a query parameter.
 *
 * AZURE LOGIC APPS / FUNCTIONS TIMER
 * ────────────────────────────────────
 * Use an HTTP action in Logic Apps, or a Timer trigger in Azure Functions
 * that calls this endpoint with the Authorization header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runSubscriptionScheduler } from '@/lib/subscriptionScheduler'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getConfiguredSecret(): string | null {
  // Accept either SCHEDULER_SECRET or CRON_SECRET — both are aliases
  return (
    process.env.SCHEDULER_SECRET ||
    process.env.CRON_SECRET ||
    null
  )
}

function isAuthorized(req: NextRequest): boolean {
  const secret = getConfiguredSecret()
  if (!secret) return false

  // Accept via Authorization header
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return true

  // Accept via query param (for schedulers that cannot set headers)
  const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
  if (querySecret === secret) return true

  return false
}

// ─── Handler (shared by GET and POST) ────────────────────────────────────────

async function handleJobRequest(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now()

  // ── Config guard ────────────────────────────────────────────────────────────
  if (!getConfiguredSecret()) {
    logger.error('[jobs/process-subscriptions] No scheduler secret configured')
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
    logger.warn('[jobs/process-subscriptions] Unauthorized request', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing scheduler secret.' } },
      { status: 401 }
    )
  }

  // ── Run scheduler ───────────────────────────────────────────────────────────
  try {
    const result = await runSubscriptionScheduler()
    const durationMs = Date.now() - t0

    logger.info('[jobs/process-subscriptions] Run complete', {
      subscriptionsChecked: result.subscriptionsChecked,
      subscriptionsActioned: result.subscriptionsActioned,
      totalExpensesCreated: result.totalExpensesCreated,
      durationMs,
    })

    return NextResponse.json(
      {
        ok: true,
        durationMs,
        ...result,
      },
      { status: 200 }
    )
  } catch (err) {
    const durationMs = Date.now() - t0
    logger.error('[jobs/process-subscriptions] Scheduler error', {
      errorType:    err instanceof Error ? err.constructor.name : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs,
    })

    return NextResponse.json(
      {
        error: {
          code:    'INTERNAL_ERROR',
          message: 'Scheduler run failed. Check server logs.',
        },
      },
      { status: 500 }
    )
  }
}

// ─── Route exports ────────────────────────────────────────────────────────────

// GET  — Vercel Cron, simple HTTP schedulers, EventBridge
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleJobRequest(req)
}

// POST — Azure Logic Apps, curl, most HTTP webhook schedulers
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleJobRequest(req)
}
