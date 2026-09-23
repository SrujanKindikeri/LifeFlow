import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getDashboardData } from '@/lib/dashboard'
import { DashboardClient } from './DashboardClient'
import logger from '@/lib/logger'

export default async function DashboardPage() {
  let session
  try {
    session = await requireAuth()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Next.js static-generation guard: during `next build` the App Router
    // attempts to statically pre-render every route. Pages that call cookies()
    // are inherently dynamic and cannot be pre-rendered — Next.js throws this
    // specific error to signal that. It is NOT a session or DB failure; let
    // Next.js handle it normally (it marks the route as dynamic and moves on).
    const isBuildTimeError = message.includes('Dynamic server usage')
    if (isBuildTimeError) {
      throw err   // let Next.js handle the dynamic-route detection as intended
    }

    // Stale session: userId was not found in the database (confirmed reachable).
    // Redirect to the clear-session Route Handler which runs in a context where
    // Set-Cookie headers ARE sent, so it can properly expire the lifeflow_session
    // cookie before redirecting to /login. Do NOT redirect to /login directly —
    // the proxy sees the still-present stale cookie and bounces back to /app/dashboard,
    // creating an infinite loop.
    if (message === 'UserNotFound' || message === 'AccountDeleted' || message === 'SessionExpired') {
      redirect('/api/auth/clear-session?reason=session_expired')
    }

    // No session at all — send straight to login (no stale cookie to clear).
    if (message === 'Unauthorized') {
      redirect('/login')
    }

    // Infrastructure failure (MongoDB unreachable, network error, etc.).
    // Do NOT clear the session — the user IS authenticated, the DB is just down.
    // Re-throw so Next.js error.tsx renders instead of kicking the user out.
    logger.error('[dashboard] infrastructure error', { errorMessage: message })
    throw new Error(message)
  }

  let data
  try {
    data = await getDashboardData(session.userId, session.name, session.email)
  } catch (err) {
    // Re-throw as a plain Error. This is critical: Mongoose error classes (and
    // any other class instances) cannot be serialized by the Next.js App Router
    // when passing data from Server → Client Components. If we let the raw
    // Mongoose error escape here, Next.js throws a secondary "Only plain objects
    // can be passed to Client Components" error that completely masks the real
    // root cause in the UI. By converting to a plain Error we ensure:
    //  1. error.tsx receives a serializable object and renders correctly.
    //  2. The real message (e.g. Atlas IP whitelist) is visible in the console.
    //  3. The cached dead promise in db.ts is already reset, so the next
    //     request will retry the connection from scratch.
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[dashboard] data fetch failed', { errorMessage: message })
    throw new Error(message)
  }

  return <DashboardClient data={data} />
}
