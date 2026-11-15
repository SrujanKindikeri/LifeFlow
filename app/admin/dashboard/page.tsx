/**
 * /admin/dashboard — Overview page
 * Server component that loads initial data, then hands off to the client dashboard.
 */
import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader }                 from '@/components/admin/AdminHeader'
import { AdminOverviewClient }         from './OverviewClient'

export default async function AdminDashboardPage() {
  let admin
  try {
    admin = await requireAdmin({ skipActivityUpdate: true })
  } catch (err) {
    handleAdminPageAuthError(err)
  }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="Overview"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Control Panel' }, { label: 'Overview' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <AdminOverviewClient />
      </main>
    </div>
  )
}
