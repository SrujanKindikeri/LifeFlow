import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { SessionsClient } from '@/components/admin/SessionsClient'

export default async function SessionsPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="Sessions & Devices"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'Sessions & Devices' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <SessionsClient />
      </main>
    </div>
  )
}
