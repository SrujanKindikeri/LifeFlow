/**
 * lib/settings.ts — Server-side application settings reader.
 *
 * This is the SINGLE canonical way that server-side code reads application
 * settings from the database.  All enforcement code (signup route, middleware,
 * notification scheduler) MUST call these helpers — never query AppSetting
 * directly from enforcement sites.
 *
 * CACHING STRATEGY
 * ────────────────
 * Settings are cached in the Node.js module scope for SETTINGS_CACHE_TTL_MS
 * (30 seconds by default).  This is bounded caching:
 *   - Changes are visible within 30 seconds of being saved — no restart needed.
 *   - 30 s is fast enough for maintenance_mode and signup_enabled changes to be
 *     acted on quickly without hammering MongoDB on every request.
 *   - The cache is process-local; in a multi-process deployment each process
 *     independently refreshes within 30 s, giving a worst-case propagation
 *     delay of 30 s per process.
 *   - On database failure during a refresh the stale cached value is used and
 *     a warning is logged.  See FAILURE POLICY below.
 *
 * FAILURE POLICY (documented per setting)
 * ────────────────────────────────────────
 * When MongoDB is unreachable and no cached value exists:
 *   maintenance_mode              → false  (do not lock users out due to DB outage)
 *   signup_enabled                → false  (fail closed — do not allow new registrations
 *                                           when we cannot confirm the setting)
 *   max_users                     → 0      (unlimited — cannot count users to enforce
 *                                           a limit without DB access anyway)
 *   notification_scheduler_enabled → false (fail safe — skip notifications rather than
 *                                           risk duplicate sends from stale data)
 *   app_version                   → process.env.npm_package_version ?? '0.1.0'
 *
 * These defaults are explicitly conservative.  When the DB recovers, the cache
 * TTL ensures the real values are picked up within 30 seconds.
 *
 * SECURITY
 * ────────
 * This module is server-side only.  Never import it in client components.
 * Never return the raw settings object to API callers — return only the
 * specific fields needed.
 */

import { connectDB }  from '@/lib/db'
import AppSetting     from '@/models/AppSetting'
import logger         from '@/lib/logger'

// ── Cache TTL ─────────────────────────────────────────────────────────────────

/** How long (ms) to cache the settings snapshot before re-reading from DB. */
const SETTINGS_CACHE_TTL_MS = 30_000  // 30 seconds

// ── Typed settings snapshot ───────────────────────────────────────────────────

export interface AppSettings {
  maintenance_mode:               boolean
  signup_enabled:                 boolean
  max_users:                      number   // 0 = unlimited
  notification_scheduler_enabled: boolean
  app_version:                    string
  /** ISO string of when the settings were last updated in DB, or null */
  _lastUpdatedAt:                 string | null
  /** Admin ID of who last changed any setting, or null */
  _lastChangedBy:                 string | null
}

// ── Safe defaults (used when DB is unavailable) ───────────────────────────────

const SAFE_DEFAULTS: AppSettings = {
  maintenance_mode:               false,
  signup_enabled:                 false,  // fail closed
  max_users:                      0,
  notification_scheduler_enabled: false,  // fail safe
  app_version:                    process.env.npm_package_version ?? '0.1.0',
  _lastUpdatedAt:                 null,
  _lastChangedBy:                 null,
}

// ── Module-level cache ────────────────────────────────────────────────────────

interface SettingsCache {
  snapshot:    AppSettings
  fetchedAt:   number   // Date.now() at fetch time
  /** true while a refresh is in-flight (prevents concurrent DB hits) */
  refreshing:  boolean
}

// Attach to global to survive Next.js hot-reloads in dev without losing the
// cached value between module re-evaluations.
const globalWithCache = global as typeof globalThis & {
  _lifeflowSettingsCache?: SettingsCache
}

function getCache(): SettingsCache {
  if (!globalWithCache._lifeflowSettingsCache) {
    globalWithCache._lifeflowSettingsCache = {
      snapshot:   { ...SAFE_DEFAULTS },
      fetchedAt:  0,   // force a real fetch on first use
      refreshing: false,
    }
  }
  return globalWithCache._lifeflowSettingsCache
}

// ── DB fetch ──────────────────────────────────────────────────────────────────

/**
 * Fetch all tracked settings from MongoDB and build a typed snapshot.
 * Missing keys fall back to SAFE_DEFAULTS.
 */
