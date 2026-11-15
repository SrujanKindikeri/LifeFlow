import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { SecurityAuditClient } from '@/components/admin/SecurityAuditClient'

export default async function SecurityAuditPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="Login & Security Audit"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'Security Audit' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <SecurityAuditClient />
      </main>
    </div>
  )
}
