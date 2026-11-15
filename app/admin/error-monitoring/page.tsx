import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { ErrorMonitoringClient } from '@/components/admin/ErrorMonitoringClient'

export default async function ErrorMonitoringPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="Error Monitoring"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'Error Monitoring' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <ErrorMonitoringClient />
      </main>
    </div>
  )
}
