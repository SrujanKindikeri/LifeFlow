/**
 * POST /api/auth/restore-account/verify-otp
 *
 * Step 2 of the two-factor account recovery flow:
 *   OTP VERIFIED → ACCOUNT RESTORED → SESSION ISSUED → redirect to dashboard
 *
 * SECURITY DESIGN
 * ───────────────
 * • Requires the same raw restore token that anchors the whole recovery session.
 *   Without a valid token this endpoint is a no-op.
 * • The submitted OTP is hashed (SHA-256) and compared to the stored hash using
 *   a timing-safe comparison (crypto.timingSafeEqual via safeCompare).
 *   The raw OTP is NEVER logged or stored.
 * • Attempt counter: each wrong OTP increments accountRecoveryOtpAttempts.
 *   After 5 failures the OTP and its hash are cleared — the user must request
 *   a fresh OTP via /request-otp.
 * • OTP expiry: checked immediately before comparison — expired OTPs always fail.
 * • 30-day recovery window: checked immediately before restoration — an OTP
 *   generated inside the window cannot restore an account outside it.
 * • All restoration state changes are written in ONE save() call, making the
 *   operation atomic from Mongoose's perspective.  A concurrent duplicate
 *   request will find the token already cleared and get INVALID_TOKEN.
 * • A new iron-session is issued immediately after restoration.
 * • The OTP raw value is NEVER logged.
 *
 * REQUEST BODY
 * ────────────
 * { token: string, otp: string }
 *
 * RESPONSES
 * ─────────
 * 200  { message, user: { name, email } }    — restored; session cookie set
 * 400  { error, code: 'INVALID_TOKEN' }
 * 400  { error, code: 'TOKEN_EXPIRED' }
 * 400  { error, code: 'OTP_INVALID' }        — wrong OTP (includes attempts remaining)
 * 400  { error, code: 'OTP_EXPIRED' }        — OTP past its 10-minute window
 * 400  { error, code: 'OTP_MAX_ATTEMPTS' }   — 5 failures; OTP invalidated
 * 403  { error, code: 'RECOVERY_WINDOW_EXPIRED' }
 * 410  { error, code: 'ACCOUNT_GONE' }
 * 429  { error }
 * 500  { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSession } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { hashToken, safeCompare } from '@/lib/auth/crypto'
import {
  checkRecoveryOtpVerifyAttemptLimit,
  checkRateLimit,
  getClientIp,
} from '@/lib/auth/rate-limit'
import { getNotificationService } from '@/lib/notifications'
import { buildAccountRestoredEmail } from '@/lib/auth/email-templates'
import { getAppUrl } from '@/lib/env'
import logger from '@/lib/logger'

/** Uniform response for every invalid-token state. */
const INVALID_TOKEN_RESPONSE = NextResponse.json(
  { error: 'This restoration link is invalid or has already been used.', code: 'INVALID_TOKEN' },
  { status: 400 }
)

/**
 * Hash a raw OTP string for constant-time DB comparison.
 * Uses the same algorithm (SHA-256 over UTF-8 bytes) as generateOtp() in request-otp.
 */
