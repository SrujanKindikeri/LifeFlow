/**
 * lib/auth/otp.ts — Shared OTP generation helper for Email OTP 2FA.
 *
 * Extracted so every route (enable-request, disable-request, login, resend)
 * uses the exact same algorithm and there is no risk of generating two
 * different OTP values for the hash vs the email.
 *
 * SECURITY RULES:
 *  - One call to generateEmailOtp() produces ONE otp + ONE otpHash.
 *  - Store otpHash in MongoDB.
 *  - Pass otp to the email template ONLY.
 *  - Never log otp.  Never return it in an API response.
 *  - Never call this function twice for the same challenge.
 *
 * SERVER-ONLY — never import from client components.
 */

import crypto from 'crypto'

/** OTP validity window in minutes (10). */
export const EMAIL_OTP_VALID_MINUTES = 10

/** Maximum incorrect attempts before an OTP is invalidated (5). */
export const EMAIL_OTP_MAX_ATTEMPTS = 5

/** Minimum seconds between resend requests (60). */
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60

/**
 * Generate a cryptographically secure 6-digit OTP and its SHA-256 hash.
 *
 * Uses crypto.randomBytes(3) → 24-bit unsigned int → modulo 1_000_000 →
 * zero-padded to 6 digits.  This gives a uniform distribution over
 * 000000–999999, including leading-zero codes such as 012345.
 *
 * Returns:
 *   otp     — raw 6-digit string.  Put into email only; discard after.  Never log.
 *   otpHash — SHA-256 hex digest.  Store in MongoDB.
 *
 * IMPORTANT: Call this function exactly ONCE per challenge.
 * Use the returned { otp, otpHash } together:
 *   - save otpHash to DB
 *   - send otp in email
 * Do NOT call it again for the same challenge.
 */
export function generateEmailOtp(): { otp: string; otpHash: string } {
  const raw     = crypto.randomBytes(3).readUIntBE(0, 3) % 1_000_000
  const otp     = String(raw).padStart(6, '0')        // preserve leading zeros
  const otpHash = crypto.createHash('sha256').update(otp, 'utf8').digest('hex')
  return { otp, otpHash }
}

/**
 * Hash a raw OTP string submitted by a user for constant-time DB comparison.
 * Uses the same SHA-256 algorithm as generateEmailOtp().
 * Returns null if the input is falsy or not a 6-digit string.
 */
export function hashSubmittedOtp(rawOtp: string | null | undefined): string | null {
  if (!rawOtp || typeof rawOtp !== 'string') return null
  const trimmed = rawOtp.trim()
  if (!/^\d{6}$/.test(trimmed)) return null
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex')
}
