/**
 * proxy.ts — Next.js 16 middleware for LifeFlow.
 *
 * Next.js 16 uses the file name "proxy.ts" (renamed from "middleware.ts").
 * The exported function must be named "proxy" or be a default export.
 *
 * Handles:
 *   - MAINTENANCE MODE: when enabled, non-admin user-facing routes return a
 *       maintenance page (HTML) or a 503 JSON response (API routes).
 *       Exempt routes: /maintenance, /admin/*, /api/admin/*,
 *       /api/health, /api/auth/*, /_next/*, /favicon.ico
 *   - Redirecting authenticated+verified users away from /login and /signup
 *   - Protecting all /app/* routes:
 *       unauthenticated            → /login
 *       authenticated + unverified → /verify-email
 *       authenticated + verified   → allowed through
 *   - Inactivity expiry: if lastActiveAt is present and older than
 *       SESSION_IDLE_TIMEOUT_MINUTES, redirect to /api/auth/clear-session
 *       (which destroys the cookie) then to /login.
 *   - Protecting all /admin/* routes (except /admin/login):
 *       no valid admin session      → /admin/login
 *       expired admin session       → /admin/login
 *       valid admin session         → allowed through
 *
 * One-rule-per-state design — no state can redirect to a page that redirects
 * back to it, which is what caused the ERR_TOO_MANY_REDIRECTS loop.
 *
 * MAINTENANCE MODE IMPLEMENTATION NOTES
 * ──────────────────────────────────────
 * The proxy reads maintenance_mode from MongoDB via the settings cache in
 * lib/settings.ts (30-second TTL).  The cache is process-local; a change
 * propagates within ≤30 s across all running Next.js processes.
 *
 * On DB failure the setting defaults to false (maintenance OFF) — normal
 * access is preserved during a DB outage rather than locking everyone out.
 * This is the documented fail-open policy for maintenance_mode.
 *
 * The proxy cannot use MongoDB-backed DB calls in development with turbopack
 * watch if the Edge runtime is selected.  We keep the runtime as Node.js
 * (the default for proxy.ts in Next.js 16) so the full Node.js API
 * (including Mongoose) is available.  Do NOT add `export const runtime='edge'`.
 *
 * Redirect loop prevention
 * ────────────────────────
 * /maintenance is excluded from the matcher entirely so the maintenance page
 * itself never gets intercepted.  API routes return JSON, not redirects.
 * Admin routes are exempt so admins can always reach the control panel.
 *
 * NOTE: The proxy performs a lightweight cookie-only check for /admin/*.
 * Every /admin/* page.tsx and /api/admin/* route additionally calls
 * requireAdmin() which performs a DB-backed verification — defense in depth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { SessionData, getSessionOptions, getIdleTimeoutMs, getAbsoluteTimeoutMs } from '@/lib/session'
import type { AdminSessionData } from '@/lib/admin-auth'

// ── Routes where logged-in users should NOT be sent ───────────────────────────
const AUTH_ONLY_PATHS = ['/login', '/signup', '/check-email']

// ── Routes always exempt from maintenance mode ────────────────────────────────
// These must be reachable regardless of the maintenance_mode setting to avoid
// locking out administrators and breaking health checks / auth flows.
const MAINTENANCE_EXEMPT_PREFIXES = [
  '/maintenance',     // the maintenance page itself (prevents redirect loop)
  '/admin',           // entire admin area — admins must be able to manage settings
  '/api/admin',       // admin API routes
  '/api/health',      // load-balancer / Docker health checks
  '/api/auth',        // all auth routes: login, logout, clear-session, reset-password, etc.
  '/_next',           // Next.js static assets (JS, CSS, images)
  '/favicon.ico',     // browser tab icon
]

function isMaintenanceExempt(pathname: string): boolean {
  return MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

// ── Maintenance mode check ────────────────────────────────────────────────────

/**
 * Read maintenance_mode from the settings cache.
 * Returns false on any error (fail-open: preserve normal access during DB outage).
 * Never throws.
 */
async function checkMaintenanceMode(): Promise<boolean> {
  try {
    const { isMaintenanceMode } = await import('@/lib/settings')
    return await isMaintenanceMode()
  } catch {
    // If settings module fails (e.g. DB unavailable at cold start), fail open.
    return false
  }
}

// ── Admin session helper ──────────────────────────────────────────────────────

function getAdminSessionOptions(req: NextRequest, response: NextResponse) {
  return {
    password:   process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || '',
    cookieName: 'lifeflow_admin_session',
    cookieOptions: { httpOnly: true, sameSite: 'lax' as const },
  }
}

