/**
 * lib/auth/rate-limit.ts — Simple in-memory rate limiter for auth endpoints.
 *
 * Uses a sliding-window counter per key (IP address, email, or composite key).
 * State lives in the process heap — it is NOT shared across multiple Next.js
 * worker processes or Docker replicas, which is acceptable for a single-replica
 * EC2 / Azure VM deployment.
 *
 * IMPORTANT — SINGLE-PROCESS LIMITATION:
 *   • Counters reset on every process restart (container redeploy, OOM kill, etc.)
 *   • If you run multiple Docker replicas behind a load balancer, each replica
 *     maintains its own independent counter, so an attacker can exceed the rate
 *     limit by distributing attempts across replicas.
 *   • For multi-replica deployments, replace the Map below with a Redis-backed
 *     store (e.g. ioredis + a shared Redis instance or Upstash).
 *   • For the current single-container AWS EC2 / Azure VM deployment this is
 *     fully sufficient — the limits apply correctly within that container.
 *
 * SERVER-ONLY — never import from client components.
 */

interface WindowEntry {
  count: number
  windowStartMs: number
}

// Module-level store: key → {count, windowStartMs}
const store = new Map<string, WindowEntry>()

// Periodically sweep expired entries to prevent memory growth.
// Run every 10 minutes.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

function sweep(windowMs: number): void {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStartMs > windowMs) {
      store.delete(key)
    }
  }
}

// Start the background sweep (only in server context)
if (typeof setInterval !== 'undefined') {
  setInterval(() => sweep(60 * 60 * 1000), SWEEP_INTERVAL_MS).unref?.()
}

// ─── Core check function ──────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Identifier for this bucket (IP, email, or composite) */
  key: string
  /** Maximum number of requests allowed within the window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** How many attempts remain in the current window */
  remaining: number
  /** Unix ms timestamp when the window resets */
  resetAt: number
}

/**
 * Check (and increment) a rate-limit bucket.
 *
 * Each call increments the counter for the given key.  If the counter exceeds
 * `limit` within `windowMs` milliseconds, returns `allowed: false`.
 *
 * The window slides: after `windowMs` passes since the first request in the
 * current window, the counter resets.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = opts
  const now     = Date.now()
  const entry   = store.get(key)

  if (!entry || now - entry.windowStartMs > windowMs) {
    // Start a new window
    store.set(key, { count: 1, windowStartMs: now })
    return {
      allowed:   true,
      remaining: limit - 1,
      resetAt:   now + windowMs,
    }
  }

  entry.count += 1
  const resetAt = entry.windowStartMs + windowMs

  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt }
  }

  return {
    allowed:   true,
    remaining: limit - entry.count,
    resetAt,
  }
}

// ─── Pre-configured limiters ──────────────────────────────────────────────────

/**
 * Rate limit for the resend-verification-email endpoint.
 *
 * Three guards are applied in order — all must pass:
 *
 *   1. Cooldown  — per email: at most 1 send per VERIFICATION_RESEND_COOLDOWN_SECONDS
 *      (default 60 s). Prevents rapid hammering even within the hourly budget.
 *
 *   2. Hourly cap — per email: at most VERIFICATION_MAX_RESENDS_PER_HOUR sends
 *      per 60-minute window (default 5).
 *
 *   3. IP cap    — per IP: at most 10 sends per hour across all accounts.
 *      Secondary defence against enumeration from a single origin.
 *
 * All keys are normalised to lowercase so changing email casing cannot bypass
 * the limit.
 */
export function checkResendVerificationLimit(ip: string, email: string): RateLimitResult {
  const normalised = email.toLowerCase()

  // Read timing constants from env at call time so hot-reloads pick them up
  const cooldownSeconds  = parseInt(process.env.VERIFICATION_RESEND_COOLDOWN_SECONDS  ?? '60', 10) || 60
  const maxResendsPerHour = parseInt(process.env.VERIFICATION_MAX_RESENDS_PER_HOUR    ?? '5',  10) || 5

  // ── 1. Per-email cooldown ──────────────────────────────────────────────────
  const cooldownResult = checkRateLimit({
    key:      `resend-verify:cooldown:${normalised}`,
    limit:    1,
    windowMs: cooldownSeconds * 1000,
  })
  if (!cooldownResult.allowed) return cooldownResult

  // ── 2. Hourly cap per email ───────────────────────────────────────────────
  const hourlyResult = checkRateLimit({
    key:      `resend-verify:hourly:${normalised}`,
    limit:    maxResendsPerHour,
    windowMs: 60 * 60 * 1000,
  })
  if (!hourlyResult.allowed) return hourlyResult

  // ── 3. Hourly cap per IP ─────────────────────────────────────────────────
  return checkRateLimit({
    key:      `resend-verify:ip:${ip}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
}

/**
 * Rate limit for the TOTP verify endpoint (both login challenge and setup).
 *   • Per pending session / userId: 5 attempts per 5 minutes
 */
export function checkTotpAttemptLimit(userId: string): RateLimitResult {
  return checkRateLimit({
    key:      `totp-attempt:${userId}`,
    limit:    5,
    windowMs: 5 * 60 * 1000,    // 5 minutes
  })
}

/**
 * Rate limit for the login endpoint itself.
 *   • Per IP:    10 attempts per 5 minutes
 *   • Per email: 5 attempts per 5 minutes
 */
export function checkLoginLimit(ip: string, email: string): RateLimitResult {
  const ipResult = checkRateLimit({
    key:      `login:ip:${ip}`,
    limit:    10,
    windowMs: 5 * 60 * 1000,
  })
  if (!ipResult.allowed) return ipResult

  return checkRateLimit({
    key:      `login:email:${email.toLowerCase()}`,
    limit:    5,
    windowMs: 5 * 60 * 1000,
  })
}

/**
 * Rate limit for recovery-code usage.
 *   • Per userId: 5 attempts per 15 minutes
 */
export function checkRecoveryCodeLimit(userId: string): RateLimitResult {
  return checkRateLimit({
    key:      `recovery-code:${userId}`,
    limit:    5,
    windowMs: 15 * 60 * 1000,
  })
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Extract the real client IP from a Next.js request.
 * Respects X-Forwarded-For (set by load balancers / reverse proxies).
 * Falls back to '0.0.0.0' if no IP can be determined.
 */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; the leftmost is the client
    return forwarded.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') ?? '0.0.0.0'
}
