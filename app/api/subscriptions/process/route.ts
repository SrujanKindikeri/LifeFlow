/**
 * GET /api/subscriptions/process
 *
 * Legacy scheduler endpoint alias.
 * The canonical endpoint is POST /api/jobs/process-subscriptions.
 * This route exists so any external schedulers pointed at the old URL
 * continue to work without reconfiguration.
 *
 * Authentication: Authorization: Bearer <SCHEDULER_SECRET>
 *                 or ?secret=<SCHEDULER_SECRET> query param.
 *
 * Idempotent — safe to call multiple times.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runSubscriptionScheduler } from '@/lib/subscriptionScheduler'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SCHEDULER_SECRET ?? process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return true

  const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
  if (querySecret === secret) return true

  return false
}

export async function GET(req: NextRequest) {
  const configured = !!(process.env.SCHEDULER_SECRET ?? process.env.CRON_SECRET)

  if (!configured) {
    logger.error('[subscriptions/process] No scheduler secret configured — set SCHEDULER_SECRET or CRON_SECRET')
    return NextResponse.json(
      { error: 'Scheduler not configured. Set SCHEDULER_SECRET env var.' },
      { status: 503 }
    )
  }

  if (!isAuthorized(req)) {
    logger.warn('[subscriptions/process] Unauthorized request', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSubscriptionScheduler()

    logger.info('[subscriptions/process] Run complete', {
      subscriptionsChecked:  result.subscriptionsChecked,
      subscriptionsActioned: result.subscriptionsActioned,
      totalExpensesCreated:  result.totalExpensesCreated,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    logger.error('[subscriptions/process] Scheduler error', {
      errorType:    err instanceof Error ? err.constructor.name : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: 'Scheduler run failed. Check server logs.' },
      { status: 500 }
    )
  }
}
