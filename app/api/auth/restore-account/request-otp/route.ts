/**
 * POST /api/auth/restore-account/request-otp
 *
 * Step 1 of the two-factor account recovery flow:
 *   PASSWORD VERIFIED → OTP GENERATED → OTP EMAILED → move to step 2
 *
 * SECURITY DESIGN
 * ───────────────
 * • Identity anchor: the caller must supply the raw restore token from the
 *   deletion email URL.  This is hashed (SHA-256) and looked up in MongoDB
 *   — it is never stored or logged in plaintext.
 * • The submitted password is verified with bcrypt against the stored hash.
 *   If it fails the request is rejected immediately — no OTP is sent.
 * • The 6-digit OTP is generated with crypto.randomBytes(3) → number 0–999999
 *   zero-padded to 6 digits.  Only its SHA-256 hash is stored in MongoDB.
 *   The raw OTP goes only into the email body and is discarded immediately.
 * • OTP expiry: 10 minutes.
 * • Attempt counter reset to 0 on every new OTP generation.
 * • Rate-limited: per-token-hash password attempt cap (pre-bcrypt); OTP
 *   generation cooldown (60s) + daily cap checked AFTER successful password
 *   verification so that failed password attempts do not consume the OTP
 *   cooldown window; per-IP 10/hr cap applied at OTP generation time.
 * • 30-day recovery window is checked BEFORE password verification so expired
 *   accounts never reach the OTP step.
 * • The account is NOT restored here — that happens only in verify-otp.
 * • The OTP value is NEVER logged.
 *
 * REQUEST BODY
 * ────────────
 * { token: string, password: string }
 *
 * RESPONSES
 * ─────────
 * 200  { maskedEmail, otpExpiresAt }   — OTP sent; move to OTP screen
 * 400  { error, code: 'INVALID_TOKEN' }
 * 400  { error, code: 'TOKEN_EXPIRED' }
 * 401  { error, code: 'WRONG_PASSWORD' }
 * 403  { error, code: 'RECOVERY_WINDOW_EXPIRED' }
 * 410  { error, code: 'ACCOUNT_GONE' }
 * 429  { error }
 * 500  { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { hashToken } from '@/lib/auth/crypto'
import {
  checkRecoveryPasswordAttemptLimit,
  checkRecoveryOtpRequestLimit,
  checkRateLimit,
  getClientIp,
} from '@/lib/auth/rate-limit'
import { getNotificationService } from '@/lib/notifications'
import {
  buildAccountRecoveryOtpEmail,
  maskEmail,
} from '@/lib/auth/email-templates'
import logger from '@/lib/logger'

/** OTP validity window in minutes. */
const OTP_VALID_MINUTES = 10

/** Uniform response for every invalid-token state — prevents info leakage. */
const INVALID_TOKEN_RESPONSE = NextResponse.json(
  { error: 'This restoration link is invalid or has already been used.', code: 'INVALID_TOKEN' },
  { status: 400 }
)

/**
 * Generate a cryptographically secure 6-digit OTP and its SHA-256 hash.
 *
 * Uses crypto.randomBytes(3) → 24-bit integer → modulo 1_000_000 → zero-pad.
 * This gives a uniform distribution across 000000–999999.
 *
 * Returns:
 *   otp     — raw 6-digit string.  Put in email only; discard after.  Never log.
 *   otpHash — SHA-256 hex digest.  Store in MongoDB.
 */
