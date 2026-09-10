import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { HabitsClient } from '@/components/habits/HabitsClient'

export default async function HabitsPage() {
  try { await requireAuth() } catch { redirect('/login') }
  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
      <Suspense>
        <HabitsClient />
      </Suspense>
    </div>
  )
}
