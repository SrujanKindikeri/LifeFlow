import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getAppUrl } from '@/lib/env'
import logger from '@/lib/logger'

/**
 * GET /api/auth/clear-session
 *
 * Route Handler that destroys the lifeflow_session cookie and redirects to
 * /login. This endpoint exists because Next.js forbids cookies().set() /
 * cookies().delete() during Server Component render — calling session.destroy()
 * there silently emits no Set-Cookie header, so the stale cookie persists and
 * the browser enters an /app/dashboard ↔ /login redirect loop.
 *
 * Route Handlers DO execute in a context where Set-Cookie headers are sent, so
 * session.destroy() here correctly expires the cookie in the browser.
 *
 * Flow:
 *   stale /app/* request
 *     → requireAuth() throws 'UserNotFound' | 'SessionExpired'
 *     → page redirects to /api/auth/clear-session[?reason=session_expired]
 *     → this handler destroys the session cookie (Set-Cookie: max-age=0)
 *     → 302 redirect to /login[?reason=session_expired]
 *     → proxy sees no valid session → /login renders cleanly
 *
 * Query params:
 *   reason  — optional string passed through to /login so the page can show
 *             a contextual message (e.g. "session_expired").
 *             Only safe values are forwarded; never reflected verbatim.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    await session.destroy()
  } catch (err) {
    // Log but never block — the redirect to /login must always happen so the
    // user can re-authenticate. If destroy() failed the old cookie will be
    // rejected by iron-session on the next request anyway (wrong/missing data).
    logger.warn('[clear-session] session.destroy() failed, redirecting anyway', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }

  // Forward a safe reason param so the login page can show a contextual message.
  // Whitelist the allowed values — never reflect arbitrary user input.
  const rawReason = new URL(req.url).searchParams.get('reason')
  const SAFE_REASONS = ['session_expired'] as const
  const reason = SAFE_REASONS.includes(rawReason as (typeof SAFE_REASONS)[number])
    ? rawReason
    : null

  const loginUrl = new URL('/login', getAppUrl())
  if (reason) loginUrl.searchParams.set('reason', reason)

  // Use a 302 (temporary) so browsers do not cache the clear-session URL as
  // a permanent redirect to /login.
  return NextResponse.redirect(loginUrl, { status: 302 })
}
