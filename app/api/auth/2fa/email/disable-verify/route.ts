/**
 * POST /api/auth/2fa/email/disable-verify
 *
 * Step 2 of the Email OTP 2FA disable flow (requires a fully-authenticated session):
 *   OTP VERIFIED → emailOtpEnabled=false, twoFactorEnabledAt cleared
 *
 * SECURITY DESIGN
 * ───────────────
 * • Requires a fully-authenticated session (isLoggedIn=true).
 * • Validates purpose="2fa_disable" to prevent cross-purpose OTP reuse.
 * • Attempt counter is server-side.  5 wrong attempts invalidates the OTP.
 * • Correct OTP on attempt 5 succeeds (attempt limit means > 5 fails, not ≥ 5).
 * • Expired OTP always fails.
 * • On success: emailOtpEnabled=false, twoFactorEnabledAt=null, OTP cleared.
 * • Does NOT invalidate the current authenticated session.
 * • Raw OTP NEVER logged.
 *
 * WRITE STRATEGY
 * ──────────────
 * All writes use findByIdAndUpdate + $set instead of document.save().
 *
 * The user is fetched with a narrow .select() that only loads OTP fields.
 * Mongoose dirty-tracking covers only the selected paths — if we assigned
 * new values (e.g. emailOtpSentAt) to the in-memory document and called
 * save(), those assignments would be silently dropped because the fields
 * were absent from the initial projection.  The atomic findByIdAndUpdate
 * path bypasses dirty-tracking entirely and always writes every field listed
 * in the $set, regardless of what was projected.
 *
 * This is the same fix already applied to enable-request, disable-request,
 * and enable-verify.
 *
 * REQUEST BODY   { otp: string }
 * RESPONSES
 *   200  { message }
 *   400  { error, code }
 *   401  { error }
 *   409  { error, code: 'NOT_ENABLED' }
 *   429  { error }
 *   500  { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import User from '@/models/User'
import { hashSubmittedOtp } from '@/lib/auth/otp'
import { safeCompare } from '@/lib/auth/crypto'
import { checkEmailOtpVerifyLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Auth check ────────────────────────────────────────────────────────────
    let authUser
    try {
      authUser = await requireAuth()
    } catch {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }

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
    const rateResult = checkEmailOtpVerifyLimit(ip, authUser.userId)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    await connectDB()

    // ── Read user — OTP fields only ───────────────────────────────────────────
    // NOTE: All writes below use findByIdAndUpdate + $set, NOT user.save().
    // See the "WRITE STRATEGY" note in the file header for why.
    const user = await User.findById(authUser.userId).select(
      'emailOtpEnabled emailOtpHash emailOtpExpiresAt emailOtpAttempts ' +
      'emailOtpMaxAttempts emailOtpPurpose accountStatus'
    )
    if (!user || user.accountStatus !== 'active') {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    if (!user.emailOtpEnabled) {
      return NextResponse.json(
        { error: 'Email 2FA is not currently enabled.', code: 'NOT_ENABLED' },
        { status: 409 }
      )
    }

    // ── Debug: log challenge state ────────────────────────────────────────────
    logger.info('[2FA DEBUG] disable-verify started', {
      userId:     user._id.toString(),
      purpose:    user.emailOtpPurpose,
      hasOtpHash: !!user.emailOtpHash,
      attempts:   user.emailOtpAttempts,
      expiresAt:  user.emailOtpExpiresAt?.toISOString() ?? null,
      expired:    user.emailOtpExpiresAt ? new Date() >= user.emailOtpExpiresAt : true,
    })

    // ── Purpose check ─────────────────────────────────────────────────────────
    if (user.emailOtpPurpose !== '2fa_disable') {
      logger.info('[2FA disable-verify] Purpose mismatch — challenge not found', {
        userId:          user._id.toString(),
        foundPurpose:    user.emailOtpPurpose,
        expectedPurpose: '2fa_disable',
      })
      return NextResponse.json(
        { error: 'No active verification challenge. Please request a new code.', code: 'OTP_NOT_FOUND' },
        { status: 400 }
      )
    }

    // ── OTP presence check ────────────────────────────────────────────────────
    if (!user.emailOtpHash) {
      logger.info('[2FA disable-verify] No OTP hash in DB', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'Your verification code has expired or was already used. Please request a new one.', code: 'OTP_NOT_FOUND' },
        { status: 400 }
      )
    }

    const now = new Date()

    // ── OTP expiry ────────────────────────────────────────────────────────────
    if (!user.emailOtpExpiresAt || now >= user.emailOtpExpiresAt) {
      await User.findByIdAndUpdate(user._id, {
        $set: {
          emailOtpHash:      null,
          emailOtpExpiresAt: null,
          emailOtpAttempts:  0,
          emailOtpSentAt:    null,
          emailOtpPurpose:   null,
        },
      })
      logger.info('[2FA disable-verify] OTP expired', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'This verification code has expired. Please request a new code.', code: 'OTP_EXPIRED' },
        { status: 400 }
      )
    }

    // ── Attempt limit ─────────────────────────────────────────────────────────
    const maxAttempts = user.emailOtpMaxAttempts ?? 5
    if (user.emailOtpAttempts >= maxAttempts) {
      await User.findByIdAndUpdate(user._id, {
        $set: {
          emailOtpHash:      null,
          emailOtpExpiresAt: null,
          emailOtpAttempts:  0,
          emailOtpSentAt:    null,
          emailOtpPurpose:   null,
        },
      })
      logger.info('[2FA disable-verify] Max attempts exceeded', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Please request a new verification code.', code: 'OTP_MAX_ATTEMPTS' },
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
      // ── Wrong OTP: increment attempt counter atomically ───────────────────
      const newAttempts  = (user.emailOtpAttempts ?? 0) + 1
      const attemptsLeft = maxAttempts - newAttempts

      if (attemptsLeft <= 0) {
        await User.findByIdAndUpdate(user._id, {
          $set: {
            emailOtpHash:      null,
            emailOtpExpiresAt: null,
            emailOtpAttempts:  0,
            emailOtpSentAt:    null,
            emailOtpPurpose:   null,
          },
        })
        logger.info('[2FA disable-verify] Attempts exhausted', { userId: user._id.toString() })
        return NextResponse.json(
          { error: 'Too many incorrect attempts. Please request a new verification code.', code: 'OTP_MAX_ATTEMPTS' },
          { status: 400 }
        )
      }

      await User.findByIdAndUpdate(user._id, {
        $inc: { emailOtpAttempts: 1 },
      })
      logger.info('[2FA disable-verify] Wrong OTP', { userId: user._id.toString(), attemptsLeft })
      return NextResponse.json(
        { error: 'Incorrect verification code. Please try again.', code: 'OTP_INVALID', attemptsLeft },
        { status: 400 }
      )
    }

    // ── OTP correct — disable Email 2FA atomically ────────────────────────────
    await User.findByIdAndUpdate(user._id, {
      $set: {
        emailOtpEnabled:    false,
        twoFactorEnabledAt: null,
        // Consume OTP — single use
        emailOtpHash:       null,
        emailOtpExpiresAt:  null,
        emailOtpAttempts:   0,
        emailOtpSentAt:     null,
        emailOtpPurpose:    null,
      },
    })

    logger.info('[2FA DEBUG] disable-verify result — success', { userId: user._id.toString() })
    logger.info('[2FA] Email OTP 2FA disabled', { userId: user._id.toString() })

    return NextResponse.json({ message: 'Two-factor authentication has been disabled.' })
  } catch (error) {
    logger.error('[2FA disable-verify] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
