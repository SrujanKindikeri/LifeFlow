/**
 * /admin/user-profiles — User lookup that links to per-user intelligence pages.
 * Displays a searchable list of users; clicking one opens /admin/user-profiles/[publicId].
 */
import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { UserProfilesListClient } from '@/components/admin/UserProfilesListClient'

export default async function UserProfilesPage() {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="User Profiles"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[{ label: 'Intelligence' }, { label: 'User Profiles' }]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <UserProfilesListClient />
      </main>
    </div>
  )
}
