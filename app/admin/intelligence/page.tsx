import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { IntelligenceOverviewClient } from '@/components/admin/IntelligenceOverviewClient'

export default async function IntelligencePage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="User Intelligence"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'Overview' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <IntelligenceOverviewClient />
      </main>
    </div>
  )
}
