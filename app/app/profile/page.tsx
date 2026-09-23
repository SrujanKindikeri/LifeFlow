import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { ProfileClient } from '@/components/profile/ProfileClient'

export default async function ProfilePage() {
  let initialUser: { name: string; email: string; publicId: string }

  try {
    const auth = await requireAuth({ skipActivityUpdate: true })
    initialUser = {
      name:     auth.name,
      email:    auth.email,
      publicId: auth.lifeFlowId,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    redirect(
      msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired'
        ? '/api/auth/clear-session?reason=session_expired'
        : '/login'
    )
  }

  // requireAuth() throws on failure so TypeScript needs the assertion here.
  // The redirect() above ensures we never reach this line without a valid user.
  return <ProfileClient initialUser={initialUser!} />
}
