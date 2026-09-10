import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { CalendarClient } from '@/components/calendar/CalendarClient'

export default async function CalendarPage() {
  try { await requireAuth() } catch { redirect('/login') }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <Suspense><CalendarClient /></Suspense>
    </div>
  )
}
