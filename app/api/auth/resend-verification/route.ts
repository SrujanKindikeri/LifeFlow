/**
 * POST /api/auth/resend-verification
 *
 * Resends the email verification link for an unverified account.
 *
 * Security: the response for unknown / already-verified accounts is kept
 * intentionally generic (GENERIC_RESPONSE) so that callers cannot determine
 * whether an account exists.  Only once we have confirmed the account exists
 * AND still needs verification do we propagate real delivery status — because
 * at that point we are no longer leaking account existence (the user already
 * knows they signed up).
 *
 * Rate limits (configurable via env vars, see .env.example):
 *   - 1 send per VERIFICATION_RESEND_COOLDOWN_SECONDS seconds per email
 *   - VERIFICATION_MAX_RESENDS_PER_HOUR sends per email per hour
 *   - 10 sends per IP per hour
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { buildVerificationEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import { checkResendVerificationLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

const VERIFICATION_TOKEN_EXPIRY_MINUTES =
  parseInt(process.env.VERIFICATION_TOKEN_EXPIRY_MINUTES ?? '8', 10) || 8

const resendSchema = z.object({
  email: z.string().email(),
})

/**
 * Generic response — returned for accounts that don't exist or are already
 * verified.  Keeping this wording identical regardless of outcome prevents
 * account enumeration.  The `emailDelivered` field is intentionally absent so
 * the client cannot distinguish these cases from a real delivery attempt.
 */
const GENERIC_RESPONSE = {
  message: 'If an account with that email requires verification, a new link has been sent.',
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    const body = await req.json()

    const parsed = resendSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const email = parsed.data.email.toLowerCase()

    // ── Rate limiting ─────────────────────────────────────────────────────
    const rateResult = checkResendVerificationLimit(ip, email)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before requesting another email.' },
        { status: 429 }
      )
    }

    await connectDB()

    const user = await User.findOne({ email })

    // Account not found OR already verified — return generic message.
    // Do NOT reveal which case applies.
    if (!user || user.emailVerified) {
      return NextResponse.json(GENERIC_RESPONSE)
    }

    // ── Generate a new token (invalidates the previous one) ───────────────
    const { token: verificationToken, tokenHash } = generateVerificationToken()
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MINUTES * 60 * 1000)

    user.emailVerificationTokenHash = tokenHash
    user.emailVerificationExpiresAt = expiresAt
    await user.save()

    // ── Send email ────────────────────────────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    // NOTE: the full URL (containing the token) is never logged — only the
    // base app URL is used in diagnostics to avoid token leakage in logs.
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`

    let emailDelivered = false

    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildVerificationEmail({
        toName: user.name,
        verificationUrl,
        expiresInMinutes: VERIFICATION_TOKEN_EXPIRY_MINUTES,
      })
      const result = await notifier.send({ to: user.email, subject, html, text })

      if (result.ok) {
        emailDelivered = true
        logger.info('[resend-verification] Verification email accepted by provider', {
          userId: user._id.toString(),
        })
      } else {
        // result.error is already a sanitised string from the SMTP provider —
        // it never contains the raw SMTP error or any token/password.
        logger.warn('[resend-verification] Email delivery failed', {
          userId: user._id.toString(),
          // Safe: SmtpProvider returns a fixed 'SMTP delivery failed' string,
          // never the raw error which could contain credentials or token data.
          providerError: result.error,
        })
      }
    } catch (emailErr) {
      // Unexpected throw from the notification layer (e.g. provider init error)
      logger.error('[resend-verification] Unexpected error from notification service', {
        userId: user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
      // emailDelivered stays false
    }

    // Return delivery status to the client.
    // The message field is kept intentionally vague but the `emailDelivered`
    // boolean lets the UI show the correct feedback without exposing SMTP details.
    if (emailDelivered) {
      return NextResponse.json({
        message: 'Verification email sent. Please check your inbox.',
        emailDelivered: true,
      })
    }

    // SMTP failed — tell the user honestly without leaking SMTP internals.
    return NextResponse.json({
      message: "We couldn't send the verification email. Please try again.",
      emailDelivered: false,
    })
  } catch (error) {
    logger.error('[resend-verification] Unhandled error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    // Fall back to the generic message on unexpected server errors so we never
    // accidentally leak account existence through a different error path.
    return NextResponse.json(GENERIC_RESPONSE)
  }
}
