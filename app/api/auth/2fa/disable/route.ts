/**
 * POST /api/auth/2fa/disable
 *
 * Disables TOTP 2FA for the authenticated user.
 * Requires the user's current password AND a valid TOTP code (or recovery code).
 *
 * Request body:
 *   { password: "...", code: "123456" }
 *   { password: "...", code: "a3f9b2c1...", isRecovery: true }
 *
 * Protected: requires a fully authenticated session.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { decryptTotpSecret, hashRecoveryCode } from '@/lib/auth/crypto'
import { buildTwoFaDisabledEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import { checkTotpAttemptLimit } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

const disableSchema = z.object({
  password:   z.string().min(1, 'Password is required'),
  code:       z.string().min(1, 'Authenticator code is required'),
  isRecovery: z.boolean().optional().default(false),
})

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()

    const body = await req.json()
    const parsed = disableSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // ── Rate limit ─────────────────────────────────────────────────────────
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

    if (!user.twoFactorEnabled) {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled.' },
        { status: 400 }
      )
    }

    // ── Verify password ────────────────────────────────────────────────────
    const passwordValid = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Incorrect password.' },
        { status: 401 }
      )
    }

    // ── Verify TOTP code or recovery code ──────────────────────────────────
    let codeValid = false

    if (parsed.data.isRecovery) {
      const codeHash = hashRecoveryCode(parsed.data.code)
      if (!codeHash) {
        return NextResponse.json({ error: 'Invalid recovery code format.' }, { status: 400 })
      }
      const idx = user.twoFactorRecoveryCodeHashes.indexOf(codeHash)
      if (idx !== -1) {
        user.twoFactorRecoveryCodeHashes.splice(idx, 1)
        codeValid = true
      }
    } else {
      if (!user.twoFactorSecretEncrypted) {
        return NextResponse.json(
          { error: 'Two-factor authentication is not properly configured.' },
          { status: 500 }
        )
      }
      try {
        const { authenticator } = await import('@otplib/preset-default')
        const secret = decryptTotpSecret(user.twoFactorSecretEncrypted)
        codeValid = authenticator.check(parsed.data.code, secret)
      } catch (err) {
        logger.error('[2fa/disable] TOTP verify error', {
          userId,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        return NextResponse.json(
          { error: 'Verification failed. Please try again.' },
          { status: 500 }
        )
      }
    }

    if (!codeValid) {
      return NextResponse.json(
        { error: 'Invalid authenticator code.' },
        { status: 401 }
      )
    }

    // ── Disable 2FA — wipe all TOTP data ──────────────────────────────────
    user.twoFactorEnabled            = false
    user.twoFactorSecretEncrypted    = null
    user.twoFactorVerifiedAt         = null
    user.twoFactorRecoveryCodeHashes = []
    await user.save()

    logger.info('[2fa/disable] 2FA disabled', { userId })

    // ── Send notification email ────────────────────────────────────────────
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildTwoFaDisabledEmail({
        toName: user.name,
        toEmail: user.email,
      })
      await notifier.send({ to: user.email, subject, html, text })
    } catch (emailErr) {
      logger.warn('[2fa/disable] Notification email failed', {
        userId,
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    return NextResponse.json({
      message: 'Two-factor authentication has been disabled.',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[2fa/disable]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
