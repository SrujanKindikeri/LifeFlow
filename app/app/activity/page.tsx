import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ActivityTimelineClient } from '@/components/activity/ActivityTimelineClient'

export default async function ActivityPage() {
  try { await requireAuth() } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired') ? '/api/auth/clear-session?reason=session_expired' : '/login')
  }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
      <Suspense><ActivityTimelineClient /></Suspense>
    </div>
  )
}
