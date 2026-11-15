import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { AnnouncementsClient } from './AnnouncementsClient'

export default async function AdminAnnouncementsPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="Announcements" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'Operations' }, { label: 'Announcements' }]} />
      <main className="flex-1 p-4 lg:p-6"><AnnouncementsClient adminRole={admin!.role} /></main>
    </div>
  )
}
