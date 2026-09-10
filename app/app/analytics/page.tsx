import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { AnalyticsClient } from '@/components/analytics/AnalyticsClient'

export default async function AnalyticsPage() {
  try {
    await requireAuth()
  } catch {
    redirect('/login')
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <AnalyticsClient />
    </div>
  )
}
