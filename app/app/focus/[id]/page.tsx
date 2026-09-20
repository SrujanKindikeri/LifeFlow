import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { FocusModeClient } from '@/components/focus/FocusModeClient'

export default async function FocusPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted') ? '/api/auth/clear-session' : '/login')
  }
  const { id } = await params
  return (
    <Suspense>
      <FocusModeClient taskId={id} />
    </Suspense>
  )
}