async function hasValidAdminSession(req: NextRequest, response: NextResponse): Promise<boolean> {
  try {
    const opts = getAdminSessionOptions(req, response)
    if (opts.password.length < 32) return false
    const adminSession = await getIronSession<AdminSessionData>(req, response, opts)
    if (!adminSession.isAdminLoggedIn || !adminSession.adminId) return false

    const now           = Date.now()
    const IDLE_MS       = 30 * 60 * 1000
    const ABSOLUTE_MS   = 8  * 60 * 60 * 1000

    if (adminSession.lastActiveAt && (now - adminSession.lastActiveAt) > IDLE_MS)      return false
    if (adminSession.loginAt      && (now - adminSession.loginAt)      > ABSOLUTE_MS)  return false
    return true
  } catch {
    return false
  }
}

// ── Main proxy function ───────────────────────────────────────────────────────

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

  // ══════════════════════════════════════════════════════════════════════════
  // MAINTENANCE MODE CHECK
  // Runs first so it takes effect on all routes before any auth logic.
  // Exempt paths (admin area, health, auth, assets) are always let through.
  // ══════════════════════════════════════════════════════════════════════════
  if (!isMaintenanceExempt(pathname)) {
    const inMaintenance = await checkMaintenanceMode()

    if (inMaintenance) {
      // API routes: return JSON 503 so callers receive structured errors,
      // not an HTML maintenance page they cannot parse.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          {
            error: {
              code:    'SERVICE_UNAVAILABLE',
              message: 'The application is currently undergoing maintenance. Please try again later.',
            },
          },
          { status: 503 }
        )
      }

      // All other user-facing routes: redirect to the maintenance page.
      // Avoid a redirect loop — /maintenance itself is exempt above.
      const maintenanceUrl = new URL('/maintenance', req.url)
      return NextResponse.redirect(maintenanceUrl)
    }
  }

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

  // Also redirect authenticated admins away from /login
  if (AUTH_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    try {
      if (await hasValidAdminSession(req, response)) {
        return NextResponse.redirect(new URL('/admin/dashboard', req.url))
      }
    } catch {
      // Not an admin — let the request proceed normally
    }
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

  // ── Protect /admin/* routes (except /admin/login) ─────────────────────────
  // This is a lightweight cookie-only pre-check.
  // Every admin page and API route also calls requireAdmin() server-side
  // for a full DB-backed verification — this is just an early redirect to
  // prevent briefly rendering the admin shell before the 401 fires.
  //
  // /admin/login is deliberately excluded from protection so the login page
  // itself is always reachable (it is in the MAINTENANCE_EXEMPT_PREFIXES).
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    try {
      const opts = getAdminSessionOptions(req, response)

      if (opts.password.length >= 32) {
        const adminSession = await getIronSession<AdminSessionData>(req, response, opts)

        const isAdminLoggedIn = adminSession.isAdminLoggedIn === true && !!adminSession.adminId

        if (!isAdminLoggedIn) {
          return NextResponse.redirect(new URL('/admin/login', req.url))
        }

        // Lightweight expiry checks — identical to the full checks in requireAdmin()
        const now = Date.now()
        const ADMIN_IDLE_MS     = 30 * 60 * 1000   // 30 minutes
        const ADMIN_ABSOLUTE_MS = 8  * 60 * 60 * 1000  // 8 hours

        if (adminSession.lastActiveAt && (now - adminSession.lastActiveAt) > ADMIN_IDLE_MS) {
          return NextResponse.redirect(new URL('/admin/login?reason=expired', req.url))
        }
        if (adminSession.loginAt && (now - adminSession.loginAt) > ADMIN_ABSOLUTE_MS) {
          return NextResponse.redirect(new URL('/admin/login?reason=expired', req.url))
        }
      } else {
        // ADMIN_SESSION_SECRET not configured — deny access to admin area
        return NextResponse.redirect(new URL('/admin/login?reason=misconfigured', req.url))
      }
    } catch {
      // Any cookie/session parsing error → redirect to login
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
  }

  return response
}

export const config = {
  // Run on /app/*, /login, /signup, /check-email, /admin/*, and user /api/*
  // routes so maintenance mode is enforced on API calls too.
  //
  // /maintenance is intentionally NOT in the matcher — the maintenance page
  // must always be reachable without going through the proxy, otherwise
  // it would redirect to itself (loop).
  //
  // /verify-email is intentionally excluded: it must be reachable by anyone
  // (authenticated or not) without the proxy intervening, otherwise clicking
  // a verification link from email would loop back through this middleware.
  //
  // /_next/* is intentionally excluded: static assets must always be served.
  matcher: [
    '/app/:path*',
    '/login',
    '/signup',
    '/check-email',
    '/admin/:path*',
    // API routes that serve user-facing functionality — not health/auth/admin
    '/api/notifications/:path*',
    '/api/tasks/:path*',
    '/api/habits/:path*',
    '/api/expenses/:path*',
    '/api/notes/:path*',
    '/api/projects/:path*',
    '/api/goals/:path*',
    '/api/user/:path*',
    '/api/settings/:path*',
  ],
}
