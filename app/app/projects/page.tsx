import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ProjectsClient } from '@/components/projects/ProjectsClient'

export default async function ProjectsPage() {
  try {
    await requireAuth()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect(msg === 'UserNotFound' ? '/api/auth/clear-session' : '/login')
  }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <Suspense>
        <ProjectsClient />
      </Suspense>
    </div>
  )
}
