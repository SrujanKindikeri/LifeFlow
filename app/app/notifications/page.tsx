import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'

export default async function NotificationsPage() {
  try {
    await requireAuth()
  } catch {
    redirect('/login')
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <NotificationsClient />
    </div>
  )
}
