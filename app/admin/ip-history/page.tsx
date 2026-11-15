import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { IPHistoryClient } from '@/components/admin/IPHistoryClient'

export default async function IPHistoryPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="IP History"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'IP History' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <IPHistoryClient />
      </main>
    </div>
  )
}
