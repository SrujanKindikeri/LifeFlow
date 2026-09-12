import { requireAuth, getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getDashboardData } from '@/lib/dashboard'
import { DashboardClient } from './DashboardClient'

export default async function DashboardPage() {
  let session
  try {
    session = await requireAuth()
    console.log('[AUTH] dashboard session present', { userId: session.userId })
  } catch {
    // Destroy the cookie before redirecting to /login.
    // Without this, the proxy sees isLoggedIn=true in the stale cookie and
    // bounces every /login visit straight back to /app/dashboard, creating
    // the ERR_TOO_MANY_REDIRECTS loop.
    console.log('[AUTH] dashboard session missing or invalid — destroying session and redirecting to login')
    try {
      const s = await getSession()
      s.destroy()
    } catch {
      // If we can't destroy (e.g. env missing), still redirect — the loop
      // is broken by the proxy's isVerified check (emailVerified not set in
      // a legacy/corrupt session means the proxy sends to /verify-email, not
      // back to /app/dashboard).
    }
    redirect('/login')
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
    console.error('[dashboard] data fetch failed:', message)
    throw new Error(message)
  }

  return <DashboardClient data={data} />
}
