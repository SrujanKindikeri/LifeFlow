import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { UsersClient } from './UsersClient'

export default async function AdminUsersPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }
  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader title="User Management" adminName={admin!.name} adminRole={admin!.role}
        breadcrumb={[{ label: 'Control Panel' }, { label: 'Users' }]} />
      <main className="flex-1 p-4 lg:p-6"><UsersClient adminRole={admin!.role} /></main>
    </div>
  )
}
