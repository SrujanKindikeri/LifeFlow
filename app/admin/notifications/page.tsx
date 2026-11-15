import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { NotificationsClient } from './NotificationsClient'

export default async function AdminNotificationsPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Notification Center" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'Operations' }, { label: 'Notifications' }]} />
      <main className="flex-1 p-4 lg:p-6"><NotificationsClient adminRole={admin!.role} /></main>
    </div>
  )
}
