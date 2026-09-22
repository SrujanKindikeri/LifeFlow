/**
 * POST /api/auth/2fa/email/resend
 *
 * Resend an Email OTP 2FA verification code for any active challenge.
 * Works for all three purposes: "2fa_enable", "2fa_disable", "2fa_login".
 *
 * For "2fa_enable" / "2fa_disable" — requires a fully-authenticated session.
 * For "2fa_login"                  — requires a twoFactorPending session
 *                                    (pendingUserId + twoFactorPending=true).
 *
 * SECURITY DESIGN
 * ───────────────
 * • A new OTP is generated with generateEmailOtp() — exactly one call.
 * • The new hash REPLACES the old hash atomically.  The old OTP is immediately
 *   invalidated.  There is never more than one valid OTP at a time.
 * • Attempt counter resets to 0 on every resend.
 * • 60-second server-side cooldown enforced via rate limiter (per user/IP).
 *   The cooldown bucket for login uses a separate key from enable/disable so
 *   a login resend doesn't drain the profile resend budget.
 * • purpose must be present and valid — prevents a malicious resend request
 *   from creating an OTP for a flow the user never initiated.
 * • Raw OTP NEVER logged.
 *
 * REQUEST BODY   { purpose: '2fa_enable' | '2fa_disable' | '2fa_login' }
 * RESPONSES
 *   200  { maskedEmail, otpExpiresAt }
 *   400  { error, code }
 *   401  { error }
 *   429  { error, code: 'OTP_COOLDOWN' }
 *   500  { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import User from '@/models/User'
import { generateEmailOtp, EMAIL_OTP_VALID_MINUTES, EMAIL_OTP_MAX_ATTEMPTS } from '@/lib/auth/otp'
import {
  checkEmailOtpRequestLimit,
  checkEmailOtpLoginSendLimit,
  getClientIp,
} from '@/lib/auth/rate-limit'
import { getNotificationService } from '@/lib/notifications'
import {
  buildTwoFaEnableOtpEmail,
  buildTwoFaLoginOtpEmail,
  buildTwoFaDisableOtpEmail,
  maskEmail,
} from '@/lib/auth/email-templates'
import logger from '@/lib/logger'

type OtpPurpose = '2fa_enable' | '2fa_disable' | '2fa_login'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { purpose?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const purpose = body.purpose as OtpPurpose | undefined
    if (!purpose || !['2fa_enable', '2fa_disable', '2fa_login'].includes(purpose)) {
      return NextResponse.json(
        { error: 'Invalid or missing purpose.', code: 'INVALID_PURPOSE' },
        { status: 400 }
      )
    }

    // ── Session resolution ────────────────────────────────────────────────────
    const session = await getSession()
    let userId: string

    if (purpose === '2fa_login') {
      // Login resend: must have a pending 2FA session (not a full session)
      if (!session.twoFactorPending || !session.pendingUserId) {
        return NextResponse.json(
          { error: 'No active login challenge. Please log in again.' },
          { status: 401 }
        )
      }
      userId = session.pendingUserId
    } else {
      // Enable / disable resend: must have a full authenticated session
      if (!session.isLoggedIn || !session.userId) {
        return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
      }
      userId = session.userId
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const rateResult =
      purpose === '2fa_login'
        ? checkEmailOtpLoginSendLimit(ip, userId)
        : checkEmailOtpRequestLimit(ip, userId)

    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Please wait before requesting another verification code.', code: 'OTP_COOLDOWN' },
        { status: 429 }
      )
    }

    await connectDB()

    const user = await User.findById(userId).select(
      'email name emailOtpEnabled emailOtpPurpose accountStatus'
    )
    if (!user || user.accountStatus !== 'active') {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    // ── Validate state matches purpose ────────────────────────────────────────
    if (purpose === '2fa_enable' && user.emailOtpEnabled) {
      return NextResponse.json(
        { error: 'Email 2FA is already enabled.', code: 'ALREADY_ENABLED' },
        { status: 409 }
      )
    }
    if (purpose === '2fa_disable' && !user.emailOtpEnabled) {
      return NextResponse.json(
        { error: 'Email 2FA is not currently enabled.', code: 'NOT_ENABLED' },
        { status: 409 }
      )
    }

    // ── Generate NEW OTP — exactly once ───────────────────────────────────────
    // Old OTP is replaced atomically.  Previous code is immediately invalidated.
    // Use findByIdAndUpdate with $set so all OTP fields are written regardless
    // of what was selected on the user document — same fix as enable-request /
    // disable-request (narrow .select() + save() silently drops unselected paths).
    const { otp, otpHash } = generateEmailOtp()
    const now          = new Date()
    const otpExpiresAt = new Date(now.getTime() + EMAIL_OTP_VALID_MINUTES * 60 * 1000)

    await User.findByIdAndUpdate(user._id, {
      $set: {
        emailOtpHash:        otpHash,
        emailOtpExpiresAt:   otpExpiresAt,
        emailOtpAttempts:    0,
        emailOtpMaxAttempts: EMAIL_OTP_MAX_ATTEMPTS,
        emailOtpSentAt:      now,
        emailOtpPurpose:     purpose,
      },
    })

    logger.info('[2FA DEBUG] challenge created', {
      userId:    user._id.toString(),
      purpose,
      expiresAt: otpExpiresAt.toISOString(),
    })

    // ── Send OTP email ────────────────────────────────────────────────────────
    const emailOpts = {
      toName:       user.name,
      toEmail:      user.email,
      otp,
      validMinutes: EMAIL_OTP_VALID_MINUTES,
    }

    const emailContent =
      purpose === '2fa_enable'  ? buildTwoFaEnableOtpEmail(emailOpts)  :
      purpose === '2fa_disable' ? buildTwoFaDisableOtpEmail(emailOpts) :
                                  buildTwoFaLoginOtpEmail(emailOpts)

    try {
      const notifier = await getNotificationService()
      const result   = await notifier.send({
        to:      user.email,
        subject: emailContent.subject,
        html:    emailContent.html,
        text:    emailContent.text,
      })

      if (!result.ok) {
        // Roll back via atomic update
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
          purpose,
          emailError: result.error,
        })
        return NextResponse.json(
          { error: 'Failed to send verification code. Please try again.' },
          { status: 500 }
        )
      }

      logger.info('[2FA DEBUG] email send completed', { userId: user._id.toString(), purpose })
    } catch (emailErr) {
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
    logger.error('[2FA resend] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
