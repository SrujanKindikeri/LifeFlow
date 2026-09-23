import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'

export default async function NotificationsPage() {
  try {
    await requireAuth()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired') ? '/api/auth/clear-session?reason=session_expired' : '/login')
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <NotificationsClient />
    </div>
  )
}
