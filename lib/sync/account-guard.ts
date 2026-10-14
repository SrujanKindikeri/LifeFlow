/**
 * lib/sync/account-guard.ts — Account isolation helpers for offline data.
 *
 * RESPONSIBILITIES
 * ─────────────────
 * 1. Store the current authenticated userId in sessionStorage (cleared on
 *    tab close — survives page reload but NOT browser restart or logout).
 * 2. Detect when a different user logs in and prevent cross-account uploads.
 * 3. Provide the logout safety check: warn when there are pending operations.
 * 4. Clear account-specific IndexedDB data on explicit user request.
 *
 * SECURITY MODEL
 * ──────────────
 * • The clientUserId stored here comes from the server session (/api/auth/me).
 *   It is NOT trusted by the server — the server always re-derives the userId
 *   from the session cookie via requireAuth().
 * • The userId is used ONLY to partition IndexedDB data and prevent mixing.
 * • We never store the userId in localStorage (persistent across sessions).
 *   sessionStorage is deliberately ephemeral — on browser restart the user
 *   must re-authenticate, at which point the userId is refreshed from the server.
 * • We never store passwords, tokens, or session cookies in IndexedDB or
 *   sessionStorage.
 *
 * SHARED DEVICE NOTE
 * ──────────────────
 * On a shared device the local IndexedDB data remains after logout until
 * explicitly cleared. The logout flow in useSync.ts warns the user and offers
 * the option to clear. This is documented in the security policy below.
 */

import { clearUserData, countPendingOps } from '@/lib/db/offline'

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_USER_KEY = 'lf_sync_user_id'

// ─── Active user ─────────────────────────────────────────────────────────────

/**
 * Record the authenticated userId in sessionStorage.
 * Call this right after the session is validated (e.g. on app mount).
 *
 * Returns true if this is a NEW user (different from the previously stored one),
 * which triggers an account-switch safety check in the sync engine.
 */
export function setActiveUser(userId: string): boolean {
  if (typeof sessionStorage === 'undefined') return false

  const previous = sessionStorage.getItem(SESSION_USER_KEY)
  sessionStorage.setItem(SESSION_USER_KEY, userId)
  return previous !== null && previous !== userId
}

/**
 * Return the userId that was active in this browser session.
 * Returns null if no user has been set (fresh tab or after logout).
 */
export function getActiveUser(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(SESSION_USER_KEY)
}

/**
 * Clear the active user from sessionStorage.
 * Called on logout BEFORE clearing IndexedDB so the sync engine cannot
 * accidentally upload the cleared user's data.
 */
export function clearActiveUser(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_USER_KEY)
  }
}

// ─── Account switch guard ─────────────────────────────────────────────────────

/**
 * Verify the current sync operation is for the same user as the active session.
 *
 * Returns 'ok' if the userId matches.
 * Returns 'switched' if a DIFFERENT user is now active (account switch mid-session).
 * Returns 'no_user' if no user is set (e.g. after logout).
 *
 * The sync engine calls this before every outbox flush. If it returns anything
 * other than 'ok', the engine must abort the sync to prevent uploading one
 * user's data under another user's session.
 */
export function checkAccountScope(userId: string): 'ok' | 'switched' | 'no_user' {
  const active = getActiveUser()
  if (!active) return 'no_user'
  if (active !== userId) return 'switched'
  return 'ok'
}

// ─── Logout safety ────────────────────────────────────────────────────────────

export interface LogoutSafetyResult {
  /** Number of unsynced operations in the outbox */
  pendingCount: number
  /** Whether it is safe to proceed without warning the user */
  safe: boolean
}

/**
 * Before logout, check how many pending operations exist for the user.
 * The caller should show a warning dialog if pendingCount > 0.
 */
export async function checkLogoutSafety(userId: string): Promise<LogoutSafetyResult> {
  if (typeof window === 'undefined') return { pendingCount: 0, safe: true }

  try {
    const pendingCount = await countPendingOps(userId)
    return { pendingCount, safe: pendingCount === 0 }
  } catch {
    // IndexedDB not available — safe to proceed
    return { pendingCount: 0, safe: true }
  }
}

// ─── Data clearing ────────────────────────────────────────────────────────────

/**
 * Wipe all locally stored data for userId from IndexedDB.
 *
 * Call this:
 *  1. After the user explicitly confirms clearing local data at logout.
 *  2. When a different user logs in on the same device.
 *
 * IMPORTANT: This permanently destroys any unsynced local changes.
 * The caller must show an appropriate warning before invoking this.
 */
export async function wipeLocalData(userId: string): Promise<void> {
  if (typeof window === 'undefined') return
  clearActiveUser()
  await clearUserData(userId)
}

// ─── Security documentation ───────────────────────────────────────────────────
/**
 * SECURITY LIMITATIONS OF OFFLINE ACCESS ON SHARED DEVICES
 * ──────────────────────────────────────────────────────────
 *
 * When LifeFlow is used in offline mode on a shared device, the following
 * limitations apply:
 *
 * 1. LOCAL DATA PERSISTENCE
 *    IndexedDB data persists after logout until explicitly cleared. Another
 *    person with physical access to the same browser profile could potentially
 *    access locally cached data by opening developer tools. Mitigation: the
 *    logout UI always offers to clear local data; this is strongly recommended
 *    on shared or public devices.
 *
 * 2. SESSION SCOPE
 *    The sync engine uses sessionStorage to track the active user. sessionStorage
 *    is cleared when the tab is closed, preventing accidental data mixing across
 *    different user logins in fresh tabs. However, data in IndexedDB itself is
 *    partitioned by userId and accessible to any script on the same origin.
 *
 * 3. NO ENCRYPTION AT REST
 *    IndexedDB does not encrypt data at rest. An attacker with OS-level or
 *    browser-profile access can read IndexedDB directly. For devices with strict
 *    security requirements, disable offline sync or use OS-level full-disk
 *    encryption.
 *
 * 4. SERVICE WORKER CACHES
 *    The service worker caches ONLY static app-shell assets (HTML, JS, CSS,
 *    icons). It NEVER caches authenticated API responses. User data travels
 *    only through IndexedDB (encrypted in transit via HTTPS, unencrypted at
 *    rest in the browser's IndexedDB store).
 *
 * 5. SENSITIVE FINANCIAL DATA
 *    Expense amounts, subscription fees, and account balances are stored in
 *    IndexedDB as part of the offline cache. Users on shared devices should
 *    explicitly clear local data on logout.
 */
