import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { AdminProfileClient } from './AdminProfileClient'

export default async function AdminProfilePage() {
  let admin
  try {
    admin = await requireAdmin({ skipActivityUpdate: true })
  } catch (err) {
    handleAdminPageAuthError(err)
  }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="My Profile"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Control Panel' }, { label: 'My Profile' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <AdminProfileClient
          initialAdminId={admin!.adminId}
          initialName={admin!.name}
          initialEmail={admin!.email}
          initialRole={admin!.role}
        />
      </main>
    </div>
  )
}
