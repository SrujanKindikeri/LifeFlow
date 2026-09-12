/**
 * /api/auth/2fa/recovery
 *
 * GET  — returns how many recovery codes remain (count only, not the codes).
 * POST — regenerates recovery codes (requires password + TOTP).
 *
 * Protected: requires a fully authenticated session.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { decryptTotpSecret, generateRecoveryCodes } from '@/lib/auth/crypto'
import { checkTotpAttemptLimit } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

// ── GET /api/auth/2fa/recovery ─────────────────────────────────────────────

export async function GET() {
  try {
    const { userId } = await requireAuth()

    await connectDB()

    const user = await User.findById(userId).select('twoFactorEnabled twoFactorRecoveryCodeHashes')
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (!user.twoFactorEnabled) {
      return NextResponse.json({ error: '2FA is not enabled.' }, { status: 400 })
    }

    return NextResponse.json({
      codesRemaining: user.twoFactorRecoveryCodeHashes.length,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[2fa/recovery GET]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST /api/auth/2fa/recovery — regenerate codes ────────────────────────

const regenerateSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code:     z.string().length(6, 'Authenticator code must be 6 digits').regex(/^\d+$/),
})

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()

    const body = await req.json()
    const parsed = regenerateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // ── Rate limit ──────────────────────────────────────────────────────────
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

    if (!user.twoFactorEnabled || !user.twoFactorSecretEncrypted) {
      return NextResponse.json({ error: '2FA is not enabled.' }, { status: 400 })
    }

    // ── Verify password ─────────────────────────────────────────────────────
    const passwordValid = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
    }

    // ── Verify TOTP code ────────────────────────────────────────────────────
    let isValid = false
    try {
      const { authenticator } = await import('@otplib/preset-default')
      const secret = decryptTotpSecret(user.twoFactorSecretEncrypted)
      isValid = authenticator.check(parsed.data.code, secret)
    } catch (err) {
      logger.error('[2fa/recovery POST] TOTP verify error', {
        userId,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: 'Verification failed. Please try again.' },
        { status: 500 }
      )
    }

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid authenticator code.' },
        { status: 401 }
      )
    }

    // ── Generate fresh codes ────────────────────────────────────────────────
    const { codes: recoveryCodes, codeHashes } = generateRecoveryCodes()

    user.twoFactorRecoveryCodeHashes = codeHashes
    await user.save()

    logger.info('[2fa/recovery POST] Recovery codes regenerated', { userId })

    // Return the raw codes ONCE
    return NextResponse.json({
      message: 'Recovery codes have been regenerated. Save them somewhere safe.',
      recoveryCodes,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[2fa/recovery POST]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
