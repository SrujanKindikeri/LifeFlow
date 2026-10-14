/**
 * proxy.ts — Next.js 16 middleware for LifeFlow.
 *
 * Next.js 16 uses the file name "proxy.ts" (renamed from "middleware.ts").
 * The exported function must be named "proxy" or be a default export.
 *
 * Handles:
 *   - Redirecting authenticated+verified users away from /login and /signup
 *   - Protecting all /app/* routes:
 *       unauthenticated            → /login
 *       authenticated + unverified → /verify-email
 *       authenticated + verified   → allowed through
 *   - Inactivity expiry: if lastActiveAt is present and older than
 *       SESSION_IDLE_TIMEOUT_MINUTES, redirect to /api/auth/clear-session
 *       (which destroys the cookie) then to /login.
 *
 * One-rule-per-state design — no state can redirect to a page that redirects
 * back to it, which is what caused the ERR_TOO_MANY_REDIRECTS loop.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { SessionData, getSessionOptions, getIdleTimeoutMs, getAbsoluteTimeoutMs } from '@/lib/session'

/**
 * Routes where logged-in users should NOT be sent.
 * An authenticated+verified user hitting any of these is bounced to /app/dashboard.
 * An authenticated+unverified user is NOT bounced — they need to reach /verify-email.
 */
const AUTH_ONLY_PATHS = ['/login', '/signup', '/check-email']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Read the encrypted session cookie from the incoming request.
  // We pass a NextResponse so iron-session can write a rotated cookie if needed.
  const response = NextResponse.next()
  const session  = await getIronSession<SessionData>(req, response, getSessionOptions())

  const isLoggedIn = session.isLoggedIn === true && !!session.userId
  // emailVerified is set to true in the login/verify-2fa routes.
  // A session without emailVerified (e.g. old cookies pre-dating this field)
  // is treated as unverified so the user is sent through the verification flow.
  const isVerified = isLoggedIn && session.emailVerified === true

  // ── Inactivity + absolute expiry check (page requests only) ──────────────
  // Only enforce on /app/* routes for a logged-in, verified session.
  // The proxy cannot call session.destroy() — it has no Set-Cookie context that
  // the browser will honour for the final response. Instead we redirect to
  // /api/auth/clear-session, a Route Handler that IS allowed to emit Set-Cookie,
  // which destroys the cookie and then redirects to /login.
  //
  // The actual cookie destruction + 401 for API requests is handled in
  // requireAuth() in lib/session.ts. This proxy check is an early short-circuit
  // for /app/* page navigations so the user never sees a protected page flash.
  if (isVerified && pathname.startsWith('/app')) {
    const now = Date.now()

    // ── Inactivity check ──────────────────────────────────────────────────
    const idleTimeoutMs = getIdleTimeoutMs()
    if (idleTimeoutMs > 0 && session.lastActiveAt) {
      const idleMs = now - session.lastActiveAt
      if (idleMs > idleTimeoutMs) {
        const clearUrl = new URL('/api/auth/clear-session', req.url)
        clearUrl.searchParams.set('reason', 'session_expired')
        return NextResponse.redirect(clearUrl)
      }
    }

    // ── Absolute expiry check ─────────────────────────────────────────────
    // Hard 24-hour deadline from the moment of login — activity cannot extend it.
    const absoluteTimeoutMs = getAbsoluteTimeoutMs()
    if (absoluteTimeoutMs > 0 && session.loginAt) {
      const ageMs = now - session.loginAt
      if (ageMs > absoluteTimeoutMs) {
        const clearUrl = new URL('/api/auth/clear-session', req.url)
        clearUrl.searchParams.set('reason', 'session_expired')
        return NextResponse.redirect(clearUrl)
      }
    }
    // Note: if lastActiveAt or loginAt is absent (old session before this
    // feature), we let the request through. requireAuth() in lib/session.ts
    // will enforce both checks on the first authenticated API request and
    // stamp the timestamps, giving those users a grace period rather than
    // immediately logging everyone out on first deploy.
  }

  // ── Redirect verified+authenticated users away from pure-auth pages ────────
  // Unverified users are deliberately NOT redirected here: they need to reach
  // /verify-email or /check-email to complete verification.
  if (isVerified && AUTH_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/app/dashboard', req.url))
  }

  // ── Protect /app/* routes ─────────────────────────────────────────────────
  if (pathname.startsWith('/app')) {
    if (!isLoggedIn) {
      // Not logged in at all → send to login, preserving the destination
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (!isVerified) {
      // Logged in but email not verified → send to verification page ONCE.
      // /verify-email is NOT in the matcher so this redirect always terminates.
      return NextResponse.redirect(new URL('/verify-email', req.url))
    }
  }

  return response
}

export const config = {
  // Run on /app/*, /login, /signup, /check-email.
  // /verify-email is intentionally excluded: it must be reachable by anyone
  // (authenticated or not) without the proxy intervening, otherwise clicking
  // a verification link from email would loop back through this middleware.
  matcher: [
    '/app/:path*',
    '/login',
    '/signup',
    '/check-email',
  ],
}
