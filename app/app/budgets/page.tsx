import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { BudgetsClient } from '@/components/budgets/BudgetsClient'

export default async function BudgetsPage() {
  try { await requireAuth({ skipActivityUpdate: true }) } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired') ? '/api/auth/clear-session?reason=session_expired' : '/login')
  }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <Suspense><BudgetsClient /></Suspense>
    </div>
  )
}