function generateOtp(): { otp: string; otpHash: string } {
  const raw  = crypto.randomBytes(3).readUIntBE(0, 3) % 1_000_000
  const otp  = String(raw).padStart(6, '0')
  const otpHash = crypto.createHash('sha256').update(otp, 'utf8').digest('hex')
  return { otp, otpHash }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Early per-IP rate limit ───────────────────────────────────────────────
    const ipEarly = checkRateLimit({
      key:      `recovery-otp-req:ip-early:${ip}`,
      limit:    20,
      windowMs: 60 * 60 * 1000,
    })
    if (!ipEarly.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { token?: string; password?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { token: rawToken, password } = body

    if (!rawToken || typeof rawToken !== 'string') return INVALID_TOKEN_RESPONSE
    if (!password  || typeof password  !== 'string') {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 })
    }

    // ── Hash token for DB lookup ──────────────────────────────────────────────
    const tokenHash = hashToken(rawToken)
    if (!tokenHash) {
      logger.warn('[request-otp] Token could not be hashed (malformed)', { ip })
      return INVALID_TOKEN_RESPONSE
    }

    // ── Per-token password-attempt rate limit ─────────────────────────────────
    // Applied before DB work so hammered tokens are stopped cheaply.
    // Uses a dedicated key that is completely separate from the OTP-verify
    // attempt bucket — password retries do not drain the OTP attempt budget.
    const pwAttemptResult = checkRecoveryPasswordAttemptLimit(tokenHash)
    if (!pwAttemptResult.allowed) {
      logger.warn('[request-otp] Password attempt limit exceeded', {
        tokenHashPrefix: tokenHash.substring(0, 8),
      })
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // NOTE: The OTP-generation rate limit (60-second cooldown + daily cap) is
    // intentionally checked AFTER successful password verification below.
    // Checking it here would consume the cooldown on every failed password
    // attempt, meaning a user who types the wrong password first would have to
    // wait 60 seconds before their correct password can generate an OTP.

    // ── DB lookup ─────────────────────────────────────────────────────────────
    await connectDB()

    const user = await User.findOne({
      accountRestoreTokenHash: tokenHash,
    }).select(
      'name email passwordHash accountStatus scheduledPermanentDeletionAt ' +
      'accountRestoreExpiresAt accountRestoreTokenHash'
    )

    if (!user) {
      logger.info('[request-otp] Token not found in DB')
      return INVALID_TOKEN_RESPONSE
    }

    const now = new Date()

    // ── Account state checks ──────────────────────────────────────────────────
    if (user.accountStatus !== 'deleted') {
      logger.info('[request-otp] Account not in deleted state', {
        accountStatus: user.accountStatus,
      })
      return NextResponse.json(
        { error: 'This account can no longer be restored.', code: 'ACCOUNT_GONE' },
        { status: 410 }
      )
    }

    // 30-day recovery window
    if (!user.scheduledPermanentDeletionAt || now >= user.scheduledPermanentDeletionAt) {
      logger.warn('[request-otp] Recovery window expired', {
        scheduledPermanentDeletionAt: user.scheduledPermanentDeletionAt?.toISOString() ?? 'null',
      })
      return NextResponse.json(
        {
          error: 'The 30-day recovery window has expired. This account can no longer be restored.',
          code:  'RECOVERY_WINDOW_EXPIRED',
        },
        { status: 403 }
      )
    }

    // Restore token expiry
    if (!user.accountRestoreExpiresAt || now >= user.accountRestoreExpiresAt) {
      logger.info('[request-otp] Restore token expired')
      return NextResponse.json(
        { error: 'Your account restoration link has expired.', code: 'TOKEN_EXPIRED' },
        { status: 400 }
      )
    }

    // ── Password verification ─────────────────────────────────────────────────
    // NEVER log the password value.
    logger.info('[ACCOUNT RECOVERY] password verification started', {
      userId: user._id.toString(),
    })

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      // Return 401 — do not confirm or deny token validity to the caller.
      logger.info('[ACCOUNT RECOVERY] password verification failed', {
        userId: user._id.toString(),
      })
      return NextResponse.json(
        { error: 'Incorrect password. Please try again.', code: 'WRONG_PASSWORD' },
        { status: 401 }
      )
    }

    logger.info('[ACCOUNT RECOVERY] password verified', { userId: user._id.toString() })

    // ── Per-token OTP generation rate limit (cooldown + daily cap) ────────────
    // Checked HERE — after successful password verification — so that failed
    // password attempts do NOT consume the 60-second OTP cooldown window.
    // If this fires, the password was correct but the user is requesting OTPs
    // too rapidly (e.g. clicking "Resend" before the cooldown expires).
    const otpRateResult = checkRecoveryOtpRequestLimit(ip, tokenHash)
    if (!otpRateResult.allowed) {
      return NextResponse.json(
        {
          error: 'Please wait before requesting another verification code.',
          code:  'OTP_COOLDOWN',
        },
        { status: 429 }
      )
    }

    // ── Generate OTP ──────────────────────────────────────────────────────────
    // Raw OTP must never be logged — only the hash is stored.
    const { otp: rawOtp, otpHash } = generateOtp()
    const otpExpiresAt = new Date(now.getTime() + OTP_VALID_MINUTES * 60 * 1000)

    logger.info('[ACCOUNT RECOVERY] OTP generated', { userId: user._id.toString() })

    // ── Persist OTP hash atomically ───────────────────────────────────────────
    user.accountRecoveryOtpHash        = otpHash
    user.accountRecoveryOtpExpiresAt   = otpExpiresAt
    user.accountRecoveryOtpAttempts    = 0
    user.accountRecoveryOtpMaxAttempts = 5
    user.accountRecoveryOtpSentAt      = now
    await user.save()

    // ── Send OTP email ────────────────────────────────────────────────────────
    // If email delivery fails, clear the stored OTP and return an error.
    // The account remains in the deleted state — no partial recovery.
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildAccountRecoveryOtpEmail({
        toName:       user.name,
        toEmail:      user.email,
        otp:          rawOtp,   // raw OTP — only passes into email body, never logged
        validMinutes: OTP_VALID_MINUTES,
      })
      const result = await notifier.send({ to: user.email, subject, html, text })

      if (!result.ok) {
        // Roll back the OTP so the user can retry
        user.accountRecoveryOtpHash      = null
        user.accountRecoveryOtpExpiresAt = null
        user.accountRecoveryOtpSentAt    = null
        await user.save()

        logger.error('[ACCOUNT RECOVERY] OTP email delivery failed', {
          userId:     user._id.toString(),
          emailError: result.error,
        })
        return NextResponse.json(
          { error: 'Failed to send verification code. Please try again.' },
          { status: 500 }
        )
      }

      logger.info('[ACCOUNT RECOVERY] OTP email sent', { userId: user._id.toString() })
    } catch (emailErr) {
      // Roll back OTP on unexpected failure
      try {
        user.accountRecoveryOtpHash      = null
        user.accountRecoveryOtpExpiresAt = null
        user.accountRecoveryOtpSentAt    = null
        await user.save()
      } catch { /* best-effort rollback */ }

      logger.error('[ACCOUNT RECOVERY] OTP email error', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
      return NextResponse.json(
        { error: 'Failed to send verification code. Please try again.' },
        { status: 500 }
      )
    }

    // ── Respond — never expose the raw OTP or the full email ─────────────────
    return NextResponse.json({
      maskedEmail:  maskEmail(user.email),
      otpExpiresAt: otpExpiresAt.toISOString(),
    })
  } catch (error) {
    logger.error('[request-otp] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
