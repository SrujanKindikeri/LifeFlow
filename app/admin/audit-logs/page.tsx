import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { AuditLogsClient } from './AuditLogsClient'

export default async function AdminAuditLogsPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Audit Logs" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'System' }, { label: 'Audit Logs' }]} />
      <main className="flex-1 p-4 lg:p-6"><AuditLogsClient /></main>
    </div>
  )
}
