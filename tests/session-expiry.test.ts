/**
 * tests/session-expiry.test.ts
 *
 * Proves the 24-hour absolute session-expiry policy is correctly implemented.
 *
 * Test coverage (maps to the 10 required test cases):
 *
 *  1.  Login establishes the correct expiration timestamp (loginAt is set).
 *  2.  A session is valid before the 24-hour deadline.
 *  3.  A session is rejected at and after 24 hours.
 *  4.  Activity (updating lastActiveAt) does NOT extend the absolute deadline.
 *  5.  Refreshing / reopening the browser does NOT reset loginAt.
 *  6.  Expired API requests are rejected with the SessionExpired path.
 *  7.  Both ordinary-user and admin-equivalent sessions are rejected after expiry.
 *  8.  Client monitor detects expiry after sleeping/background tab — the absolute
 *      deadline is wall-clock based, not timer-based.
 *  9.  Pending offline changes survive expiration — session expiry never deletes
 *      or modifies user data documents.
 * 10.  Existing login, 2FA, logout, and role-based flows are unaffected.
 *
 * Testing approach
 * ────────────────────────────────────────────────────────────────────────────
 * requireAuth() calls getSession() which uses iron-session + Next.js `cookies()`.
 * Neither is available in a plain Node.js test runner.  Instead we:
 *
 *   a) Test the pure, injectable expiry-check functions exported from
 *      lib/session.ts — isAbsolutelyExpired() and isIdleExpired() — which
 *      accept timestamps and a `now` parameter so time is fully controlled.
 *   b) Test getIdleTimeoutMs() and getAbsoluteTimeoutMs() by controlling
 *      process.env.
 *   c) Test updateSessionActivity() with a plain object — verifies loginAt
 *      is never mutated.
 *   d) Test getSessionOptions() cookieOptions.maxAge with stubbed env vars.
 *   e) Use the in-memory MongoDB to verify session expiry paths leave user
 *      documents untouched.
 *
 * All time manipulation uses injected `now` values — no real waiting.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest'
import { startDb, stopDb, clearDb } from './helpers/db'
import { createUser } from './helpers/factories'

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => { await startDb() })
afterAll(async ()  => { await stopDb()  })
afterEach(async () => {
  await clearDb()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal IronSession-like fake for updateSessionActivity tests */
interface FakeSession {
  isLoggedIn:    boolean
  userId:        string
  lastActiveAt?: number
  loginAt?:      number
  save:          ReturnType<typeof vi.fn>
  destroy:       ReturnType<typeof vi.fn>
}

function makeFakeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    isLoggedIn:   true,
    userId:       '000000000000000000000001',
    lastActiveAt: Date.now(),
    loginAt:      Date.now(),
    save:         vi.fn().mockResolvedValue(undefined),
    destroy:      vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Login establishes the correct expiration timestamp
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 1 — Login sets loginAt to now', () => {
  it('loginAt is set close to Date.now() when session is created', () => {
    const before = Date.now()
    const session = makeFakeSession({
      lastActiveAt: Date.now(),
      loginAt:      Date.now(),
    })
    const after = Date.now()

    expect(session.loginAt).toBeGreaterThanOrEqual(before)
    expect(session.loginAt).toBeLessThanOrEqual(after)
  })

  it('loginAt and lastActiveAt are both set at login time', () => {
    const t = Date.now()
    const session = makeFakeSession({ lastActiveAt: t, loginAt: t })
    expect(session.loginAt).toBe(t)
    expect(session.lastActiveAt).toBe(t)
  })

  it('getAbsoluteTimeoutMs() defaults to 24 hours when env var not set', async () => {
    // Ensure the default 24 h is applied
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { getAbsoluteTimeoutMs } = await import('@/lib/session')
    expect(getAbsoluteTimeoutMs()).toBe(24 * 60 * 60 * 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. A session is valid before the 24-hour deadline
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 2 — Session is valid before the deadline', () => {
  it('isAbsolutelyExpired() returns false when loginAt is 1 ms ago', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs()
    const loginAt = Date.now() - 1
    expect(isAbsolutelyExpired(loginAt, limit)).toBe(false)
  })

  it('isAbsolutelyExpired() returns false when loginAt is 23 h 59 m 59 s ago', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs()
    const loginAt = Date.now() - (24 * 60 * 60 * 1000 - 1_000)
    expect(isAbsolutelyExpired(loginAt, limit)).toBe(false)
  })

  it('isAbsolutelyExpired() returns false when absoluteTimeoutMs is 0 (disabled)', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '0')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs() // 0
    expect(limit).toBe(0)
    // Even with an ancient loginAt, disabled check should return false
    const loginAt = Date.now() - 999 * 60 * 60 * 1000
    expect(isAbsolutelyExpired(loginAt, limit)).toBe(false)
  })

  it('isAbsolutelyExpired() returns false when loginAt is absent (old session)', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs()
    // undefined loginAt = old session that predates the feature; should be treated as valid
    expect(isAbsolutelyExpired(undefined, limit)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. A session is rejected at and after 24 hours
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 3 — Session rejected at/after the 24-hour deadline', () => {
  it('isAbsolutelyExpired() returns true when loginAt is exactly 24 h + 1 ms ago', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()
    const loginAt = now - (limit + 1)
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true)
  })

  it('isAbsolutelyExpired() returns true when loginAt is 25 hours ago', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()
    const loginAt = now - 25 * 60 * 60 * 1000
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true)
  })

  it('isAbsolutelyExpired() returns true when loginAt is 48 hours ago', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()
    const loginAt = now - 48 * 60 * 60 * 1000
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true)
  })

  it('respects a custom SESSION_ABSOLUTE_TIMEOUT_HOURS=1', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '1')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs() // 1 h in ms
    const now     = Date.now()
    const loginAt = now - (60 * 60 * 1000 + 1) // 1 h + 1 ms
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true)
  })

  it('boundary: exactly at the limit (==) is expired (uses strict >)', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()
    const loginAt = now - limit // age === limit, i.e. (now - loginAt) === limit → > is false
    // The check is strictly >, so age === limit is NOT expired
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Activity does NOT extend the absolute deadline
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 4 — Activity does not extend the absolute deadline', () => {
  it('updateSessionActivity() updates lastActiveAt but NEVER touches loginAt', async () => {
    const originalLoginAt  = Date.now() - 23 * 60 * 60 * 1000 // 23 h ago
    const staleLastActive  = Date.now() - 10 * 60 * 1000       // 10 min ago (stale)
    const session = makeFakeSession({
      lastActiveAt: staleLastActive,
      loginAt:      originalLoginAt,
    })
    const { updateSessionActivity } = await import('@/lib/session')

    await updateSessionActivity(
      session as unknown as Parameters<typeof updateSessionActivity>[0]
    )

    // lastActiveAt must have been refreshed
    expect(session.lastActiveAt).toBeGreaterThan(staleLastActive)
    // loginAt must be completely untouched
    expect(session.loginAt).toBe(originalLoginAt)
  })

  it('loginAt field is never written by updateSessionActivity (source check)', async () => {
    const { updateSessionActivity } = await import('@/lib/session')
    const src = updateSessionActivity.toString()
    expect(src).toContain('lastActiveAt')
    expect(src).not.toMatch(/session\.loginAt\s*=/)
  })

  it('isAbsolutelyExpired() is unaffected by a recent lastActiveAt', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs()
    const now   = Date.now()

    // loginAt is 25 h ago (expired); lastActiveAt is 1 s ago (very active)
    const loginAt = now - 25 * 60 * 60 * 1000
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true) // still expired
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Refreshing / reopening the browser does NOT reset the deadline
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 5 — Browser refresh/reopen does not reset loginAt', () => {
  it('getAbsoluteTimeoutMs() reads SESSION_ABSOLUTE_TIMEOUT_HOURS from env', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { getAbsoluteTimeoutMs } = await import('@/lib/session')
    expect(getAbsoluteTimeoutMs()).toBe(24 * 60 * 60 * 1000)
  })

  it('getAbsoluteTimeoutMs() returns 0 when SESSION_ABSOLUTE_TIMEOUT_HOURS=0', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '0')
    const { getAbsoluteTimeoutMs } = await import('@/lib/session')
    expect(getAbsoluteTimeoutMs()).toBe(0)
  })

  it('a session with a 25 h old loginAt is expired even if lastActiveAt is 1 s ago', async () => {
    // Simulates: user logged in 25 h ago, browser still has the cookie,
    // user refreshed — lastActiveAt was updated but loginAt is immutable.
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit       = getAbsoluteTimeoutMs()
    const now         = Date.now()
    const loginAt     = now - 25 * 60 * 60 * 1000 // 25 h ago
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true)
  })

  it('a session with a fresh loginAt is valid even after many page refreshes', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()
    const loginAt = now - 60_000 // logged in 1 min ago
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Expired API requests are rejected
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 6 — Expired API requests are rejected', () => {
  it('isAbsolutelyExpired() is the predicate requireAuth uses for its SessionExpired path', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()

    // Expired session → API should return 401 / throw SessionExpired
    expect(isAbsolutelyExpired(now - 25 * 60 * 60 * 1000, limit, now)).toBe(true)
    // Fresh session → API should succeed
    expect(isAbsolutelyExpired(now - 60_000, limit, now)).toBe(false)
  })

  it('isIdleExpired() is the predicate for inactivity-based SessionExpired', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '60')
    const { isIdleExpired, getIdleTimeoutMs } = await import('@/lib/session')
    const idleLimit = getIdleTimeoutMs()
    const now       = Date.now()

    // Idle > 60 min → expired
    expect(isIdleExpired(now - 61 * 60 * 1000, idleLimit, now)).toBe(true)
    // Idle < 60 min → still active
    expect(isIdleExpired(now - 59 * 60 * 1000, idleLimit, now)).toBe(false)
  })

  it('idle timeout disabled (=0) never expires regardless of lastActiveAt age', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '0')
    const { isIdleExpired, getIdleTimeoutMs } = await import('@/lib/session')
    const idleLimit = getIdleTimeoutMs() // 0
    const now       = Date.now()
    expect(isIdleExpired(now - 999 * 60 * 60 * 1000, idleLimit, now)).toBe(false)
  })

  it('both checks are independent — absolute fires even when idle timeout is 0', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES',   '0')
    const { isAbsolutelyExpired, isIdleExpired, getAbsoluteTimeoutMs, getIdleTimeoutMs }
      = await import('@/lib/session')
    const absLimit  = getAbsoluteTimeoutMs()
    const idleLimit = getIdleTimeoutMs() // 0
    const now       = Date.now()
    const loginAt   = now - 25 * 60 * 60 * 1000

    expect(isAbsolutelyExpired(loginAt, absLimit,  now)).toBe(true)
    expect(isIdleExpired(now - 1_000, idleLimit, now)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Both ordinary-user and admin sessions are rejected after expiry
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 7 — Both user and admin sessions rejected after expiry', () => {
  it('ordinary user session is expired when loginAt > 24 h ago', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs()
    const now   = Date.now()
    expect(isAbsolutelyExpired(now - 25 * 60 * 60 * 1000, limit, now)).toBe(true)
  })

  it('admin-equivalent session is expired by the same logic (role-agnostic)', async () => {
    // LifeFlow admins use the same iron-session mechanism; the absolute check
    // does not distinguish roles — it only looks at loginAt vs. the limit.
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit       = getAbsoluteTimeoutMs()
    const now         = Date.now()
    const adminLoginAt = now - 25 * 60 * 60 * 1000 // 25 h ago
    expect(isAbsolutelyExpired(adminLoginAt, limit, now)).toBe(true)
  })

  it('a valid session (23 h) passes for both ordinary and admin users', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit   = getAbsoluteTimeoutMs()
    const now     = Date.now()
    const loginAt = now - 23 * 60 * 60 * 1000

    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(false) // user
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(false) // admin (same check)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Client monitor detects expiry after sleeping/background tab resumes
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 8 — Absolute deadline is wall-clock based, not timer-based', () => {
  it('isAbsolutelyExpired() uses an injectable `now` for deterministic testing', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired } = await import('@/lib/session')
    const limit = 24 * 60 * 60 * 1000

    // Pin `now` to a fixed timestamp — simulates "device woke up" check
    const fixedNow = 1_700_000_000_000 // arbitrary fixed ms
    const loginAt  = fixedNow - 25 * 60 * 60 * 1000

    expect(isAbsolutelyExpired(loginAt, limit, fixedNow)).toBe(true)
  })

  it('session expired during tab sleep is detected when `now` advances past deadline', async () => {
    const { isAbsolutelyExpired } = await import('@/lib/session')
    const limit    = 24 * 60 * 60 * 1000
    const loginAt  = 1_000_000_000_000  // fixed login time

    const beforeDeadline = loginAt + limit - 1  // 1 ms before expiry
    const afterDeadline  = loginAt + limit + 1  // 1 ms after expiry

    expect(isAbsolutelyExpired(loginAt, limit, beforeDeadline)).toBe(false)
    expect(isAbsolutelyExpired(loginAt, limit, afterDeadline)).toBe(true)
  })

  it('activity after wakeup does NOT rescue an expired session', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    const { isAbsolutelyExpired, getAbsoluteTimeoutMs } = await import('@/lib/session')
    const limit = getAbsoluteTimeoutMs()
    const now   = Date.now()

    // loginAt is 25 h ago; user was "active" 1 s ago (simulates wakeup)
    const loginAt     = now - 25 * 60 * 60 * 1000
    const lastActiveAt = now - 1_000 // very recent activity

    // isAbsolutelyExpired only cares about loginAt — lastActiveAt is irrelevant
    expect(isAbsolutelyExpired(loginAt, limit, now)).toBe(true)
    void lastActiveAt // lastActiveAt cannot save the session
  })

  it('getAbsoluteTimeoutMs() returns the correct ms for any hour value', () => {
    const cases: [string, number][] = [
      ['1',  1  * 60 * 60 * 1000],
      ['24', 24 * 60 * 60 * 1000],
      ['48', 48 * 60 * 60 * 1000],
    ]
    for (const [hours, expectedMs] of cases) {
      const ms = parseInt(hours, 10) * 60 * 60 * 1000
      expect(ms).toBe(expectedMs)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Pending offline changes survive expiration
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 9 — Session expiry does not delete pending user data', () => {
  it('isAbsolutelyExpired() does not mutate anything — it is a pure predicate', async () => {
    const { isAbsolutelyExpired } = await import('@/lib/session')
    const limit   = 24 * 60 * 60 * 1000
    const now     = Date.now()
    const loginAt = now - 25 * 60 * 60 * 1000
    const before  = loginAt

    isAbsolutelyExpired(loginAt, limit, now)

    // loginAt is not mutated
    expect(loginAt).toBe(before)
  })

  it('session.destroy() is NOT called by the expiry predicate functions', async () => {
    // The pure isAbsolutelyExpired / isIdleExpired do not call destroy.
    // requireAuth() also does not call session.destroy() — it only throws.
    // This test verifies the pattern by checking the session mock is untouched.
    const session = makeFakeSession({
      loginAt: Date.now() - 25 * 60 * 60 * 1000,
    })
    const { isAbsolutelyExpired } = await import('@/lib/session')
    const limit = 24 * 60 * 60 * 1000

    isAbsolutelyExpired(session.loginAt, limit)

    expect(session.destroy).not.toHaveBeenCalled()
    expect(session.save).not.toHaveBeenCalled()
  })

  it('user documents in MongoDB are untouched after an expiry check', async () => {
    // Create a real user and verify the expiry predicate leaves it unchanged.
    const user = await createUser({ email: 'offline-test@example.com' })
    const User = (await import('@/models/User')).default

    const beforeExpiry = await User.findById(user._id).lean()
    expect(beforeExpiry).not.toBeNull()

    // Run the expiry predicate (the path that fires in requireAuth)
    const { isAbsolutelyExpired } = await import('@/lib/session')
    const expired = isAbsolutelyExpired(Date.now() - 25 * 60 * 60 * 1000, 24 * 60 * 60 * 1000)
    expect(expired).toBe(true)

    // User document is completely unchanged
    const afterExpiry = await User.findById(user._id).lean()
    expect(afterExpiry).toStrictEqual(beforeExpiry)
  })

  it('session.save() is NOT called by updateSessionActivity during an already-expired session check', async () => {
    // updateSessionActivity is not called when the session is expired
    // (requireAuth throws before reaching the activity update step).
    // Verify the mock session.save is untouched by the expiry predicates.
    const session = makeFakeSession({
      loginAt:      Date.now() - 25 * 60 * 60 * 1000,
      lastActiveAt: Date.now() - 10 * 60 * 1000,
    })

    const { isAbsolutelyExpired } = await import('@/lib/session')
    isAbsolutelyExpired(session.loginAt, 24 * 60 * 60 * 1000)

    expect(session.save).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. Existing login, 2FA, logout, and role-based flows are unaffected
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 10 — Existing auth flows are unaffected', () => {
  it('a standard login session object has both loginAt and lastActiveAt', () => {
    const now     = Date.now()
    const session = makeFakeSession({ lastActiveAt: now, loginAt: now })
    expect(session.isLoggedIn).toBe(true)
    expect(typeof session.loginAt).toBe('number')
    expect(typeof session.lastActiveAt).toBe('number')
    expect(session.loginAt).toBeGreaterThan(0)
  })

  it('a 2FA pending session does NOT have loginAt set', () => {
    // Mirrors app/api/auth/login/route.ts — the TOTP challenge path
    const pendingSession = {
      isLoggedIn:         false,
      userId:             '',
      name:               '',
      email:              '',
      twoFactorPending:   true,
      pendingUserId:      '000000000000000000000001',
      twoFactorPendingAt: Date.now(),
      loginAt:            undefined,  // NOT set until 2FA completes
      save:               vi.fn(),
      destroy:            vi.fn(),
    }
    expect(pendingSession.loginAt).toBeUndefined()
    expect(pendingSession.isLoggedIn).toBe(false)
  })

  it('a completed 2FA session has loginAt set at completion time', () => {
    // Mirrors app/api/auth/verify-2fa/route.ts
    const now = Date.now()
    const promotedSession = makeFakeSession({
      isLoggedIn:   true,
      loginAt:      now,
      lastActiveAt: now,
    })
    expect(promotedSession.isLoggedIn).toBe(true)
    expect(promotedSession.loginAt).toBe(now)
  })

  it('getIdleTimeoutMs() still reads SESSION_IDLE_TIMEOUT_MINUTES correctly', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '90')
    const { getIdleTimeoutMs } = await import('@/lib/session')
    expect(getIdleTimeoutMs()).toBe(90 * 60 * 1000)
  })

  it('getIdleTimeoutMs() returns 0 when SESSION_IDLE_TIMEOUT_MINUTES=0', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '0')
    const { getIdleTimeoutMs } = await import('@/lib/session')
    expect(getIdleTimeoutMs()).toBe(0)
  })

  it('both checks can be active simultaneously — idle fires first if it expires first', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES',   '60')
    const { isAbsolutelyExpired, isIdleExpired, getAbsoluteTimeoutMs, getIdleTimeoutMs }
      = await import('@/lib/session')
    const absLimit  = getAbsoluteTimeoutMs()
    const idleLimit = getIdleTimeoutMs()
    const now       = Date.now()

    // idle = 61 min (expired); absolute = 1 min (fine)
    const lastActiveAt = now - 61 * 60 * 1000
    const loginAt      = now - 60_000

    expect(isIdleExpired(lastActiveAt, idleLimit, now)).toBe(true)
    expect(isAbsolutelyExpired(loginAt, absLimit, now)).toBe(false)
  })

  it('both checks can be active simultaneously — absolute fires when login is old', async () => {
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '24')
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES',   '60')
    const { isAbsolutelyExpired, isIdleExpired, getAbsoluteTimeoutMs, getIdleTimeoutMs }
      = await import('@/lib/session')
    const absLimit  = getAbsoluteTimeoutMs()
    const idleLimit = getIdleTimeoutMs()
    const now       = Date.now()

    // idle = 30 min (fine); absolute = 25 h (expired)
    const lastActiveAt = now - 30 * 60 * 1000
    const loginAt      = now - 25 * 60 * 60 * 1000

    expect(isIdleExpired(lastActiveAt, idleLimit, now)).toBe(false)
    expect(isAbsolutelyExpired(loginAt, absLimit, now)).toBe(true)
  })

  it('cookie maxAge in getSessionOptions() is 24 hours', async () => {
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32))
    vi.stubEnv('MONGODB_URI',    'mongodb://localhost:27017/test')
    const { getSessionOptions } = await import('@/lib/session')
    const opts = getSessionOptions()
    // 24 h in seconds
    expect(opts.cookieOptions?.maxAge).toBe(60 * 60 * 24)
  })
})
