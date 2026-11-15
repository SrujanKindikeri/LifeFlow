import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { InvitationsClient } from '@/components/projects/InvitationsClient'

export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string }>
}) {
  try {
    await requireAuth({ skipActivityUpdate: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect(
      (msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired')
        ? '/api/auth/clear-session?reason=session_expired'
        : '/login',
    )
  }

  const sp = await searchParams
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
      <Suspense>
        <InvitationsClient
          autoToken={sp.token ?? null}
          autoAction={(sp.action === 'accept' || sp.action === 'decline') ? sp.action : null}
        />
      </Suspense>
    </div>
  )
}