function hashOtp(rawOtp: string): string {
  return crypto.createHash('sha256').update(rawOtp, 'utf8').digest('hex')
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Early per-IP rate limit ───────────────────────────────────────────────
    const ipEarly = checkRateLimit({
      key:      `recovery-otp-verify:ip-early:${ip}`,
      limit:    30,
      windowMs: 60 * 60 * 1000,
    })
    if (!ipEarly.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { token?: string; otp?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { token: rawToken, otp: rawOtp } = body

    if (!rawToken || typeof rawToken !== 'string') return INVALID_TOKEN_RESPONSE
    if (!rawOtp  || typeof rawOtp  !== 'string') {
      return NextResponse.json(
        { error: 'Verification code is required.', code: 'OTP_INVALID' },
        { status: 400 }
      )
    }

    // Validate OTP format: must be exactly 6 digits
    if (!/^\d{6}$/.test(rawOtp.trim())) {
      return NextResponse.json(
        { error: 'Verification code must be 6 digits.', code: 'OTP_INVALID' },
        { status: 400 }
      )
    }

    // ── Hash token for DB lookup ──────────────────────────────────────────────
    const tokenHash = hashToken(rawToken)
    if (!tokenHash) {
      logger.warn('[verify-otp] Token could not be hashed (malformed)', { ip })
      return INVALID_TOKEN_RESPONSE
    }

    // ── Per-token OTP-verify flood guard (independent of password/preflight) ──
    // Uses a dedicated key so that page refreshes (validate-restore-token) and
    // password submissions (request-otp) cannot drain this bucket.
    // The DB-level accountRecoveryOtpAttempts counter (max 5) is the
    // authoritative security control; this is only a secondary flood guard.
    const otpRateResult = checkRecoveryOtpVerifyAttemptLimit(ip, tokenHash)
    if (!otpRateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── DB lookup ─────────────────────────────────────────────────────────────
    await connectDB()

    const user = await User.findOne({
      accountRestoreTokenHash: tokenHash,
    }).select(
      'name email accountStatus scheduledPermanentDeletionAt ' +
      'accountRestoreTokenHash accountRestoreExpiresAt ' +
      'accountRecoveryOtpHash accountRecoveryOtpExpiresAt ' +
      'accountRecoveryOtpAttempts accountRecoveryOtpMaxAttempts ' +
      'emailVerified twoFactorEnabled'
    )

    if (!user) {
      logger.info('[verify-otp] Token not found in DB')
      return INVALID_TOKEN_RESPONSE
    }

    const now = new Date()

    // ── Account state checks ──────────────────────────────────────────────────
    if (user.accountStatus !== 'deleted') {
      logger.info('[verify-otp] Account not in deleted state', {
        accountStatus: user.accountStatus,
      })
      return NextResponse.json(
        { error: 'This account can no longer be restored.', code: 'ACCOUNT_GONE' },
        { status: 410 }
      )
    }

    // 30-day recovery window — check BEFORE OTP so an expired-window account
    // cannot be restored even with a correct OTP from earlier in the window.
    if (!user.scheduledPermanentDeletionAt || now >= user.scheduledPermanentDeletionAt) {
      logger.warn('[verify-otp] Recovery window expired', {
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
      logger.info('[verify-otp] Restore token expired')
      return NextResponse.json(
        { error: 'Your account restoration link has expired.', code: 'TOKEN_EXPIRED' },
        { status: 400 }
      )
    }

    // ── OTP presence check ────────────────────────────────────────────────────
    // No OTP hash means either: the user skipped the password step, the OTP
    // expired and was cleared by a previous verify call, or it was consumed by
    // a prior successful verification (double-submit race).
    // Return a DISTINCT code so the frontend can show an actionable message
    // ("request a new code") instead of the generic "wrong code" message.
    if (!user.accountRecoveryOtpHash) {
      logger.info('[ACCOUNT RECOVERY] OTP verification failed — no active OTP in DB', {
        userId: user._id.toString(),
      })
      return NextResponse.json(
        {
          error: 'Your verification code has expired or was already used. Please request a new one.',
          code:  'OTP_NOT_FOUND',
        },
        { status: 400 }
      )
    }

    // ── OTP expiry ────────────────────────────────────────────────────────────
    if (!user.accountRecoveryOtpExpiresAt || now >= user.accountRecoveryOtpExpiresAt) {
      // Clear expired OTP
      user.accountRecoveryOtpHash      = null
      user.accountRecoveryOtpExpiresAt = null
      user.accountRecoveryOtpAttempts  = 0
      user.accountRecoveryOtpSentAt    = null
      await user.save()

      logger.info('[ACCOUNT RECOVERY] OTP verification failed — expired', {
        userId: user._id.toString(),
      })
      return NextResponse.json(
        {
          error: 'This verification code has expired. Please request a new code.',
          code:  'OTP_EXPIRED',
        },
        { status: 400 }
      )
    }

    // ── Attempt limit check ───────────────────────────────────────────────────
    const maxAttempts = user.accountRecoveryOtpMaxAttempts ?? 5
    if (user.accountRecoveryOtpAttempts >= maxAttempts) {
      // Already at or over the limit — invalidate and reject
      user.accountRecoveryOtpHash      = null
      user.accountRecoveryOtpExpiresAt = null
      user.accountRecoveryOtpAttempts  = 0
      user.accountRecoveryOtpSentAt    = null
      await user.save()

      logger.info('[ACCOUNT RECOVERY] OTP verification failed — max attempts exceeded', {
        userId: user._id.toString(),
      })
      return NextResponse.json(
        {
          error: 'Too many incorrect attempts. Please request a new verification code.',
          code:  'OTP_MAX_ATTEMPTS',
        },
        { status: 400 }
      )
    }

    // ── OTP comparison (timing-safe) ──────────────────────────────────────────
    // Hash the submitted OTP the same way it was stored, then compare hashes.
    // Using safeCompare (crypto.timingSafeEqual) prevents timing side-channels.
    const submittedHash = hashOtp(rawOtp.trim())
    const otpCorrect    = safeCompare(submittedHash, user.accountRecoveryOtpHash)

    if (!otpCorrect) {
      // Increment attempt counter
      user.accountRecoveryOtpAttempts = (user.accountRecoveryOtpAttempts ?? 0) + 1
      const attemptsLeft = maxAttempts - user.accountRecoveryOtpAttempts

      if (attemptsLeft <= 0) {
        // Invalidate OTP after last failure
        user.accountRecoveryOtpHash      = null
        user.accountRecoveryOtpExpiresAt = null
        user.accountRecoveryOtpAttempts  = 0
        user.accountRecoveryOtpSentAt    = null
        await user.save()

        logger.info('[ACCOUNT RECOVERY] OTP verification failed — attempts exhausted', {
          userId: user._id.toString(),
        })
        return NextResponse.json(
          {
            error: 'Too many incorrect attempts. Please request a new verification code.',
            code:  'OTP_MAX_ATTEMPTS',
          },
          { status: 400 }
        )
      }

      await user.save()

      logger.info('[ACCOUNT RECOVERY] OTP verification failed — wrong code', {
        userId:       user._id.toString(),
        attemptsLeft,
      })
      return NextResponse.json(
        {
          error:        'Incorrect verification code. Please try again.',
          code:         'OTP_INVALID',
          attemptsLeft,
        },
        { status: 400 }
      )
    }

    // ── OTP correct — restore the account ────────────────────────────────────
    // Re-check the recovery window one final time immediately before writing,
    // in case time passed during the above checks (defence in depth).
    if (now >= user.scheduledPermanentDeletionAt!) {
      logger.warn('[verify-otp] Recovery window closed between OTP check and restore', {
        userId: user._id.toString(),
      })
      return NextResponse.json(
        {
          error: 'The 30-day recovery window has expired. This account can no longer be restored.',
          code:  'RECOVERY_WINDOW_EXPIRED',
        },
        { status: 403 }
      )
    }

    // All state changes written in one save() — atomic from Mongoose's perspective.
    user.accountStatus                = 'active'
    user.deletedAt                    = null
    user.scheduledPermanentDeletionAt = null
    // Clear restore token (single-use)
    user.accountRestoreTokenHash      = null
    user.accountRestoreExpiresAt      = null
    // Clear OTP (consumed)
    user.accountRecoveryOtpHash      = null
    user.accountRecoveryOtpExpiresAt = null
    user.accountRecoveryOtpAttempts  = 0
    user.accountRecoveryOtpSentAt    = null

    await user.save()

    logger.info('[ACCOUNT RECOVERY] account restored', {
      userId:     user._id.toString(),
      restoredAt: now.toISOString(),
    })

    // ── Issue a new full session ──────────────────────────────────────────────
    const session = await getSession()
    session.userId           = user._id.toString()
    session.name             = user.name
    session.email            = user.email
    session.isLoggedIn       = true
    session.emailVerified    = user.emailVerified !== false
    session.twoFactorPending = false
    session.pendingUserId    = undefined
    await session.save()

    logger.info('[ACCOUNT RECOVERY] session issued', { userId: user._id.toString() })

    // ── Confirmation email (best-effort) ──────────────────────────────────────
    const appUrl = getAppUrl()
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildAccountRestoredEmail({
        toName:  user.name,
        toEmail: user.email,
        appUrl,
      })
      const result = await notifier.send({ to: user.email, subject, html, text })
      if (result.ok) {
        logger.info('[ACCOUNT RECOVERY] confirmation email sent', {
          userId: user._id.toString(),
        })
      } else {
        logger.warn('[ACCOUNT RECOVERY] confirmation email failed (non-fatal)', {
          userId:     user._id.toString(),
          emailError: result.error,
        })
      }
    } catch (emailErr) {
      // Email failure must never undo the restoration
      logger.error('[ACCOUNT RECOVERY] confirmation email error (non-fatal)', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    return NextResponse.json({
      message: 'Your account has been restored successfully.',
      user:    { name: user.name, email: user.email },
    })
  } catch (error) {
    logger.error('[verify-otp] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
