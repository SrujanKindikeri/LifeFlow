import { requireAdmin, handleAdminPageAuthError } from '@/lib/admin-auth'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { UserProfileClient } from '@/components/admin/UserProfileClient'

export default async function UserProfileDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>
}) {
  let admin
  try { admin = await requireAdmin({ skipActivityUpdate: true }) }
  catch (err) { handleAdminPageAuthError(err) }

  const { publicId } = await params

  return (
    <div className="flex flex-col min-h-screen">
      <AdminHeader
        title="User Intelligence Profile"
        adminName={admin!.name}
        adminRole={admin!.role}
        breadcrumb={[
          { label: 'Intelligence' },
          { label: 'User Profiles', href: '/admin/user-profiles' },
          { label: publicId },
        ]}
      />
      <main className="flex-1 p-4 lg:p-6">
        <UserProfileClient publicId={publicId} />
      </main>
    </div>
  )
}
