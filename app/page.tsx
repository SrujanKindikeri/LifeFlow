import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'

/**
 * Root route: redirect authenticated+verified users to the dashboard,
 * authenticated+unverified users to verify-email, and unauthenticated
 * users to the login page.
 * The middleware also handles /app/*, but this server component covers the
 * bare `/` path which is outside the proxy matcher.
 */
export default async function RootPage() {
  const session = await getSession()

  if (session.isLoggedIn && session.userId) {
    // If the session has emailVerified explicitly set to false, send to
    // verify-email rather than /app/dashboard (which the proxy would bounce
    // anyway — this just avoids the extra hop).
    if (session.emailVerified === false) {
      redirect('/verify-email')
    }
    redirect('/app/dashboard')
  } else {
    redirect('/login')
  }
}
