import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PeopleClient } from '@/components/people/PeopleClient'

export default async function PeoplePage() {
  try { await requireAuth() } catch { redirect('/login') }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <Suspense><PeopleClient /></Suspense>
    </div>
  )
}
