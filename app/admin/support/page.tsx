/**
 * /admin/support — Support Center page in the Central Control Panel.
 *
 * Server component: verifies admin session, passes identity to the client
 * component which owns all interactive state.
 */
import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { SupportClient } from './SupportClient'

export const metadata = {
  title: 'Support Center — LifeFlow Admin',
}

export default async function AdminSupportPage() {
  let admin
  try {
    admin = await requireAdmin({ skipActivityUpdate: true })
  } catch (err) {
    handleAdminPageAuthError(err)
  }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="Support Center"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Operations' }, { label: 'Support' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <SupportClient
          adminRole={admin!.role}
          adminId={admin!.adminId}
          adminName={admin!.name}
        />
      </main>
    </div>
  )
}
