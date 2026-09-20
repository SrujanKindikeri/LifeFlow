import { getIronSession, IronSession, SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { getServerEnv } from '@/lib/env'
import { connectDB } from '@/lib/db'
import logger from '@/lib/logger'

export interface SessionData {
  userId: string
  name: string
  email: string
  isLoggedIn: boolean

  /**
   * Whether the user's email address has been verified.
   * Set to true at login time — only users who have verified their email
   * reach the session-creation code in the login route.
   * The proxy uses this to redirect unverified users to /verify-email
   * without hitting the database on every request.
   */
  emailVerified?: boolean

  /**
   * Set to true after password is verified but BEFORE the TOTP step is
   * completed.  Guards the /api/auth/verify-2fa endpoint.
   * Must be false (or absent) for a fully-authenticated session.
   */
  twoFactorPending?: boolean
  /**
   * Holds the userId during the 2FA challenge window so we know which
   * account to complete the login for.  Only valid when twoFactorPending=true.
   */
  pendingUserId?: string
  /**
   * Unix timestamp (ms) when the 2FA challenge was issued.
   * Allows us to expire the pending session after a short window.
   */
  twoFactorPendingAt?: number
}

/**
 * The shape returned by requireAuth().
 * Always server-derived — never trust lifeFlowId from client input.
 */
export interface AuthUser {
  userId: string
  name: string
  email: string
  isLoggedIn: boolean
  /**
   * The authenticated user's LifeFlow ID (LF-XXXXXXXX).
   * Sourced from User.publicId in the database.
   * NEVER trust a lifeFlowId supplied by the client — always use this value.
   */
  lifeFlowId: string
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
      // Only mark the cookie Secure when we are actually running over HTTPS.
      // Using NODE_ENV === 'production' alone would break local HTTP dev if
      // the server is ever started with NODE_ENV=production locally.
      // This check requires BOTH production mode AND an HTTPS app URL.
      secure:
        process.env.NODE_ENV === 'production' &&
        (process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ?? false),
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

/**
 * Verify the session is authenticated and return the authenticated user's
 * identity, including their server-derived lifeFlowId.
 *
 * The lifeFlowId is read from the User document in MongoDB — it is NEVER
 * taken from the request body, query string, or any client-supplied value.
 *
 * Throws Error('Unauthorized') if the session cookie is missing or invalid.
 * Throws Error('UserNotFound') if the session is valid but the user no longer
 *   exists in the database.
 * Re-throws any other error (e.g. MongoDB connection failure) as-is so that
 *   callers can distinguish infrastructure failures from auth failures and
 *   surface the real error rather than silently destroying a valid session.
 */
export async function requireAuth(): Promise<AuthUser> {
  const session = await getSession()

  if (!session.isLoggedIn || !session.userId) {
    throw new Error('Unauthorized')
  }

  // Lazy import to avoid circular dependency at module load time
  const { default: User } = await import('@/models/User')

  // Lazy import mongoose for ObjectId validation
  const { default: mongoose } = await import('mongoose')

  // Guard: session.userId must be a valid 24-char hex MongoDB ObjectId.
  // If it is not (e.g. corrupted or wrong ID type), treat as stale — the
  // caller (clear-session route or page) will handle cookie expiry.
  if (!mongoose.Types.ObjectId.isValid(session.userId)) {
    throw new Error('UserNotFound')
  }

  // NOTE: connectDB() and User.findById() are intentionally NOT wrapped in a
  // try/catch here. If MongoDB is unreachable the error propagates to the
  // caller so it can be distinguished from a genuine auth failure and logged
  // with its real message. Swallowing DB errors here caused the symptom of
  // "session missing or invalid" appearing for Atlas connection problems.
  await connectDB()
  const user = await User.findById(session.userId)
    .select('publicId name email accountStatus')
    .lean<{ publicId: string; name: string; email: string; accountStatus?: string } | null>()

  if (!user) {
    // Session refers to a deleted or non-existent account (stale cookie).
    //
    // IMPORTANT: do NOT call session.destroy() here. requireAuth() is called
    // from Server Component render functions (page.tsx), and Next.js forbids
    // cookies().set() / cookies().delete() during the render phase — the call
    // silently succeeds without emitting a Set-Cookie header, so the browser
    // cookie is never actually cleared. The redirect loop then persists forever.
    //
    // Instead, pages must redirect to /api/auth/clear-session, a Route Handler
    // that runs in a context where Set-Cookie headers ARE sent to the browser.
    //
    // Safe dev diagnostic: log DB name + user count to surface a wrong-database
    // connection (count=0 means wrong DB, not a deleted user).
    if (process.env.NODE_ENV === 'development') {
      try {
        const totalUsers = await User.countDocuments()
        const uid  = session.userId
        const hint = uid.length >= 8 ? `${uid.slice(0, 4)}…${uid.slice(-4)}` : '(short)'
        logger.warn('[AUTH] stale session — userId not found in DB', {
          database_name:          mongoose.connection.db?.databaseName ?? '(unknown)',
          users_collection_count: totalUsers,
          userId_hint:            hint,
        })
      } catch {
        // Non-fatal — count failure must not block the auth flow
      }
    }

    throw new Error('UserNotFound')
  }

  // ── Soft-delete gate ──────────────────────────────────────────────────────
  // If the account has been soft-deleted the session cookie is stale (we
  // invalidate sessions in the delete-account route, but a cookie that was
  // issued before deletion could still arrive here).  Treat it as if the
  // account no longer exists so all protected routes return 401/redirect.
  //
  // accountStatus defaults to 'active' for legacy documents that pre-date
  // the field, so the ?? 'active' fallback keeps existing accounts working.
  if ((user.accountStatus ?? 'active') !== 'active') {
    throw new Error('AccountDeleted')
  }

  return {
    userId:     session.userId,
    name:       session.name!,
    email:      session.email!,
    isLoggedIn: session.isLoggedIn,
    lifeFlowId: user.publicId,
  }
}
