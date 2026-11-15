import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { AdminManagementClient } from './AdminManagementClient'

export default async function AdminManagementPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Admin Management" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'System' }, { label: 'Admin Management' }]} />
      <main className="flex-1 p-4 lg:p-6"><AdminManagementClient currentAdminId={admin!.adminId} adminRole={admin!.role} /></main>
    </div>
  )
}