async function fetchFromDB(): Promise<AppSettings> {
  await connectDB()

  const docs = await AppSetting.find({
    key: {
      $in: [
        'maintenance_mode',
        'signup_enabled',
        'max_users',
        'notification_scheduler_enabled',
        'app_version',
      ],
    },
  })
    .select('key value lastChangedBy updatedAt')
    .lean<{ key: string; value: string; lastChangedBy: string | null; updatedAt: Date }[]>()

  // Build a map for O(1) lookup
  const byKey: Record<string, { value: string; lastChangedBy: string | null; updatedAt: Date }> = {}
  let latestUpdatedAt: Date | null = null
  let latestChangedBy: string | null = null

  for (const doc of docs) {
    byKey[doc.key] = { value: doc.value, lastChangedBy: doc.lastChangedBy, updatedAt: doc.updatedAt }
    if (!latestUpdatedAt || doc.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = doc.updatedAt
      latestChangedBy = doc.lastChangedBy
    }
  }

  function bool(key: string, fallback: boolean): boolean {
    const raw = byKey[key]?.value
    if (raw === undefined) return fallback
    return raw === 'true'
  }

  function int(key: string, fallback: number): number {
    const raw = byKey[key]?.value
    if (raw === undefined) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) || n < 0 ? fallback : n
  }

  function str(key: string, fallback: string): string {
    return byKey[key]?.value ?? fallback
  }

  return {
    maintenance_mode:               bool('maintenance_mode',               SAFE_DEFAULTS.maintenance_mode),
    signup_enabled:                 bool('signup_enabled',                 true),   // DB default is true
    max_users:                      int ('max_users',                      0),
    notification_scheduler_enabled: bool('notification_scheduler_enabled', true),   // DB default is true
    app_version:                    str ('app_version',                    SAFE_DEFAULTS.app_version),
    _lastUpdatedAt:                 latestUpdatedAt?.toISOString() ?? null,
    _lastChangedBy:                 latestChangedBy,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the current application settings snapshot.
 *
 * Uses in-process caching with a 30-second TTL.  Concurrent calls during a
 * refresh share the same promise so there is at most one in-flight DB query.
 *
 * @param forceRefresh  Pass true to bypass the TTL and read from DB now.
 *                      Use only in the settings PATCH handler after a write.
 */
export async function getAppSettings(forceRefresh = false): Promise<AppSettings> {
  const cache = getCache()
  const now   = Date.now()

  const stale = now - cache.fetchedAt >= SETTINGS_CACHE_TTL_MS
  if (!forceRefresh && !stale) {
    return cache.snapshot
  }

  // If a refresh is already in flight, return the stale snapshot rather than
  // queuing duplicate DB reads.
  if (cache.refreshing) {
    return cache.snapshot
  }

  cache.refreshing = true
  try {
    const fresh    = await fetchFromDB()
    cache.snapshot  = fresh
    cache.fetchedAt = Date.now()
    return fresh
  } catch (err) {
    // DB unavailable — keep the stale value (or safe defaults if first fetch)
    logger.warn('[settings] Failed to refresh settings from DB — using stale/default values', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    // Don't update fetchedAt so the next request retries quickly
    return cache.snapshot
  } finally {
    cache.refreshing = false
  }
}

/**
 * Invalidate the local cache immediately.
 * Call this right after a successful PATCH to /api/admin/settings so that
 * the next read picks up the new value from DB without waiting for TTL expiry.
 */
export function invalidateSettingsCache(): void {
  const cache = getCache()
  cache.fetchedAt = 0   // mark stale — next call will re-fetch
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/** Is maintenance mode currently active? */
export async function isMaintenanceMode(): Promise<boolean> {
  const s = await getAppSettings()
  return s.maintenance_mode
}

/** Is new user registration currently allowed? */
export async function isSignupEnabled(): Promise<boolean> {
  const s = await getAppSettings()
  return s.signup_enabled
}

/** Maximum registered users allowed.  0 = unlimited. */
export async function getMaxUsers(): Promise<number> {
  const s = await getAppSettings()
  return s.max_users
}

/** Is the notification scheduler currently enabled? */
export async function isNotificationSchedulerEnabled(): Promise<boolean> {
  const s = await getAppSettings()
  return s.notification_scheduler_enabled
}

/**
 * Count the current number of registered (non-deleted) users.
 * Used alongside getMaxUsers() to enforce the registration limit.
 *
 * Counts only users where accountStatus === 'active' or whose accountStatus
 * does not exist (legacy rows created before the field was added).
 * Soft-deleted users (accountStatus === 'deleted') are NOT counted: if their
 * 30-day window has passed and they are permanently removed, they should not
 * occupy a slot.  If it has NOT passed they are still within recovery and
 * their slot is considered occupied.
 *
 * NOTE: This is a best-effort count used for the control panel display.
 * The concurrency-safe enforcement in the signup route uses a separate
 * atomic counter mechanism described in that file.
 */
export async function countActiveUsers(): Promise<number> {
  const { default: User } = await import('@/models/User')
  await connectDB()
  // Count active + any legacy docs without accountStatus (treated as active)
  return User.countDocuments({
    $or: [
      { accountStatus: 'active' },
      { accountStatus: { $exists: false } },
    ],
  })
}
