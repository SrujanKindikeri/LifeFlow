/**
 * POST /api/auth/2fa/email/disable-request
 *
 * Step 1 of the Email OTP 2FA disable flow (requires a fully-authenticated session):
 *   PASSWORD VERIFIED → OTP GENERATED → OTP EMAILED → client moves to OTP step
 *
 * SECURITY DESIGN
 * ───────────────
 * • Requires a fully-authenticated session (isLoggedIn=true).
 * • Password must be verified before any OTP is generated.
 * • If 2FA is not enabled → 409, no OTP sent.
 * • One OTP generated with generateEmailOtp().  Same { otp, otpHash } used
 *   for DB and email — never call generateEmailOtp() twice.
 * • Only the SHA-256 hash stored; raw OTP enters email body only.
 * • purpose: "2fa_disable" — prevents cross-purpose OTP reuse.
 * • Rate-limited: 60-second cooldown + 10/hr/user + 20/hr/IP.
 *   Checked AFTER successful password verification.
 * • Raw OTP NEVER logged.
 *
 * REQUEST BODY   { password: string }
 * RESPONSES
 *   200  { maskedEmail, otpExpiresAt }
 *   400  { error }
 *   401  { error, code: 'WRONG_PASSWORD' }
 *   409  { error, code: 'NOT_ENABLED' }
 *   429  { error }
 *   500  { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import User from '@/models/User'
import { generateEmailOtp, EMAIL_OTP_VALID_MINUTES, EMAIL_OTP_MAX_ATTEMPTS } from '@/lib/auth/otp'
import { checkEmailOtpRequestLimit, getClientIp } from '@/lib/auth/rate-limit'
import { getNotificationService } from '@/lib/notifications'
import { buildTwoFaDisableOtpEmail, maskEmail } from '@/lib/auth/email-templates'
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
    let body: { password?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { password } = body
    if (!password || typeof password !== 'string' || password.length < 1) {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 })
    }

    await connectDB()

    const user = await User.findById(authUser.userId).select(
      'email name passwordHash emailOtpEnabled emailOtpSentAt accountStatus'
    )
    if (!user || user.accountStatus !== 'active') {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    // ── Not enabled? ──────────────────────────────────────────────────────────
    if (!user.emailOtpEnabled) {
      return NextResponse.json(
        { error: 'Email 2FA is not currently enabled on this account.', code: 'NOT_ENABLED' },
        { status: 409 }
      )
    }

    // ── Password verification ─────────────────────────────────────────────────
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      logger.info('[2FA disable-request] Password verification failed', { userId: user._id.toString() })
      return NextResponse.json(
        { error: 'Incorrect password. Please try again.', code: 'WRONG_PASSWORD' },
        { status: 401 }
      )
    }

    // ── OTP generation rate limit (checked AFTER password success) ────────────
    const rateResult = checkEmailOtpRequestLimit(ip, user._id.toString())
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Please wait before requesting another verification code.', code: 'OTP_COOLDOWN' },
        { status: 429 }
      )
    }

    // ── Generate OTP — exactly once ───────────────────────────────────────────
    const { otp, otpHash } = generateEmailOtp()
    const now          = new Date()
    const otpExpiresAt = new Date(now.getTime() + EMAIL_OTP_VALID_MINUTES * 60 * 1000)

    // ── Persist OTP hash via atomic $set ──────────────────────────────────────
    // IMPORTANT: We use findByIdAndUpdate with $set rather than assigning to
    // the partially-selected document and calling save(). When the user
    // document was fetched with a narrow .select() that excludes the OTP
    // fields, Mongoose's dirty-tracking only covers the selected paths —
    // save() would silently drop the unselected fields from the $set, meaning
    // emailOtpHash, emailOtpPurpose, etc. would never reach MongoDB. The
    // findByIdAndUpdate path is unconditional and always writes every field.
    await User.findByIdAndUpdate(user._id, {
      $set: {
        emailOtpHash:        otpHash,
        emailOtpExpiresAt:   otpExpiresAt,
        emailOtpAttempts:    0,
        emailOtpMaxAttempts: EMAIL_OTP_MAX_ATTEMPTS,
        emailOtpSentAt:      now,
        emailOtpPurpose:     '2fa_disable',
      },
    })

    logger.info('[2FA DEBUG] challenge created', {
      userId:    user._id.toString(),
      purpose:   '2fa_disable',
      expiresAt: otpExpiresAt.toISOString(),
    })

    // ── Send OTP email ────────────────────────────────────────────────────────
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildTwoFaDisableOtpEmail({
        toName:       user.name,
        toEmail:      user.email,
        otp,
        validMinutes: EMAIL_OTP_VALID_MINUTES,
      })
      const result = await notifier.send({ to: user.email, subject, html, text })

      if (!result.ok) {
        // Roll back via atomic update so the user can retry
        await User.findByIdAndUpdate(user._id, {
          $set: {
            emailOtpHash:      null,
            emailOtpExpiresAt: null,
            emailOtpSentAt:    null,
            emailOtpPurpose:   null,
          },
        })
        logger.error('[2FA] OTP email delivery failed', {
          userId: user._id.toString(),
          purpose: '2fa_disable',
          emailError: result.error,
        })
        return NextResponse.json(
          { error: 'Failed to send verification code. Please try again.' },
          { status: 500 }
        )
      }

      logger.info('[2FA DEBUG] email send completed', {
        userId:  user._id.toString(),
        purpose: '2fa_disable',
      })
    } catch (emailErr) {
      // Best-effort rollback
      try {
        await User.findByIdAndUpdate(user._id, {
          $set: {
            emailOtpHash:      null,
            emailOtpExpiresAt: null,
            emailOtpSentAt:    null,
            emailOtpPurpose:   null,
          },
        })
      } catch { /* non-fatal */ }

      logger.error('[2FA] OTP email error', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
      return NextResponse.json(
        { error: 'Failed to send verification code. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      maskedEmail:  maskEmail(user.email),
      otpExpiresAt: otpExpiresAt.toISOString(),
    })
  } catch (error) {
    logger.error('[2FA disable-request] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
