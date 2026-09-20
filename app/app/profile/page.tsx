import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { ProfileClient } from '@/components/profile/ProfileClient'

export default async function ProfilePage() {
  try {
    await requireAuth()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted') ? '/api/auth/clear-session' : '/login')
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-2xl mx-auto">
      <ProfileClient />
    </div>
  )
}
