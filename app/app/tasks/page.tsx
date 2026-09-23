import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { TasksClient } from '@/components/tasks/TasksClient'

export default async function TasksPage() {
  try { await requireAuth() } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired') ? '/api/auth/clear-session?reason=session_expired' : '/login')
  }
  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <Suspense>
        <TasksClient />
      </Suspense>
    </div>
  )
}
