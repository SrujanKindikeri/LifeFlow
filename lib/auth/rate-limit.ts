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

interface StoreEntry extends WindowEntry {
  /** The windowMs used when this entry was created — needed for correct sweep. */
  windowMs: number
}

// Module-level store: key → {count, windowStartMs, windowMs}
const store = new Map<string, StoreEntry>()

// Periodically sweep expired entries to prevent memory growth.
// Run every 10 minutes.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

function sweep(): void {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    // Use each entry's own windowMs so long-lived windows (e.g. 24-hour daily
    // caps) are not evicted prematurely by a shorter sweep interval.
    if (now - entry.windowStartMs > entry.windowMs) {
      store.delete(key)
    }
  }
}

// Start the background sweep (only in server context)
if (typeof setInterval !== 'undefined') {
  setInterval(sweep, SWEEP_INTERVAL_MS).unref?.()
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
    // Start a new window — store windowMs so sweep() can evict with the
    // correct window duration instead of a hardcoded global constant.
    store.set(key, { count: 1, windowStartMs: now, windowMs })
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

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Apply a per-IP rate-limit bucket.
 * When ip is null (no proxy header present) the guard is skipped and the
 * previous allowed result is returned unchanged — callers must never fall back
 * to a shared key like '0.0.0.0', which would make this a global cap.
 */
function checkIpLimit(
  ip: string | null,
  prefix: string,
  limit: number,
  windowMs: number,
  fallback: RateLimitResult,
): RateLimitResult {
  if (ip === null) return fallback
  return checkRateLimit({ key: `${prefix}:${ip}`, limit, windowMs })
}


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
export function checkResendVerificationLimit(ip: string | null, email: string): RateLimitResult {
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
  return checkIpLimit(ip, 'resend-verify:ip', 10, 60 * 60 * 1000, hourlyResult)
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
export function checkLoginLimit(ip: string | null, email: string): RateLimitResult {
  const emailResult = checkRateLimit({
    key:      `login:email:${email.toLowerCase()}`,
    limit:    5,
    windowMs: 5 * 60 * 1000,
  })
  if (!emailResult.allowed) return emailResult

  return checkIpLimit(ip, 'login:ip', 10, 5 * 60 * 1000, emailResult)
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
 *
 * Returns null if no IP can be determined (e.g. direct connection without
 * proxy headers, unit tests, or local dev).  Callers MUST handle null and
 * skip IP-based rate-limit buckets rather than falling back to a shared key
 * like '0.0.0.0', which would make the per-IP cap a global cap across all users.
 */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; the leftmost is the client
    const ip = forwarded.split(',')[0].trim()
    if (ip) return ip
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp && realIp.trim()) return realIp.trim()
  return null
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
export function checkPasswordResetRequestLimit(ip: string | null, email: string): RateLimitResult {
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
  return checkIpLimit(ip, 'pw-reset:ip', 10, 60 * 60 * 1000, hourly)
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
export function checkNotificationTestLimit(ip: string | null, userId: string): RateLimitResult {
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
  return checkIpLimit(ip, 'notif-test:ip', 5, 60 * 60 * 1000, daily)
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
export function checkAccountDeletionLimit(ip: string | null, userId: string): RateLimitResult {
  // Per-user hourly cap
  const userResult = checkRateLimit({
    key:      `account-delete:user:${userId}`,
    limit:    3,
    windowMs: 60 * 60 * 1000,
  })
  if (!userResult.allowed) return userResult

  // Per-IP hourly cap
  return checkIpLimit(ip, 'account-delete:ip', 10, 60 * 60 * 1000, userResult)
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
export function checkAccountRestoreLimit(ip: string | null, userId: string): RateLimitResult {
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
  return checkIpLimit(ip, 'account-restore:ip', 10, 60 * 60 * 1000, userHourly)
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
  ip: string | null,
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
  return checkIpLimit(ip, 'recovery-otp:ip', 10, 60 * 60 * 1000, daily)
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
  ip: string | null,
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
  return checkIpLimit(ip, 'recovery-otp-verify:ip', 20, 60 * 60 * 1000, attempts)
}

/**
 * @deprecated Use checkRecoveryOtpVerifyAttemptLimit instead.
 * Retained for any callers that reference the old name — will be removed in a
 * future cleanup.
 */
export function checkRecoveryOtpVerifyLimit(
  ip: string | null,
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
export function checkEmailOtpRequestLimit(ip: string | null, userId: string): RateLimitResult {
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
  return checkIpLimit(ip, 'email-otp:ip', 20, 60 * 60 * 1000, hourly)
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
export function checkEmailOtpVerifyLimit(ip: string | null, userId: string): RateLimitResult {
  // ── 1. Per-user attempt flood guard ───────────────────────────────────────
  const attempts = checkRateLimit({
    key:      `email-otp-verify:attempt:${userId}`,
    limit:    10,
    windowMs: 15 * 60 * 1000,
  })
  if (!attempts.allowed) return attempts

  // ── 2. Per-IP hourly cap ───────────────────────────────────────────────────
  return checkIpLimit(ip, 'email-otp-verify:ip', 30, 60 * 60 * 1000, attempts)
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
export function checkEmailOtpLoginSendLimit(ip: string | null, userId: string): RateLimitResult {
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
  return checkIpLimit(ip, 'email-otp-login:ip', 20, 60 * 60 * 1000, hourly)
}

// ─── Group Bill manual reminder limiter ──────────────────────────────────────

/**
 * Rate limit for POST /api/group-bills/send-reminder.
 *
 * Guards applied in order — all must pass:
 *   1. Per-sender cooldown — 1 reminder per sender per 60-second window.
 *      Prevents accidental rapid firing even when the frontend button is
 *      momentarily re-enabled (e.g. navigation away and back).
 *   2. Per-sender+recipient daily cap — max 3 reminders to the same person
 *      per calendar day.  Prevents harassment via repeated manual reminders.
 *   3. Per-sender daily cap — max 10 total reminders sent per day.
 *      Broad abuse floor so a sender cannot spam all their contacts.
 *   4. Per-IP hourly cap — max 20 calls per IP per hour.
 *      Secondary defence against scripted bulk requests.
 *
 * The idempotency key on the API route provides an additional server-side
 * guard against double-sends within a single user interaction.
 */
export function checkBillReminderLimit(
  ip: string | null,
  senderId: string,
  recipientKey: string,
): RateLimitResult {
  // ── 1. Per-sender 60-second cooldown ─────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `bill-reminder:cooldown:${senderId}`,
    limit:    1,
    windowMs: 60 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-sender+recipient daily cap ─────────────────────────────────────
  const perRecipientDaily = checkRateLimit({
    key:      `bill-reminder:daily:${senderId}:${recipientKey}`,
    limit:    3,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!perRecipientDaily.allowed) return perRecipientDaily

  // ── 3. Per-sender total daily cap ────────────────────────────────────────
  const senderDaily = checkRateLimit({
    key:      `bill-reminder:sender-daily:${senderId}`,
    limit:    10,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!senderDaily.allowed) return senderDaily

  // ── 4. Per-IP hourly cap ─────────────────────────────────────────────────
  return checkIpLimit(ip, 'bill-reminder:ip', 20, 60 * 60 * 1000, senderDaily)
}

// ─── Support ticket limiters ──────────────────────────────────────────────────

/**
 * Rate limit for POST /api/support/tickets — ticket creation.
 *
 * Guards applied in order — all must pass:
 *   1. Per-user cooldown — 1 ticket per SUPPORT_TICKET_COOLDOWN_SECONDS (default 30 s).
 *      Prevents double-click or rapid-retry on form submission.
 *   2. Per-user daily cap — max SUPPORT_TICKET_DAILY_LIMIT (default 5) tickets per 24 hours.
 *      Prevents spam while allowing legitimate multi-issue users.
 *   3. Per-IP hourly cap — max SUPPORT_TICKET_IP_HOURLY_LIMIT (default 20) ticket-creates
 *      per IP per hour.  SKIPPED when ip is null (no proxy headers available) to prevent
 *      all users resolving to a shared '0.0.0.0' key and consuming a single shared quota.
 *
 * @param ip     — from getClientIp(); null means no IP header is present
 * @param userId — verified server-side session user ID (primary rate-limit key)
 */
export function checkTicketCreateLimit(ip: string | null, userId: string): RateLimitResult {
  const cooldownSeconds = parseInt(process.env.SUPPORT_TICKET_COOLDOWN_SECONDS ?? '30', 10) || 30
  const dailyLimit      = parseInt(process.env.SUPPORT_TICKET_DAILY_LIMIT      ?? '5',  10) || 5
  const ipHourlyLimit   = parseInt(process.env.SUPPORT_TICKET_IP_HOURLY_LIMIT  ?? '20', 10) || 20

  // ── 1. Per-user cooldown ──────────────────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `support-ticket:cooldown:${userId}`,
    limit:    1,
    windowMs: cooldownSeconds * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-user daily cap ─────────────────────────────────────────────────
  const daily = checkRateLimit({
    key:      `support-ticket:daily:${userId}`,
    limit:    dailyLimit,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!daily.allowed) return daily

  // ── 3. Per-IP hourly cap (secondary abuse guard only) ─────────────────────
  // Only applied when a real IP is available.  When ip is null (no proxy
  // headers) we skip this guard entirely rather than sharing '0.0.0.0' across
  // all users, which would turn the cap into a global limit.
  if (ip !== null) {
    return checkRateLimit({
      key:      `support-ticket:ip:${ip}`,
      limit:    ipHourlyLimit,
      windowMs: 60 * 60 * 1000,
    })
  }

  // No IP available — user-scoped guards above are sufficient
  return { allowed: true, remaining: ipHourlyLimit, resetAt: Date.now() + 60 * 60 * 1000 }
}

/**
 * Rate limit for POST /api/support/tickets/[id]/messages — message submission.
 *
 * Guards applied in order — all must pass:
 *   1. Per-user cooldown — 1 message per 2 seconds (prevents double-send).
 *   2. Per-user per-ticket: max 30 messages per 5-minute window.
 *   3. Per-IP hourly cap — max 200 messages per IP per hour.
 */
export function checkMessageSendLimit(ip: string | null, userId: string, ticketId: string): RateLimitResult {
  // ── 1. Per-user 2-second cooldown ─────────────────────────────────────────
  const cooldown = checkRateLimit({
    key:      `support-msg:cooldown:${userId}`,
    limit:    1,
    windowMs: 2 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  // ── 2. Per-user per-ticket burst limit ────────────────────────────────────
  const burst = checkRateLimit({
    key:      `support-msg:burst:${userId}:${ticketId}`,
    limit:    30,
    windowMs: 5 * 60 * 1000,
  })
  if (!burst.allowed) return burst

  // ── 3. Per-IP hourly cap ──────────────────────────────────────────────────
  return checkIpLimit(ip, 'support-msg:ip', 200, 60 * 60 * 1000, burst)
}

// ─── Project collaboration limiters ──────────────────────────────────────────

/**
 * Rate limit for POST /api/projects/[id]/invitations (and resend).
 *
 * Guards:
 *   1. Per-user 5-second cooldown — prevents double-click sends.
 *   2. Per-user hourly cap — max 20 invitations per hour.
 *   3. Per-IP hourly cap — max 50 invitation calls per IP per hour.
 */
export function checkInvitationSendLimit(ip: string | null, userId: string): RateLimitResult {
  const cooldown = checkRateLimit({
    key:      `invitation:cooldown:${userId}`,
    limit:    1,
    windowMs: 5 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  const hourly = checkRateLimit({
    key:      `invitation:hourly:${userId}`,
    limit:    20,
    windowMs: 60 * 60 * 1000,
  })
  if (!hourly.allowed) return hourly

  return checkIpLimit(ip, 'invitation:ip', 50, 60 * 60 * 1000, hourly)
}

/**
 * Rate limit for GET /api/projects/[id]/members/search.
 *
 * Guards:
 *   1. Per-user 1-second cooldown — prevents rapid typing bursts.
 *   2. Per-user per-minute cap — max 60 searches per minute.
 *   3. Per-IP hourly cap — max 300 searches per IP per hour.
 */
export function checkUserSearchLimit(ip: string | null, userId: string): RateLimitResult {
  const cooldown = checkRateLimit({
    key:      `user-search:cooldown:${userId}`,
    limit:    1,
    windowMs: 1 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  const perMinute = checkRateLimit({
    key:      `user-search:minute:${userId}`,
    limit:    60,
    windowMs: 60 * 1000,
  })
  if (!perMinute.allowed) return perMinute

  return checkIpLimit(ip, 'user-search:ip', 300, 60 * 60 * 1000, perMinute)
}

/**
 * Rate limit for POST /api/projects/[id]/messages — project chat message.
 *
 * Guards:
 *   1. Per-user 2-second cooldown — prevents double-click sends.
 *   2. Per-user per-project: max 60 messages per 5-minute window.
 *   3. Per-IP hourly cap — max 300 messages per IP per hour.
 */
export function checkChatMessageLimit(ip: string | null, userId: string, projectId: string): RateLimitResult {
  const cooldown = checkRateLimit({
    key:      `chat-msg:cooldown:${userId}`,
    limit:    1,
    windowMs: 2 * 1000,
  })
  if (!cooldown.allowed) return cooldown

  const burst = checkRateLimit({
    key:      `chat-msg:burst:${userId}:${projectId}`,
    limit:    60,
    windowMs: 5 * 60 * 1000,
  })
  if (!burst.allowed) return burst

  return checkIpLimit(ip, 'chat-msg:ip', 300, 60 * 60 * 1000, burst)
}
