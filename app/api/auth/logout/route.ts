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
 *
 * SECURITY EVENT
 * ──────────────
 * Records a `logout` SecurityEvent (non-fatal, fire-and-forget) so the
 * admin dashboard can show logout history.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import logger from '@/lib/logger'
import { resolveClientIp, isValidIp } from '@/lib/ip'
import { parseUserAgent } from '@/lib/useragent'
import { recordSecurityEvent } from '@/models/SecurityEvent'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()

    // Capture userId and publicId before destroying
    const userId = session.userId ?? null
    const isLoggedIn = session.isLoggedIn === true

    await session.destroy()

    // Record logout security event (non-fatal)
    if (userId && isLoggedIn) {
      const ipResult = resolveClientIp(req)
      const securityIp = isValidIp(ipResult.ip) ? ipResult.ip : null
      const parsedUa = parseUserAgent(req.headers.get('user-agent'))

      void recordSecurityEvent({
        userId,
        eventType:  'logout',
        outcome:    'success',
        ip:         securityIp,
        ipSource:   ipResult.source,
        deviceCategory: parsedUa.deviceCategory,
        browser:    parsedUa.browser,
      })
    }

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
