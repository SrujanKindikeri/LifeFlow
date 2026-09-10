/**
 * GET /api/subscriptions/process
 *
 * Server-side scheduler endpoint.  Runs the subscription processor and
 * creates Personal Expenses for all due subscriptions.
 *
 * SECURITY
 * ────────
 * This route is NOT authenticated via user session — it is meant to be called
 * by a cron job, health-check pinger, or deployment hook.  It is protected by
 * a shared secret (`SCHEDULER_SECRET`) that must be provided via the
 * `Authorization: Bearer <secret>` header OR as `?secret=<secret>` query param.
 *
 * Set SCHEDULER_SECRET to a strong random string in your environment:
 *   openssl rand -base64 32
 *
 * If SCHEDULER_SECRET is not set in the environment the endpoint returns 503
 * so misconfigured deployments fail loudly instead of silently.
 *
 * TRIGGERING
 * ──────────
 * Option A — External cron (recommended for production):
 *   Use cron-job.org, GitHub Actions schedule, Railway cron, or any HTTP
 *   scheduler to call this URL every 15–60 minutes:
 *   GET https://your-app.com/api/subscriptions/process
 *   Authorization: Bearer <SCHEDULER_SECRET>
 *
 * Option B — Next.js on-request trigger (dev / simple deploy):
 *   The endpoint also runs automatically when any authenticated user hits
 *   GET /api/subscriptions (list), via a lightweight piggyback call.
 *   See the subscriptions list route for that integration.
 *
 * IDEMPOTENCY
 * ───────────
 * Safe to call multiple times — the scheduler and DB layer guarantee exactly
 * one expense per subscription per billing cycle.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runSubscriptionScheduler } from '@/lib/subscriptionScheduler'

export const dynamic = 'force-dynamic'

/** Validate the caller's secret against the environment variable. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SCHEDULER_SECRET
  if (!secret) return false  // misconfigured — deny all

  // Accept via Authorization header or query param.
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return true

  const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
  if (querySecret === secret) return true

  return false
}

export async function GET(req: NextRequest) {
  // ── Config guard ────────────────────────────────────────────────────────────
  if (!process.env.SCHEDULER_SECRET) {
    console.error('[subscription-process] SCHEDULER_SECRET is not set')
    return NextResponse.json(
      { error: 'Scheduler not configured. Set SCHEDULER_SECRET env var.' },
      { status: 503 }
    )
  }

  // ── Auth guard ──────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Run scheduler ───────────────────────────────────────────────────────────
  try {
    const result = await runSubscriptionScheduler()

    console.log(
      `[subscription-process] checked=${result.subscriptionsChecked}` +
      ` actioned=${result.subscriptionsActioned}` +
      ` created=${result.totalExpensesCreated}`
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[subscription-process] Scheduler error:', error)
    return NextResponse.json(
      { error: 'Scheduler failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
