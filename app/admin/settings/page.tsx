import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { SettingsClient } from './SettingsClient'

export default async function AdminSettingsPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Settings" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'System' }, { label: 'Settings' }]} />
      <main className="flex-1 p-4 lg:p-6"><SettingsClient adminRole={admin!.role} /></main>
    </div>
  )
}
