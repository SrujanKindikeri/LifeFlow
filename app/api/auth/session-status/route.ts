import { NextResponse } from 'next/server'
import { getSession, getIdleTimeoutMs } from '@/lib/session'

/**
 * GET /api/auth/session-status
 *
 * Returns the current session's authentication state and inactivity deadline.
 * Used exclusively by the client-side InactivityMonitor component.
 *
 * IMPORTANT: this route intentionally does NOT update lastActiveAt.
 * It is a lightweight read-only status check — not user activity.
 * Updating activity here would allow the client monitor's polling to
 * keep an otherwise-idle session alive indefinitely, defeating the purpose.
 *
 * Responses:
 *   200  { active: true,  idleTimeoutMs: number, msUntilExpiry: number }
 *   200  { active: false, reason: 'unauthenticated' | 'session_expired' }
 *
 * The client uses msUntilExpiry to set its local countdown timer.
 * The server remains the source of truth — the client timer is only a UX
 * aid that fires slightly before the server would reject the session.
 */
export async function GET() {
  const session      = await getSession()
  const idleTimeout  = getIdleTimeoutMs()

  // Not logged in
  if (!session.isLoggedIn || !session.userId) {
    return NextResponse.json({ active: false, reason: 'unauthenticated' })
  }

  // Inactivity timeout disabled (SESSION_IDLE_TIMEOUT_MINUTES=0)
  if (idleTimeout === 0) {
    return NextResponse.json({ active: true, idleTimeoutMs: 0, msUntilExpiry: Infinity })
  }

  const lastActive = session.lastActiveAt

  // No lastActiveAt yet (old session pre-dating this feature): treat as active.
  // requireAuth() will stamp it on the next real request.
  if (!lastActive) {
    return NextResponse.json({
      active:         true,
      idleTimeoutMs:  idleTimeout,
      msUntilExpiry:  idleTimeout,
    })
  }

  const msIdle      = Date.now() - lastActive
  const msRemaining = idleTimeout - msIdle

  if (msRemaining <= 0) {
    // Session is already expired from the server's perspective.
    // Return expired status — the client will call logout and redirect.
    return NextResponse.json({ active: false, reason: 'session_expired' })
  }

  return NextResponse.json({
    active:        true,
    idleTimeoutMs: idleTimeout,
    msUntilExpiry: msRemaining,
  })
}
