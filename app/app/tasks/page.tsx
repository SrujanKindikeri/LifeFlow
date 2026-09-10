import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { TasksClient } from '@/components/tasks/TasksClient'

export default async function TasksPage() {
  try { await requireAuth() } catch { redirect('/login') }
  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <Suspense>
        <TasksClient />
      </Suspense>
    </div>
  )
}
