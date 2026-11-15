import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { AnalyticsClient } from './AnalyticsClient'

export default async function AdminAnalyticsPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Analytics" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'System' }, { label: 'Analytics' }]} />
      <main className="flex-1 p-4 lg:p-6"><AnalyticsClient /></main>
    </div>
  )
}
