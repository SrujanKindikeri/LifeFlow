import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ExpensesPageClient } from '@/components/expenses/ExpensesPageClient'

export default async function ExpensesPage() {
  try {
    await requireAuth()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted') ? '/api/auth/clear-session' : '/login')
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      {/* Suspense required because ExpensesPageClient uses useSearchParams */}
      <Suspense>
        <ExpensesPageClient />
      </Suspense>
    </div>
  )
}
