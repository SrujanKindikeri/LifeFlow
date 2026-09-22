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

// ─── Password reset limiters ──────────────────────────────────────────────────

/**
 * Rate limit for POST /api/auth/forgot-password.
 *
 * Three guards applied in order — all must pass:
 *
 *   1. Cooldown  — per email: 1 request per PASSWORD_RESET_RESEND_COOLDOWN_SECONDS
 *      (default 60 s). Prevents rapid hammering within the hourly budget.
 *
 *   2. Hourly cap — per email: at most PASSWORD_RESET_MAX_PER_HOUR requests
 *      per 60-minute window (default 3).
 *
 *   3. IP cap    — per IP: at most 10 requests per hour across all accounts.
 *      Secondary defence against enumeration from a single origin.
 *
 * The generic response pattern ensures rate-limited responses never reveal
 * whether the email exists in the database.
 */
export function checkPasswordResetRequestLimit(ip: string, email: string): RateLimitResult {
  const normalised = email.toLowerCase()

  const cooldownSeconds = parseInt(process.env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS ?? '60', 10) || 60
  const maxPerHour      = parseInt(process.env.PASSWORD_RESET_MAX_PER_HOUR            ?? '3',  10) || 3

  // ── 1. Per-email cooldown ──────────────────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `pw-reset:cooldown:${normalised}`,
    limit:    1,
    windowMs: cooldownSeconds * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Hourly cap per email ───────────────────────────────────────────────
  const hourly = checkRateLimit({
    key:      `pw-reset:hourly:${normalised}`,
    limit:    maxPerHour,
    windowMs: 60 * 60 * 1000,
  })
  if (!hourly.allowed) return hourly

  // ── 3. Hourly cap per IP ─────────────────────────────────────────────────
  return checkRateLimit({
    key:      `pw-reset:ip:${ip}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
}

/**
 * Rate limit for POST /api/auth/reset-password (token submission attempts).
 *   • Per token hash: 5 attempts per 15 minutes.
 *   • Prevents brute-force guessing against a token bucket even if someone
 *     intercepts an unexpired hash.
 */
export function checkPasswordResetAttemptLimit(tokenHash: string): RateLimitResult {
  return checkRateLimit({
    key:      `pw-reset:attempt:${tokenHash}`,
    limit:    5,
    windowMs: 15 * 60 * 1000,
  })
}

/**
 * Rate limit for POST /api/notifications/test-email.
 *
 * Guards applied in order — all must pass:
 *   1. Per-user cooldown — 1 request per 60 seconds (prevents double-click hammering)
 *   2. Per-user daily cap — 3 requests per 24 hours
 *   3. Per-IP hourly cap — 5 requests per hour (secondary abuse defence)
 *
 * Even after the button disappears from the UI (notificationsTested=true),
 * the endpoint enforces these limits so direct API calls cannot spam SMTP.
 */
export function checkNotificationTestLimit(ip: string, userId: string): RateLimitResult {
  // ── 1. Per-user 60-second cooldown ────────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `notif-test:cooldown:${userId}`,
    limit:    1,
    windowMs: 60 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-user daily cap ─────────────────────────────────────────────────
  const daily = checkRateLimit({
    key:      `notif-test:daily:${userId}`,
    limit:    3,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!daily.allowed) return daily

  // ── 3. Per-IP hourly cap ──────────────────────────────────────────────────
  return checkRateLimit({
    key:      `notif-test:ip:${ip}`,
    limit:    5,
    windowMs: 60 * 60 * 1000,
  })
}

// ─── Account deletion limiter ────────────────────────────────────────────────

/**
 * Rate limit for the DELETE /api/auth/delete-account endpoint.
 *
 * Two guards applied in order:
 *   1. Per-userId: max 3 attempts per 60-minute window.
 *      Prevents rapid cycling through delete→restore→delete.
 *   2. Per-IP: max 10 attempts per hour across all accounts.
 *      Secondary defence against bulk automated deletion.
 *
 * These limits are deliberately lenient enough that a legitimate user who
 * accidentally submits the form twice is never locked out, while still
 * blocking bulk automation.
 */
export function checkAccountDeletionLimit(ip: string, userId: string): RateLimitResult {
  // Per-user hourly cap
  const userResult = checkRateLimit({
    key:      `account-delete:user:${userId}`,
    limit:    3,
    windowMs: 60 * 60 * 1000,
  })
  if (!userResult.allowed) return userResult

  // Per-IP hourly cap
  return checkRateLimit({
    key:      `account-delete:ip:${ip}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
}

// ─── Account restore limiter ─────────────────────────────────────────────────

/**
 * Rate limit for the POST /api/auth/restore-account endpoint.
 *
 * Three guards applied in order:
 *   1. Per-userId: max 1 attempt per 30-second cooldown.
 *      Prevents rapid hammering of the restore endpoint.
 *   2. Per-userId: max 5 attempts per hour.
 *      Prevents brute-force of the password field on restore.
 *   3. Per-IP: max 10 attempts per hour across all accounts.
 *      Secondary defence against distributed brute-force.
 */
export function checkAccountRestoreLimit(ip: string, userId: string): RateLimitResult {
  // Cooldown: 1 attempt per 30 s per user
  const cooldown = checkRateLimit({
    key:      `account-restore:cooldown:${userId}`,
    limit:    1,
    windowMs: 30 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // Hourly cap per user
  const userHourly = checkRateLimit({
    key:      `account-restore:hourly:${userId}`,
    limit:    5,
    windowMs: 60 * 60 * 1000,
  })
  if (!userHourly.allowed) return userHourly

  // Hourly cap per IP
  return checkRateLimit({
    key:      `account-restore:ip:${ip}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
}

// ─── Restore-token attempt limiter ───────────────────────────────────────────

/**
 * Rate limit for POST /api/auth/restore-account when submitting a token.
 *
 * Guards applied in order — all must pass:
 *   1. Per-token-hash: 5 attempts per 15-minute window.
 *      Mirrors the password-reset attempt limit — prevents brute-force even
 *      if an attacker somehow intercepts an unexpired hash.
 *
 * Keyed on the token hash (not a userId) because at the point we check this
 * we may not yet have resolved which user the token belongs to.
 */
export function checkRestoreTokenAttemptLimit(tokenHash: string): RateLimitResult {
  return checkRateLimit({
    key:      `restore-token:attempt:${tokenHash}`,
    limit:    5,
    windowMs: 15 * 60 * 1000,
  })
}

// ─── Account-recovery OTP limiters ───────────────────────────────────────────

/**
 * Rate limit for POST /api/auth/restore-account/request-otp — OTP generation.
 *
 * Guards applied in order — all must pass:
 *   1. Per-token cooldown — 1 OTP request per 60 seconds per restore-token hash.
 *      Prevents rapid OTP-hammering even if the password step was just passed.
 *   2. Per-token daily cap — max 10 OTP requests per recovery session.
 *      Once exhausted the user must restart from the password step.
 *   3. Per-IP hourly cap — 10 requests per hour across all recovery attempts.
 *      Secondary defence against distributed abuse.
 *
 * Keyed on the restore-token hash (not userId) because it is the trust anchor
 * for the whole recovery session and is already rate-limited elsewhere.
 *
 * NOTE: does NOT share the restore-token attempt bucket — that bucket is
 * reserved exclusively for OTP verify calls so it can't be drained by
 * password submissions or token preflight checks.
 */
export function checkRecoveryOtpRequestLimit(
  ip: string,
  tokenHash: string,
): RateLimitResult {
  // ── 1. Per-token 60-second cooldown ───────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `recovery-otp:cooldown:${tokenHash}`,
    limit:    1,
    windowMs: 60 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-token daily cap (max 10 OTPs per recovery attempt) ─────────────
  const daily = checkRateLimit({
    key:      `recovery-otp:daily:${tokenHash}`,
    limit:    10,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!daily.allowed) return daily

  // ── 3. Per-IP hourly cap ──────────────────────────────────────────────────
  return checkRateLimit({
    key:      `recovery-otp:ip:${ip}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
}

/**
 * Rate limit for POST /api/auth/restore-account/request-otp — password attempts.
 *
 * Separate from the OTP-generation cooldown and the OTP-verify attempt bucket.
 * Allows up to 10 password attempts per 15-minute window per restore-token hash.
 * The OTP-verify bucket (checkRecoveryOtpVerifyAttemptLimit) is completely
 * independent so that password retries do not drain the OTP attempt budget.
 */
export function checkRecoveryPasswordAttemptLimit(tokenHash: string): RateLimitResult {
  return checkRateLimit({
    key:      `recovery-pw:attempt:${tokenHash}`,
    limit:    10,
    windowMs: 15 * 60 * 1000,
  })
}

/**
 * Rate limit for POST /api/auth/restore-account/verify-otp — OTP verification.
 *
 * Guards applied in order — all must pass:
 *   1. Per-token OTP-verify attempt cap — max 10 guesses per restore-token hash
 *      per 15-minute window.  The DB-level accountRecoveryOtpAttempts counter
 *      (capped at 5) is the authoritative security control; this rate limiter
 *      is only a secondary flood guard that prevents excessive DB writes from a
 *      rapid request storm.  It is deliberately higher than the DB cap so that
 *      it never fires before the DB cap does.
 *   2. Per-IP hourly cap — 20 verify calls per IP per hour.
 *      Secondary defence against distributed brute-force.
 *
 * IMPORTANT: uses a dedicated key (`recovery-otp-verify:attempt:…`) that is
 * completely separate from `restore-token:attempt:…` so that page refreshes
 * (which call validate-restore-token) and password submissions (which call
 * request-otp) cannot drain this budget.
 */
export function checkRecoveryOtpVerifyAttemptLimit(
  ip: string,
  tokenHash: string,
): RateLimitResult {
  // ── 1. Per-token OTP-verify flood guard ───────────────────────────────────
  const attempts = checkRateLimit({
    key:      `recovery-otp-verify:attempt:${tokenHash}`,
    limit:    10,
    windowMs: 15 * 60 * 1000,
  })
  if (!attempts.allowed) return attempts

  // ── 2. Per-IP hourly cap ──────────────────────────────────────────────────
  return checkRateLimit({
    key:      `recovery-otp-verify:ip:${ip}`,
    limit:    20,
    windowMs: 60 * 60 * 1000,
  })
}

/**
 * @deprecated Use checkRecoveryOtpVerifyAttemptLimit instead.
 * Retained for any callers that reference the old name — will be removed in a
 * future cleanup.
 */
export function checkRecoveryOtpVerifyLimit(
  ip: string,
  tokenHash: string,
): RateLimitResult {
  return checkRecoveryOtpVerifyAttemptLimit(ip, tokenHash)
}

// ─── Email OTP 2FA limiters ───────────────────────────────────────────────────

/**
 * Rate limit for Email OTP 2FA OTP generation (enable / disable / resend).
 *
 * Guards applied in order — all must pass:
 *   1. Per-userId 60-second cooldown — prevents rapid-fire OTP requests.
 *      Checked AFTER successful password verification so failed passwords
 *      don't consume the cooldown window.
 *   2. Per-userId hourly cap — max 10 OTP requests per hour per account.
 *   3. Per-IP hourly cap — 20 requests per IP per hour across all accounts.
 *
 * @param ip     — client IP from getClientIp()
 * @param userId — authenticated user's MongoDB _id string
 */
export function checkEmailOtpRequestLimit(ip: string, userId: string): RateLimitResult {
  // ── 1. Per-user 60-second cooldown ────────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `email-otp:cooldown:${userId}`,
    limit:    1,
    windowMs: 60 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-user hourly cap ─────────────────────────────────────────────────
  const hourly = checkRateLimit({
    key:      `email-otp:hourly:${userId}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
  if (!hourly.allowed) return hourly

  // ── 3. Per-IP hourly cap ───────────────────────────────────────────────────
  return checkRateLimit({
    key:      `email-otp:ip:${ip}`,
    limit:    20,
    windowMs: 60 * 60 * 1000,
  })
}

/**
 * Rate limit for Email OTP 2FA OTP verification attempts (enable / disable / login).
 *
 * Guards applied in order — all must pass:
 *   1. Per-userId attempt flood guard — max 10 guesses per 15 minutes.
 *      The DB-level emailOtpAttempts counter (capped at 5) is the authoritative
 *      security control; this is a secondary flood guard to prevent excessive
 *      DB writes from a rapid request storm.
 *   2. Per-IP hourly cap — 30 verify calls per IP per hour.
 *
 * @param ip     — client IP from getClientIp()
 * @param userId — pending/authenticated user's MongoDB _id string
 */
export function checkEmailOtpVerifyLimit(ip: string, userId: string): RateLimitResult {
  // ── 1. Per-user attempt flood guard ───────────────────────────────────────
  const attempts = checkRateLimit({
    key:      `email-otp-verify:attempt:${userId}`,
    limit:    10,
    windowMs: 15 * 60 * 1000,
  })
  if (!attempts.allowed) return attempts

  // ── 2. Per-IP hourly cap ───────────────────────────────────────────────────
  return checkRateLimit({
    key:      `email-otp-verify:ip:${ip}`,
    limit:    30,
    windowMs: 60 * 60 * 1000,
  })
}

/**
 * Rate limit for the Email OTP 2FA login OTP generation step in the login route.
 *
 * Mirrors checkEmailOtpRequestLimit but keyed differently so login OTP generation
 * and profile-based enable/disable OTP generation have independent buckets.
 *
 * Guards:
 *   1. Per-userId 60-second cooldown
 *   2. Per-userId hourly cap (10/hr)
 *   3. Per-IP hourly cap (20/hr)
 */
export function checkEmailOtpLoginSendLimit(ip: string, userId: string): RateLimitResult {
  // ── 1. Per-user 60-second cooldown ────────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `email-otp-login:cooldown:${userId}`,
    limit:    1,
    windowMs: 60 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-user hourly cap ─────────────────────────────────────────────────
  const hourly = checkRateLimit({
    key:      `email-otp-login:hourly:${userId}`,
    limit:    10,
    windowMs: 60 * 60 * 1000,
  })
  if (!hourly.allowed) return hourly

  // ── 3. Per-IP hourly cap ───────────────────────────────────────────────────
  return checkRateLimit({
    key:      `email-otp-login:ip:${ip}`,
    limit:    20,
    windowMs: 60 * 60 * 1000,
  })
}
