import { getIronSession, IronSession, SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { getServerEnv, serverEnv } from '@/lib/env'
import { connectDB } from '@/lib/db'
import logger from '@/lib/logger'

// ─── Inactivity timeout constants ─────────────────────────────────────────────

/**
 * How long a session may be idle before it is rejected by the server.
 * Reads SESSION_IDLE_TIMEOUT_MINUTES at runtime; defaults to 60 minutes.
 * A value of 0 disables the inactivity check entirely.
 */
export function getIdleTimeoutMs(): number {
  const minutes = serverEnv.SESSION_IDLE_TIMEOUT_MINUTES
  return minutes > 0 ? minutes * 60 * 1000 : 0
}

/**
 * Activity update throttle: only write a refreshed lastActiveAt cookie when the
 * previous value is older than this threshold.  This avoids a session.save() on
 * every single API request while still keeping the timestamp fresh enough that
 * a genuinely active user is never wrongly expired.
 *
 * Set to 5 minutes — with a 60-minute timeout this means at most one extra
 * cookie write per 5 minutes of activity, and the worst-case clock skew is
 * only 5 minutes (still 55 minutes of true idle time before expiry).
 */
const ACTIVITY_UPDATE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

// ─── Session data shape ───────────────────────────────────────────────────────

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

  /**
   * Unix timestamp (ms) of the last meaningful authenticated request.
   *
   * Set when a full session is established (login / 2FA completion) and
   * refreshed on every authenticated API request, subject to the
   * ACTIVITY_UPDATE_THRESHOLD_MS throttle to avoid unnecessary writes.
   *
   * The server uses this to enforce the SESSION_IDLE_TIMEOUT_MINUTES limit.
   * Background polling routes (e.g. /api/notifications) intentionally bypass
   * activity updates so they cannot keep an otherwise-idle session alive.
   */
  lastActiveAt?: number
}

// ─── AuthUser shape ───────────────────────────────────────────────────────────

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

// ─── Session options ──────────────────────────────────────────────────────────

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
      // The cookie TTL is kept at 7 days. Inactivity enforcement is done
      // in application logic via lastActiveAt, NOT via cookie expiry, because
      // a sliding-window maxAge would require re-issuing the cookie on every
      // request. The 7-day hard cap means a completely abandoned session still
      // expires eventually even if the inactivity check is somehow bypassed.
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  }
}

// ─── Low-level session accessor ───────────────────────────────────────────────

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions())
  return session
}

// ─── Activity helper ──────────────────────────────────────────────────────────

/**
 * Refresh lastActiveAt in the session cookie when the previous value is older
 * than ACTIVITY_UPDATE_THRESHOLD_MS.  If the session is not authenticated, or
 * the timestamp is already fresh, this is a no-op (no cookie write).
 *
 * Call this from authenticated API routes that represent genuine user activity.
 * Do NOT call it from background polling routes (e.g. /api/notifications).
 *
 * @param session - A live iron-session instance already loaded from the cookie.
 */
export async function updateSessionActivity(
  session: IronSession<SessionData>,
): Promise<void> {
  if (!session.isLoggedIn || !session.userId) return

  const now        = Date.now()
  const lastActive = session.lastActiveAt ?? 0

  // Only write if the timestamp is stale beyond the throttle threshold.
  // This means at most one extra session.save() per ACTIVITY_UPDATE_THRESHOLD_MS
  // across ALL API requests from this user, keeping MongoDB / cookie writes low.
  if (now - lastActive >= ACTIVITY_UPDATE_THRESHOLD_MS) {
    session.lastActiveAt = now
    await session.save()
  }
}

// ─── Main auth guard ──────────────────────────────────────────────────────────

