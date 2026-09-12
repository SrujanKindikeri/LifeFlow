/**
 * /api/push-subscription — Manage browser push subscriptions.
 *
 * POST   — Register or refresh a push subscription for the current user.
 * DELETE — Remove a push subscription (unsubscribe from this device).
 * GET    — Return whether the current user has any active push subscriptions.
 *
 * SECURITY
 * ────────
 * - All handlers require an authenticated session via requireAuth().
 * - userId is always sourced from the session — never from the request body.
 * - One user can never modify another user's subscriptions.
 * - The endpoint URL from the browser is treated as opaque — we only store
 *   and forward it; we never log it in full (it may contain encoded user info
 *   on some push services).
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import PushSubscription from '@/models/PushSubscription'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Validation ───────────────────────────────────────────────────────────────

interface PushSubscriptionBody {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

function isValidSubscription(body: unknown): body is PushSubscriptionBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (typeof b.endpoint !== 'string' || !b.endpoint.startsWith('https://')) return false
  if (!b.keys || typeof b.keys !== 'object') return false
  const k = b.keys as Record<string, unknown>
  if (typeof k.p256dh !== 'string' || !k.p256dh) return false
  if (typeof k.auth !== 'string' || !k.auth) return false
  return true
}

// ─── POST — register / refresh ────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()

    if (!isValidSubscription(body)) {
      return NextResponse.json(
        { error: 'Invalid push subscription object.' },
        { status: 400 }
      )
    }

    await connectDB()

    const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 200)

    // Upsert: if this endpoint already exists for this user, refresh its keys
    // and expiry; otherwise create a new document.
    await PushSubscription.findOneAndUpdate(
      { userId, endpoint: body.endpoint },
      {
        $set: {
          lifeFlowId,
          expirationTime: body.expirationTime ?? null,
          keys:           body.keys,
          userAgent,
        },
      },
      { upsert: true, new: true }
    )

    logger.info('[push-subscription] Subscription registered', { userId })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[push-subscription] POST failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to save subscription.' }, { status: 500 })
  }
}

// ─── DELETE — unsubscribe from this device ────────────────────────────────────

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth()
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    await connectDB()

    if (body.endpoint && typeof body.endpoint === 'string') {
      // Remove a specific subscription (this device only).
      await PushSubscription.deleteOne({ userId, endpoint: body.endpoint })
      logger.info('[push-subscription] Subscription removed (specific endpoint)', { userId })
    } else {
      // Remove ALL subscriptions for this user (full unsubscribe).
      await PushSubscription.deleteMany({ userId })
      logger.info('[push-subscription] All subscriptions removed for user', { userId })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[push-subscription] DELETE failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to remove subscription.' }, { status: 500 })
  }
}

// ─── GET — check subscription status ─────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const count = await PushSubscription.countDocuments({ userId })
    return NextResponse.json({ subscribed: count > 0, count })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[push-subscription] GET failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Failed to check subscription.' }, { status: 500 })
  }
}
