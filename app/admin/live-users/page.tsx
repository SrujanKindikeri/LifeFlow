import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { LiveUsersClient } from '@/components/admin/LiveUsersClient'

export default async function LiveUsersPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="Live Users"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'Live Users' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <LiveUsersClient />
      </main>
    </div>
  )
}
