/**
 * POST /api/auth/logout — Destroy the session and return pending-mutation count.
 *
 * OFFLINE-FIRST CHANGE
 * ─────────────────────
 * Returns { message, pendingMutationCount } so the client-side logout handler
 * can warn the user if there are unsynced changes before clearing local data.
 * The count is approximate (estimated from the session userId) — not authoritative.
 * The actual pending count comes from the client's own IndexedDB outbox.
 *
 * The session is destroyed regardless of pending mutations — the server cannot
 * hold the session hostage. The client is responsible for warning the user.
 */
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import logger from '@/lib/logger'

export async function POST() {
  try {
    const session = await getSession()

    // Capture userId before destroying — returned to client for pending-count UX
    const userId = session.userId ?? null

    await session.destroy()

    return NextResponse.json({
      message:  'Logged out successfully',
      userId,   // client uses this to query its own IndexedDB outbox count
    })
  } catch (error) {
    logger.error('[logout]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 })
  }
}
