/**
 * POST /api/auth/2fa/email/login-verify
 *
 * Second step of the login flow when emailOtpEnabled=true.
 * Validates the Email OTP and, on success, promotes the pending session
 * to a fully-authenticated session.
 *
 * SECURITY DESIGN
 * ───────────────
 * • Requires a twoFactorPending session (set by /api/auth/login).
 *   A fully-authenticated session or missing session is rejected outright.
 * • Pending session TTL: 5 minutes (same as TWO_FA_PENDING_TTL_MS).
 * • Validates purpose="2fa_login" — prevents cross-purpose OTP reuse.
 *   A "2fa_enable" or "2fa_disable" OTP cannot complete a login.
 * • Attempt counter is server-side (DB field emailOtpAttempts).
 *   Frontend counters are never trusted.
 * • After 5 wrong attempts the OTP is invalidated; user must log in again.
 * • Expired OTP always fails.
 * • On success: session is promoted to isLoggedIn=true, OTP cleared.
 *   No full authenticated session is created before OTP is verified.
 * • Raw OTP NEVER logged.
 *
 * WRITE STRATEGY
 * ──────────────
 * All OTP field writes use findByIdAndUpdate + $set instead of user.save().
 * The user document is loaded with a narrow .select() — emailOtpSentAt is not
 * included, so assigning it on the in-memory doc and calling save() would
 * silently drop the assignment.  findByIdAndUpdate bypasses dirty-tracking
 * and always writes the exact fields listed in $set.
 *
 * Session writes still use session.save() — iron-session manages its own state.
 *
 * REQUEST BODY   { otp: string }
 * RESPONSES
 *   200  { message, user: { name, email } }
 *   400  { error, code }
 *   401  { error }
 *   429  { error }
 *   500  { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import User from '@/models/User'
import { hashSubmittedOtp } from '@/lib/auth/otp'
import { safeCompare } from '@/lib/auth/crypto'
import { checkEmailOtpVerifyLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

// Must match TWO_FA_PENDING_TTL_MS exported from login/route.ts
const TWO_FA_PENDING_TTL_MS = 5 * 60 * 1000

/** Clears all OTP fields atomically — no user.save() needed. */
async function clearOtpFields(userId: unknown) {
  await User.findByIdAndUpdate(userId, {
    $set: {
      emailOtpHash:      null,
      emailOtpExpiresAt: null,
      emailOtpAttempts:  0,
      emailOtpSentAt:    null,
      emailOtpPurpose:   null,
    },
  })
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Validate the pending session ──────────────────────────────────────────
    const session = await getSession()

    if (!session.twoFactorPending || !session.pendingUserId || !session.twoFactorPendingAt) {
      return NextResponse.json(
        { error: 'No pending login session. Please log in again.' },
        { status: 401 }
      )
    }

    // ── Check pending session TTL ─────────────────────────────────────────────
    if (Date.now() - session.twoFactorPendingAt > TWO_FA_PENDING_TTL_MS) {
      session.twoFactorPending   = false
      session.pendingUserId      = undefined
      session.twoFactorPendingAt = undefined
      await session.save()
      return NextResponse.json(
        { error: 'Authentication session expired. Please log in again.' },
        { status: 401 }
      )
    }

    const pendingUserId = session.pendingUserId

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { otp?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const rawOtp = body.otp
    if (!rawOtp || typeof rawOtp !== 'string') {
      return NextResponse.json(
        { error: 'Verification code is required.', code: 'OTP_INVALID' },
        { status: 400 }
      )
    }
    if (!/^\d{6}$/.test(rawOtp.trim())) {
      return NextResponse.json(
        { error: 'Verification code must be exactly 6 digits.', code: 'OTP_INVALID' },
        { status: 400 }
      )
    }

    // ── Rate limit ─────────────────────────────────────────────────────────────
    const rateResult = checkEmailOtpVerifyLimit(ip, pendingUserId)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    await connectDB()

    const user = await User.findById(pendingUserId).select(
      'name email emailVerified emailOtpEnabled emailOtpHash emailOtpExpiresAt ' +
      'emailOtpAttempts emailOtpMaxAttempts emailOtpPurpose accountStatus'
    )

    // ── User / 2FA state validation ───────────────────────────────────────────
    if (!user || !user.emailOtpEnabled || user.accountStatus !== 'active') {
      session.twoFactorPending   = false
      session.pendingUserId      = undefined
      session.twoFactorPendingAt = undefined
      await session.save()
      return NextResponse.json(
        { error: 'Invalid session. Please log in again.' },
        { status: 401 }
      )
    }

    // ── Purpose check — must be a login OTP ───────────────────────────────────
    if (user.emailOtpPurpose !== '2fa_login') {
      return NextResponse.json(
        { error: 'No active login challenge. Please log in again.', code: 'OTP_NOT_FOUND' },
        { status: 400 }
      )
    }

    // ── OTP presence check ────────────────────────────────────────────────────
    if (!user.emailOtpHash) {
      logger.info('[2FA login-verify] No active OTP', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'Your verification code has expired or was already used. Please log in again.', code: 'OTP_NOT_FOUND' },
        { status: 400 }
      )
    }

    const now = new Date()

    // ── OTP expiry ────────────────────────────────────────────────────────────
    if (!user.emailOtpExpiresAt || now >= user.emailOtpExpiresAt) {
      await clearOtpFields(user._id)
      logger.info('[2FA login-verify] OTP expired', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'This verification code has expired. Please log in again to receive a new code.', code: 'OTP_EXPIRED' },
        { status: 400 }
      )
    }

    // ── Attempt limit ─────────────────────────────────────────────────────────
    const maxAttempts = user.emailOtpMaxAttempts ?? 5
    if (user.emailOtpAttempts >= maxAttempts) {
      await clearOtpFields(user._id)
      session.twoFactorPending   = false
      session.pendingUserId      = undefined
      session.twoFactorPendingAt = undefined
      await session.save()
      logger.info('[2FA login-verify] Max attempts exceeded', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Please log in again to receive a new code.', code: 'OTP_MAX_ATTEMPTS' },
        { status: 400 }
      )
    }

    // ── OTP comparison (timing-safe) ──────────────────────────────────────────
    const submittedHash = hashSubmittedOtp(rawOtp.trim())
    if (!submittedHash) {
      return NextResponse.json(
        { error: 'Invalid verification code format.', code: 'OTP_INVALID' },
        { status: 400 }
      )
    }

    const otpCorrect = safeCompare(submittedHash, user.emailOtpHash)

    if (!otpCorrect) {
      const newAttempts  = (user.emailOtpAttempts ?? 0) + 1
      const attemptsLeft = maxAttempts - newAttempts

      if (attemptsLeft <= 0) {
        await clearOtpFields(user._id)
        session.twoFactorPending   = false
        session.pendingUserId      = undefined
        session.twoFactorPendingAt = undefined
        await session.save()
        logger.info('[2FA login-verify] Attempts exhausted — session cleared', { userId: user._id.toString() })
        return NextResponse.json(
          { error: 'Too many incorrect attempts. Please log in again to receive a new code.', code: 'OTP_MAX_ATTEMPTS' },
          { status: 400 }
        )
      }

      // Increment atomically
      await User.findByIdAndUpdate(user._id, { $inc: { emailOtpAttempts: 1 } })
      logger.info('[2FA] OTP verification failed', { userId: user._id.toString(), attemptsLeft })
      return NextResponse.json(
        { error: 'Incorrect verification code. Please try again.', code: 'OTP_INVALID', attemptsLeft },
        { status: 400 }
      )
    }

    // ── OTP correct — clear OTP atomically and promote session ────────────────
    await clearOtpFields(user._id)

    session.userId             = user._id.toString()
    session.name               = user.name
    session.email              = user.email
    session.isLoggedIn         = true
    session.emailVerified      = true
    session.twoFactorPending   = false
    session.pendingUserId      = undefined
    session.twoFactorPendingAt = undefined
    session.lastActiveAt       = Date.now() // inactivity timer starts at successful email OTP
    await session.save()

    logger.info('[2FA] Email OTP login verified', { userId: user._id.toString() })

    return NextResponse.json({
      message: 'Logged in successfully',
      user: { name: user.name, email: user.email },
    })
  } catch (error) {
    logger.error('[2FA login-verify] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
