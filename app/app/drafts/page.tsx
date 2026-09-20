import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { DraftsClient } from '@/components/drafts/DraftsClient'

export default async function DraftsPage() {
  try {
    await requireAuth()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect((msg === 'UserNotFound' || msg === 'AccountDeleted') ? '/api/auth/clear-session' : '/login')
  }

  return <DraftsClient />
}
