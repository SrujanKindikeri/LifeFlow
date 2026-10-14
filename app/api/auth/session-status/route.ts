import { NextResponse } from 'next/server'
import { getSession, getIdleTimeoutMs, getAbsoluteTimeoutMs } from '@/lib/session'

/**
 * GET /api/auth/session-status
 *
 * Returns the current session's authentication state, inactivity deadline,
 * and absolute (24-hour) deadline.  Used exclusively by the client-side
 * SessionExpiryMonitor component.
 *
 * IMPORTANT: this route intentionally does NOT update lastActiveAt.
 * It is a lightweight read-only status check — not user activity.
 * Updating activity here would allow the client monitor's polling to
 * keep an otherwise-idle session alive indefinitely, defeating the purpose.
 *
 * Responses:
 *   200  {
 *          active: true,
 *          idleTimeoutMs:       number,
 *          msUntilIdleExpiry:   number,
 *          msUntilAbsoluteExpiry: number,
 *          msUntilExpiry:       number   // min of the two — used by the client timer
 *        }
 *   200  { active: false, reason: 'unauthenticated' | 'session_expired' }
 *
 * The client uses msUntilExpiry to set its local countdown timer and
 * msUntilAbsoluteExpiry to show the absolute deadline warning.
 * The server remains the source of truth — the client timer is only a UX
 * aid that fires slightly before the server would reject the session.
 */
export async function GET() {
  const session         = await getSession()
  const idleTimeout     = getIdleTimeoutMs()
  const absoluteTimeout = getAbsoluteTimeoutMs()
  const now             = Date.now()

  // Not logged in
  if (!session.isLoggedIn || !session.userId) {
    return NextResponse.json({ active: false, reason: 'unauthenticated' })
  }

  // ── Absolute expiry check ──────────────────────────────────────────────────
  if (absoluteTimeout > 0 && session.loginAt) {
    const msAge = now - session.loginAt
    if (msAge > absoluteTimeout) {
      return NextResponse.json({ active: false, reason: 'session_expired' })
    }
  }

  // ── Inactivity expiry check ────────────────────────────────────────────────
  if (idleTimeout > 0 && session.lastActiveAt) {
    const msIdle = now - session.lastActiveAt
    if (msIdle > idleTimeout) {
      return NextResponse.json({ active: false, reason: 'session_expired' })
    }
  }

  // ── Compute remaining time for each deadline ───────────────────────────────

  // Inactivity: how many ms remain before the idle window closes.
  // If the timeout is disabled (0) or lastActiveAt is absent, treat as infinite.
  let msUntilIdleExpiry = Infinity
  if (idleTimeout > 0) {
    if (session.lastActiveAt) {
      msUntilIdleExpiry = idleTimeout - (now - session.lastActiveAt)
    } else {
      // No lastActiveAt yet (old session) — grant the full idle window as grace.
      msUntilIdleExpiry = idleTimeout
    }
  }

  // Absolute: how many ms remain before the 24-hour hard deadline.
  // If the timeout is disabled (0) or loginAt is absent (old session), treat as infinite.
  let msUntilAbsoluteExpiry = Infinity
  if (absoluteTimeout > 0) {
    if (session.loginAt) {
      msUntilAbsoluteExpiry = absoluteTimeout - (now - session.loginAt)
    }
    // loginAt absent → grant infinite grace (old session pre-dating this feature)
  }

  // The client timer fires at whichever deadline is earlier.
  const msUntilExpiry = Math.min(msUntilIdleExpiry, msUntilAbsoluteExpiry)

  // Inactivity timeout disabled server-side — cancel all local inactivity timers
  // (the absolute timer still applies if set).
  if (idleTimeout === 0 && absoluteTimeout === 0) {
    return NextResponse.json({
      active:               true,
      idleTimeoutMs:        0,
      msUntilIdleExpiry:    Infinity,
      msUntilAbsoluteExpiry: Infinity,
      msUntilExpiry:        Infinity,
    })
  }

  return NextResponse.json({
    active:               true,
    idleTimeoutMs:        idleTimeout,
    absoluteTimeoutMs:    absoluteTimeout,
    msUntilIdleExpiry:    msUntilIdleExpiry === Infinity ? null : msUntilIdleExpiry,
    msUntilAbsoluteExpiry: msUntilAbsoluteExpiry === Infinity ? null : msUntilAbsoluteExpiry,
    msUntilExpiry:        msUntilExpiry === Infinity ? null : msUntilExpiry,
  })
}
