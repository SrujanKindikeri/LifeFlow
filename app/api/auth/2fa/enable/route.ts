/**
 * POST /api/auth/2fa/enable
 *
 * Verifies the first TOTP code from the user's authenticator app and,
 * on success, enables 2FA and returns the one-time recovery codes.
 *
 * Must be called AFTER /api/auth/2fa/setup has stored the pending secret.
 *
 * Request body:
 *   { code: "123456" }
 *
 * Response (on success):
 *   { message, recoveryCodes: string[] }
 *
 * Recovery codes are returned ONCE and must be displayed to the user.
 * They are never returned again — only their hashes are stored.
 *
 * Protected: requires a fully authenticated session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { decryptTotpSecret, generateRecoveryCodes } from '@/lib/auth/crypto'
import { buildTwoFaEnabledEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import { checkTotpAttemptLimit } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

const enableSchema = z.object({
  code: z.string().length(6, 'Authenticator code must be 6 digits').regex(/^\d+$/, 'Code must be numeric'),
})

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()

    const body = await req.json()
    const parsed = enableSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // ── Rate limit TOTP attempts ────────────────────────────────────────────
    const rateResult = checkTotpAttemptLimit(userId)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait before trying again.' },
        { status: 429 }
      )
    }

    await connectDB()

    const user = await User.findById(userId)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: 'Two-factor authentication is already enabled.' },
        { status: 400 }
      )
    }

    if (!user.twoFactorSecretEncrypted) {
      return NextResponse.json(
        { error: 'No pending 2FA setup found. Please start setup again.' },
        { status: 400 }
      )
    }

    // ── Verify the TOTP code ───────────────────────────────────────────────
    let isValid = false
    try {
      const { authenticator } = await import('@otplib/preset-default')
      const secret = decryptTotpSecret(user.twoFactorSecretEncrypted)
      isValid = authenticator.check(parsed.data.code, secret)
    } catch (err) {
      logger.error('[2fa/enable] TOTP verify error', {
        userId,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: 'Verification failed. Please restart 2FA setup.' },
        { status: 500 }
      )
    }

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid authenticator code. Please try again.' },
        { status: 401 }
      )
    }

    // ── Generate recovery codes (raw + hashes) ─────────────────────────────
    const { codes: recoveryCodes, codeHashes } = generateRecoveryCodes()

    // ── Persist: enable 2FA and store code hashes ─────────────────────────
    user.twoFactorEnabled            = true
    user.twoFactorVerifiedAt         = new Date()
    user.twoFactorRecoveryCodeHashes = codeHashes
    // twoFactorSecretEncrypted already stored from /setup
    await user.save()

    logger.info('[2fa/enable] 2FA enabled', { userId })

    // ── Send confirmation email ────────────────────────────────────────────
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildTwoFaEnabledEmail({
        toName: user.name,
        toEmail: user.email,
      })
      await notifier.send({ to: user.email, subject, html, text })
    } catch (emailErr) {
      logger.warn('[2fa/enable] Confirmation email failed', {
        userId,
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    // ── Return recovery codes (ONCE — never stored in plaintext) ─────────
    return NextResponse.json({
      message: 'Two-factor authentication has been enabled.',
      recoveryCodes,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[2fa/enable]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
