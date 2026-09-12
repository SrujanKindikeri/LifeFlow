import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { SecurityClient } from '@/components/settings/SecurityClient'

export default async function SecuritySettingsPage() {
  try {
    await requireAuth()
  } catch {
    redirect('/login')
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold tracking-tight mb-1"
          style={{ color: 'var(--text-primary)' }}>
          Security
        </h1>
        <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
          Manage your account security and two-factor authentication.
        </p>
      </div>
      <SecurityClient />
    </div>
  )
}
