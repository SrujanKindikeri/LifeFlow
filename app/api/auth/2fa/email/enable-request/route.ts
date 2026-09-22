/**
 * POST /api/auth/2fa/email/enable-request
 *
 * Step 1 of the Email OTP 2FA enable flow (requires a fully-authenticated session):
 *   PASSWORD VERIFIED → OTP GENERATED → DB WRITTEN → RE-READ CONFIRMED → OTP EMAILED
 *   → client moves to OTP step
 *
 * SECURITY DESIGN
 * ───────────────
 * • Requires a fully-authenticated session (isLoggedIn=true).
 *   A twoFactorPending session cannot reach this endpoint.
 * • The submitted password is verified with bcrypt before any OTP is generated.
 *   Wrong password → 401, no OTP sent.
 * • If 2FA is already enabled → 409, no OTP sent.
 * • One OTP is generated with generateEmailOtp() — the SAME { otp, otpHash }
 *   pair is used for DB storage and email.  Never call generateEmailOtp() twice.
 * • Only the SHA-256 hash is stored on the User document.
 * • OTP expiry: 10 minutes.
 * • Rate-limited: 60-second resend cooldown + 10/hr/user + 20/hr/IP.
 *   Checked AFTER password verification so failed passwords don't drain the cooldown.
 * • purpose field on User: "2fa_enable" — prevents cross-purpose OTP reuse.
 * • The raw OTP is NEVER logged.
 *
 * WRITE STRATEGY & DB CONFIRMATION
 * ─────────────────────────────────
 * The OTP hash is written via findByIdAndUpdate with a plain $set (no returnDocument
 * tricks).  After the write completes, a separate findById re-read confirms the
 * fields were actually persisted.  This two-step approach is more reliable than
 * relying on the returned document from findByIdAndUpdate, which can be affected
 * by Mongoose projection behaviour and returnDocument semantics.
 *
 * The email is only sent AFTER the re-read confirms the write.  If the re-read
 * does not find the expected hash, the email is NOT sent and the client receives
 * a 500 — this prevents the worst-case where an OTP arrives in the user's inbox
 * but the corresponding challenge is absent from MongoDB.
 *
 * NOTE: Save-vs-findByIdAndUpdate:
 * The user document was fetched with a narrow .select() that excludes OTP fields.
 * Mongoose dirty-tracking only covers selected paths — calling .save() on the
 * partially-selected document would silently drop the OTP fields from the $set.
 * findByIdAndUpdate bypasses dirty-tracking and always writes every field in $set.
 *
 * REQUEST BODY   { password: string }
 * RESPONSES
 *   200  { maskedEmail, otpExpiresAt }
 *   400  { error }
 *   401  { error, code: 'WRONG_PASSWORD' }
 *   409  { error, code: 'ALREADY_ENABLED' }
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
import { buildTwoFaEnableOtpEmail, maskEmail } from '@/lib/auth/email-templates'
import logger from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Auth check (full session required) ───────────────────────────────────
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

    // ── Fetch user — include passwordHash for verification ────────────────────
    // NOTE: OTP fields are NOT selected here to avoid dirty-tracking ambiguity.
    // The OTP write uses findByIdAndUpdate which bypasses dirty-tracking entirely.
    const user = await User.findById(authUser.userId).select(
      'email name passwordHash emailOtpEnabled accountStatus'
    )
    if (!user || user.accountStatus !== 'active') {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    // ── Already enabled? ──────────────────────────────────────────────────────
    if (user.emailOtpEnabled) {
      return NextResponse.json(
        { error: 'Email 2FA is already enabled on this account.', code: 'ALREADY_ENABLED' },
        { status: 409 }
      )
    }

    // ── Password verification (never log password) ────────────────────────────
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      logger.info('[2FA enable-request] Password verification failed', { userId: user._id.toString() })
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
    // generateEmailOtp() returns { otp, otpHash } — call it ONCE.
    // otp     → sent in email only, never stored, never logged
    // otpHash → stored in MongoDB only, never sent to client
    const { otp, otpHash } = generateEmailOtp()
    const now          = new Date()
    const otpExpiresAt = new Date(now.getTime() + EMAIL_OTP_VALID_MINUTES * 60 * 1000)

    logger.info('[2FA DEBUG] send started', {
      userId:  user._id.toString(),
      purpose: '2fa_enable',
    })

    // ── Write OTP hash to DB ──────────────────────────────────────────────────
    //
    // Use findByIdAndUpdate + $set so ALL OTP fields are written regardless of
    // what was selected on the user document above.  Mongoose dirty-tracking
    // only covers selected paths; save() on a narrow-select doc would silently
    // drop emailOtpHash, emailOtpPurpose, etc.
    //
    // We do NOT use returnDocument / new:true here — we confirm the write via a
    // separate explicit findById re-read below.  This avoids any ambiguity around
    // Mongoose's returnDocument behaviour and projection handling.
    await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          emailOtpHash:        otpHash,
          emailOtpExpiresAt:   otpExpiresAt,
          emailOtpAttempts:    0,
          emailOtpMaxAttempts: EMAIL_OTP_MAX_ATTEMPTS,
          emailOtpSentAt:      now,
          emailOtpPurpose:     '2fa_enable',
        },
      },
    )

    // ── Confirm the write by re-reading the document ──────────────────────────
    //
    // A separate findById is the most reliable confirmation — it makes a fresh
    // round-trip to MongoDB and returns exactly what is in the database at that
    // moment.  This eliminates all ambiguity about returnDocument semantics,
    // Mongoose projections, or in-memory document state.
    //
    // We verify:
    //   1. The document still exists
    //   2. emailOtpHash matches the hash we just wrote (SHA-256 is deterministic)
    //   3. emailOtpPurpose was written correctly
    //   4. emailOtpAttempts was reset to 0
    //   5. emailOtpExpiresAt is in the future
    //
    // NOTE: OTP uses SHA-256, not bcrypt — direct string equality IS correct here.
    // Do NOT compare bcrypt hashes with ===; do NOT call bcrypt.compare() here.
    const savedUser = await User.findById(user._id)
      .select('emailOtpHash emailOtpPurpose emailOtpAttempts emailOtpExpiresAt')
      .lean<{
        emailOtpHash:      string | null
        emailOtpPurpose:   string | null
        emailOtpAttempts:  number
        emailOtpExpiresAt: Date | null
      }>()

    if (
      !savedUser ||
      savedUser.emailOtpHash      !== otpHash ||
      savedUser.emailOtpPurpose   !== '2fa_enable' ||
      savedUser.emailOtpAttempts  !== 0 ||
      !savedUser.emailOtpExpiresAt ||
      savedUser.emailOtpExpiresAt <= now
    ) {
      logger.error('[2FA enable-request] DB write confirmation failed — challenge not persisted', {
        userId:           user._id.toString(),
        savedDocExists:   !!savedUser,
        hashMatch:        savedUser?.emailOtpHash === otpHash,
        purposeMatch:     savedUser?.emailOtpPurpose === '2fa_enable',
        attemptsMatch:    savedUser?.emailOtpAttempts === 0,
        expiresAtPresent: !!savedUser?.emailOtpExpiresAt,
        // Log hash length only — never the hash itself
        savedHashLength:  savedUser?.emailOtpHash?.length ?? 0,
        expectedHashLen:  otpHash.length,
      })
      return NextResponse.json(
        { error: 'Failed to create verification challenge. Please try again.' },
        { status: 500 }
      )
    }

    logger.info('[2FA DEBUG] challenge created and confirmed', {
      userId:    user._id.toString(),
      purpose:   '2fa_enable',
      expiresAt: otpExpiresAt.toISOString(),
    })

    // ── Send OTP email — only after DB write is confirmed ─────────────────────
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildTwoFaEnableOtpEmail({
        toName:       user.name,
        toEmail:      user.email,
        otp,                           // raw OTP — only enters email body, never logged
        validMinutes: EMAIL_OTP_VALID_MINUTES,
      })
      const result = await notifier.send({ to: user.email, subject, html, text })

      if (!result.ok) {
        // Roll back the OTP fields so the user can retry cleanly
        await User.findByIdAndUpdate(user._id, {
          $set: {
            emailOtpHash:      null,
            emailOtpExpiresAt: null,
            emailOtpSentAt:    null,
            emailOtpPurpose:   null,
          },
        })
        logger.error('[2FA] OTP email delivery failed', {
          userId:     user._id.toString(),
          purpose:    '2fa_enable',
          emailError: result.error,
        })
        return NextResponse.json(
          { error: 'Failed to send verification code. Please try again.' },
          { status: 500 }
        )
      }

      logger.info('[2FA DEBUG] email sent', {
        userId:  user._id.toString(),
        purpose: '2fa_enable',
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

    // ── Respond — never expose raw OTP or full email ──────────────────────────
    return NextResponse.json({
      maskedEmail:  maskEmail(user.email),
      otpExpiresAt: otpExpiresAt.toISOString(),
    })
  } catch (error) {
    logger.error('[2FA enable-request] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
      stack:        error instanceof Error ? error.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
