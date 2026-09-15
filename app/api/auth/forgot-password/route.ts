/**
 * POST /api/auth/forgot-password
 *
 * Initiates the password reset flow.
 *
 * Security design:
 *  - ALWAYS returns a generic 200 response regardless of whether the email
 *    exists.  This prevents account enumeration.
 *  - The raw reset token is constructed here, put in the email URL, and then
 *    immediately discarded.  Only its SHA-256 hash is written to MongoDB.
 *  - The raw token is NEVER logged.  Only safe identifiers (userId) are logged.
 *  - Rate limited per email (cooldown + hourly cap) and per IP.
 *
 * Token lifetime: PASSWORD_RESET_TOKEN_EXPIRY_MINUTES env var (default 15 min).
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { publicEnv } from '@/lib/env'
import { forgotPasswordSchema } from '@/lib/validations'
import User from '@/models/User'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { buildPasswordResetEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import { checkPasswordResetRequestLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

const RESET_TOKEN_EXPIRY_MINUTES =
  parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES ?? '15', 10) || 15

/**
 * Generic response — returned for every request, regardless of outcome.
 * Identical wording for existing accounts, unknown accounts, and rate-limited
 * requests so callers cannot distinguish between them.
 */
const GENERIC_RESPONSE = NextResponse.json({
  message: "If an account exists for this email, we've sent a password reset link.",
})

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    const body = await req.json()

    // ── Input validation ───────────────────────────────────────────────────
    const parsed = forgotPasswordSchema.safeParse(body)
    if (!parsed.success) {
      // Return generic response — don't hint that the email was malformed,
      // as that leaks slightly different information to an attacker.
      return GENERIC_RESPONSE
    }

    const email = parsed.data.email.toLowerCase()

    // ── Rate limiting ──────────────────────────────────────────────────────
    // Checked BEFORE hitting the DB so we don't waste a round-trip on abusive
    // requests.  Still returns the generic response so callers can't detect
    // rate limiting from the response body.
    const rateResult = checkPasswordResetRequestLimit(ip, email)
    if (!rateResult.allowed) {
      // Return generic 200 (not 429) — avoid leaking rate-limit information
      // that could be combined with timing attacks to enumerate accounts.
      return GENERIC_RESPONSE
    }

    await connectDB()

    const user = await User.findOne({ email })

    // Account not found — return generic response without touching the DB further.
    if (!user) {
      return GENERIC_RESPONSE
    }

    // ── Generate reset token ───────────────────────────────────────────────
    // generateVerificationToken() reuses the same crypto primitive used for
    // email verification: crypto.randomBytes(32) → base64url (URL) + SHA-256 (DB).
    // The raw token leaves this function only inside the email URL.
    const { token: rawToken, tokenHash } = generateVerificationToken()
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000)

    // Overwrite any existing pending reset (single active token per account)
    user.passwordResetTokenHash = tokenHash
    user.passwordResetExpiresAt = expiresAt
    await user.save()

    // ── Build reset URL ────────────────────────────────────────────────────
    // Always sourced from NEXT_PUBLIC_APP_URL — works on localhost, AWS, or
    // Azure without any code change between deployments.
    // The full URL (containing the raw token) is never written to any log.
    const resetUrl = `${publicEnv.APP_URL}/reset-password?token=${rawToken}`

    // ── Send email ─────────────────────────────────────────────────────────
    // Fire-and-forget: a failed delivery does NOT expose an error to the caller
    // (that would break account-enumeration protection).  SMTP errors are
    // logged internally for ops visibility but never surfaced in the response.
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildPasswordResetEmail({
        toName:          user.name,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_EXPIRY_MINUTES,
      })
      const result = await notifier.send({
        to:      user.email,
        subject,
        html,
        text,
      })

      if (result.ok) {
        logger.info('[forgot-password] Reset email accepted by provider', {
          userId: user._id.toString(),
        })
      } else {
        // result.error is already sanitised by SmtpProvider — no raw SMTP
        // errors, no passwords, no tokens reach this log line.
        logger.warn('[forgot-password] Reset email delivery failed', {
          userId:        user._id.toString(),
          providerError: result.error,
        })
      }
    } catch (emailErr) {
      logger.error('[forgot-password] Unexpected error from notification service', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    return GENERIC_RESPONSE
  } catch (error) {
    logger.error('[forgot-password] Unhandled error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    // Fall back to the generic message — never leak server errors to the caller
    return GENERIC_RESPONSE
  }
}
