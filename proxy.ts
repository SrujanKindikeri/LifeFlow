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
 *
 * One-rule-per-state design — no state can redirect to a page that redirects
 * back to it, which is what caused the ERR_TOO_MANY_REDIRECTS loop.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { SessionData, getSessionOptions } from '@/lib/session'

/**
 * Routes where logged-in users should NOT be sent.
 * An authenticated+verified user hitting any of these is bounced to /app/dashboard.
 * An authenticated+unverified user is NOT bounced — they need to reach /verify-email.
 */
const AUTH_ONLY_PATHS = ['/login', '/signup', '/check-email']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Read the encrypted session cookie from the incoming request.
  // We pass the NextResponse so iron-session can write a rotated cookie if
  // needed, but for an auth-read-only proxy this is mostly a no-op write.
  const response = NextResponse.next()
  const session  = await getIronSession<SessionData>(req, response, getSessionOptions())

  const isLoggedIn      = session.isLoggedIn === true && !!session.userId
  // emailVerified is set to true in the login/verify-2fa routes.
  // A session without emailVerified (e.g. old cookies pre-dating this field)
  // is treated as unverified so the user is sent through the verification flow.
  const isVerified      = isLoggedIn && session.emailVerified === true

  console.log(`[AUTH] proxy ${pathname} — isLoggedIn=${isLoggedIn} isVerified=${isVerified}`)

  // ── Redirect verified+authenticated users away from pure-auth pages ────────
  // Unverified users are deliberately NOT redirected here: they need to reach
  // /verify-email or /check-email to complete verification.
  if (isVerified && AUTH_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    console.log('[AUTH] redirecting verified user away from auth page → /app/dashboard')
    return NextResponse.redirect(new URL('/app/dashboard', req.url))
  }

  // ── Protect /app/* routes ─────────────────────────────────────────────────
  if (pathname.startsWith('/app')) {
    if (!isLoggedIn) {
      // Not logged in at all → send to login, preserving the destination
      console.log('[AUTH] redirecting unauthenticated user → /login')
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (!isVerified) {
      // Logged in but email not verified → send to verification page ONCE.
      // /verify-email is NOT in the matcher so this redirect always terminates.
      console.log('[AUTH] redirecting unverified user → /verify-email')
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
