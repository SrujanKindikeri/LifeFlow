import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
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
 *     → requireAuth() throws 'UserNotFound'
 *     → page redirects to /api/auth/clear-session
 *     → this handler destroys the session cookie (Set-Cookie: max-age=0)
 *     → 302 redirect to /login
 *     → proxy sees no valid session → /login renders cleanly
 */
export async function GET() {
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

  // Use a 302 (temporary) so browsers do not cache the clear-session URL as
  // a permanent redirect to /login.
  return NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    { status: 302 },
  )
}
