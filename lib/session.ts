import { getIronSession, IronSession, SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { getServerEnv } from '@/lib/env'

export interface SessionData {
  userId: string
  name: string
  email: string
  isLoggedIn: boolean
}

/**
 * Returns an IronSession options object with SESSION_SECRET validated at
 * call time (runtime), not at module load time.
 *
 * Exported so middleware (proxy.ts) and other server utilities can use it
 * without triggering eager module-level validation.
 *
 * This keeps `next build` working in Docker / CI where SESSION_SECRET is
 * intentionally absent during the build stage.
 */
export function getSessionOptions(): SessionOptions {
  return {
    password: getServerEnv().SESSION_SECRET,
    cookieName: 'lifeflow_session',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  }
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions())
  return session
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession()
  if (!session.isLoggedIn || !session.userId) {
    throw new Error('Unauthorized')
  }
  return {
    userId: session.userId!,
    name: session.name!,
    email: session.email!,
    isLoggedIn: session.isLoggedIn,
  }
}
