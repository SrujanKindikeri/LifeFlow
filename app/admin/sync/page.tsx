import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { SyncClient } from './SyncClient'

export default async function AdminSyncPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Data Sync Center" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'Operations' }, { label: 'Data Sync' }]} />
      <main className="flex-1 p-4 lg:p-6"><SyncClient /></main>
    </div>
  )
}