/**
 * Verify the session is authenticated and return the authenticated user's
 * identity, including their server-derived lifeFlowId.
 *
 * The lifeFlowId is read from the User document in MongoDB — it is NEVER
 * taken from the request body, query string, or any client-supplied value.
 *
 * Inactivity check:
 *   If SESSION_IDLE_TIMEOUT_MINUTES > 0 and the session's lastActiveAt is
 *   older than the configured timeout, the session is destroyed and
 *   Error('SessionExpired') is thrown.  Callers should redirect to
 *   /api/auth/clear-session (same as UserNotFound) so the stale cookie is
 *   cleared before the /login redirect.
 *
 *   This function also refreshes lastActiveAt (throttled) so that genuine
 *   user activity continuously resets the inactivity window.
 *
 * Throws Error('Unauthorized')      — session cookie missing or invalid.
 * Throws Error('SessionExpired')    — session valid but idle > timeout.
 * Throws Error('UserNotFound')      — session valid but user no longer exists.
 * Throws Error('AccountDeleted')    — account is soft-deleted.
 * Re-throws infrastructure errors   — MongoDB unreachable etc.
 *
 * @param options.skipActivityUpdate  Pass true for background/polling routes
 *   that should NOT reset the inactivity timer (e.g. /api/notifications).
 */
export async function requireAuth(
  options?: { skipActivityUpdate?: boolean }
): Promise<AuthUser> {
  const session = await getSession()

  if (!session.isLoggedIn || !session.userId) {
    throw new Error('Unauthorized')
  }

  // ── Inactivity check ────────────────────────────────────────────────────────
  const idleTimeoutMs = getIdleTimeoutMs()

  if (idleTimeoutMs > 0) {
    const lastActive = session.lastActiveAt

    if (!lastActive) {
      // lastActiveAt absent means this is an old session issued before the
      // inactivity feature was deployed.  Treat it as active now.
      //
      // IMPORTANT: do NOT call session.save() here.  requireAuth() is called
      // from Server Component render functions (page.tsx), and Next.js 16
      // throws "Cookies can only be modified in a Server Action or Route Handler"
      // if cookies are written during the RSC render phase.
      //
      // Old sessions without lastActiveAt are treated as active and given a
      // grace period.  The timestamp will be stamped on the next Route Handler
      // call (e.g. any /api/* request from the page) via updateSessionActivity().
    } else if (Date.now() - lastActive > idleTimeoutMs) {
      // Session has been idle longer than the allowed window.
      //
      // IMPORTANT: do NOT call session.destroy() here — same reason as above.
      // Callers (page.tsx) catch 'SessionExpired' and redirect to
      // /api/auth/clear-session, a Route Handler that runs in a context where
      // Set-Cookie headers ARE emitted, so the cookie is correctly cleared there.
      const idleMinutes = Math.round((Date.now() - lastActive) / 60_000)
      logger.info('[AUTH] session expired due to inactivity', {
        userId:       session.userId,
        idleMinutes,
        timeoutMinutes: idleTimeoutMs / 60_000,
      })
      throw new Error('SessionExpired')
    }
  }

  // ── Lazy imports (avoid circular dependency at module load time) ────────────
  const { default: User }     = await import('@/models/User')
  const { default: mongoose } = await import('mongoose')

  // Guard: session.userId must be a valid 24-char hex MongoDB ObjectId.
  if (!mongoose.Types.ObjectId.isValid(session.userId)) {
    throw new Error('UserNotFound')
  }

  // NOTE: connectDB() and User.findById() are intentionally NOT wrapped in a
  // try/catch here. If MongoDB is unreachable the error propagates to the
  // caller so it can be distinguished from a genuine auth failure and logged
  // with its real message.
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
  if ((user.accountStatus ?? 'active') !== 'active') {
    throw new Error('AccountDeleted')
  }

  // ── Refresh activity timestamp (throttled) ────────────────────────────────
  // Skip for Server Component render callers — cookie writes are forbidden
  // during the RSC render phase in Next.js 16 and throw a hard error.
  // All page.tsx callers MUST pass { skipActivityUpdate: true }.
  // Activity is refreshed instead by Route Handlers (API routes) which run
  // in a context where Set-Cookie headers are permitted.
  if (!options?.skipActivityUpdate) {
    await updateSessionActivity(session)
  }

  return {
    userId:     session.userId,
    name:       session.name!,
    email:      session.email!,
    isLoggedIn: session.isLoggedIn,
    lifeFlowId: user.publicId,
  }
}
