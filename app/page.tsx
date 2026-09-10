import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'

/**
 * Root route: redirect authenticated users to the dashboard,
 * unauthenticated users to the login page.
 * The middleware also handles this, but this server component
 * provides an extra layer for the bare `/` path.
 */
export default async function RootPage() {
  const session = await getSession()

  if (session.isLoggedIn && session.userId) {
    redirect('/app/dashboard')
  } else {
    redirect('/login')
  }
}
