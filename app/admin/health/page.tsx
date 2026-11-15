import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { HealthClient } from './HealthClient'

export default async function AdminHealthPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="System Health" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'System' }, { label: 'Health' }]} />
      <main className="flex-1 p-4 lg:p-6"><HealthClient /></main>
    </div>
  )
}
