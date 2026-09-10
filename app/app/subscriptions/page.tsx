import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { SubscriptionsClient } from '@/components/subscriptions/SubscriptionsClient'

export default async function SubscriptionsPage() {
  try { await requireAuth() } catch { redirect('/login') }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <Suspense><SubscriptionsClient /></Suspense>
    </div>
  )
}
