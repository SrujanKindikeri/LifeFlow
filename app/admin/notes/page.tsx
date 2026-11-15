import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { FeaturePage } from '@/components/admin/FeaturePage'

export default async function Page() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  const stats = 'total,pinned,archived'.split(',').map((k) => ({ key: k, label: k.replace(/([A-Z])/g, ' $1').trim() }))
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Notes Management" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'Features' }, { label: 'Notes Management' }]} />
      <main className="flex-1 p-4 lg:p-6">
        <FeaturePage module="notes" title="Notes Management" stats={stats} />
      </main>
    </div>
  )
}
