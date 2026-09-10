import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { DraftsClient } from '@/components/drafts/DraftsClient'

export default async function DraftsPage() {
  try {
    await requireAuth()
  } catch {
    redirect('/login')
  }

  return <DraftsClient />
}
