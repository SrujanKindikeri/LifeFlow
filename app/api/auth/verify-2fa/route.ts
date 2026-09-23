/**
 * POST /api/auth/verify-2fa
 *
 * Second step of the login flow when twoFactorEnabled=true.
 * Validates the TOTP code (or a recovery code) and, on success,
 * promotes the pending session to a full authenticated session.
 *
 * Request body:
 *   { code: "123456" }                 — Google Authenticator TOTP
 *   { code: "a3f9b2c1d4e5f6a7b8c9", isRecovery: true } — recovery code
 *
 * The pending session (twoFactorPending=true, pendingUserId) must be
 * present in the cookie — issued by /api/auth/login.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import User from '@/models/User'
import { decryptTotpSecret, hashRecoveryCode } from '@/lib/auth/crypto'
import { checkTotpAttemptLimit, checkRecoveryCodeLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

// The pending session must be completed within this window (matches login route)
const TWO_FA_PENDING_TTL_MS = 5 * 60 * 1000

const verify2faSchema = z.object({
  code:       z.string().min(1, 'Code is required'),
  isRecovery: z.boolean().optional().default(false),
})

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Validate the pending session ────────────────────────────────────────
    const session = await getSession()

    if (
      !session.twoFactorPending ||
      !session.pendingUserId ||
      !session.twoFactorPendingAt
    ) {
      return NextResponse.json(
        { error: 'No pending 2FA session. Please log in again.' },
        { status: 401 }
      )
    }

    // ── Check pending session expiry ────────────────────────────────────────
    if (Date.now() - session.twoFactorPendingAt > TWO_FA_PENDING_TTL_MS) {
      // Clear the expired pending session
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

    // ── Parse request body ──────────────────────────────────────────────────
    const body = await req.json()
    const parsed = verify2faSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { code, isRecovery } = parsed.data

    // ── Rate limiting ───────────────────────────────────────────────────────
    const rateResult = isRecovery
      ? checkRecoveryCodeLimit(pendingUserId)
      : checkTotpAttemptLimit(pendingUserId)

    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait before trying again.' },
        { status: 429 }
      )
    }

    await connectDB()

    const user = await User.findById(pendingUserId)
    if (!user || !user.twoFactorEnabled) {
      // Clear invalid pending session
      session.twoFactorPending   = false
      session.pendingUserId      = undefined
      session.twoFactorPendingAt = undefined
      await session.save()
      return NextResponse.json(
        { error: 'Invalid session. Please log in again.' },
        { status: 401 }
      )
    }

    let verified = false

    if (isRecovery) {
      // ── Recovery code path ────────────────────────────────────────────────
      const codeHash = hashRecoveryCode(code)
      if (!codeHash) {
        return NextResponse.json({ error: 'Invalid recovery code format.' }, { status: 400 })
      }

      const idx = user.twoFactorRecoveryCodeHashes.indexOf(codeHash)
      if (idx === -1) {
        return NextResponse.json(
          { error: 'Invalid recovery code.' },
          { status: 401 }
        )
      }

      // Invalidate the used code (single-use)
      user.twoFactorRecoveryCodeHashes.splice(idx, 1)
      await user.save()
      verified = true

      logger.info('[verify-2fa] Recovery code used', {
        userId: user._id.toString(),
        codesRemaining: user.twoFactorRecoveryCodeHashes.length,
      })
    } else {
      // ── TOTP path ─────────────────────────────────────────────────────────
      if (!user.twoFactorSecretEncrypted) {
        return NextResponse.json(
          { error: 'Two-factor authentication is not properly configured.' },
          { status: 500 }
        )
      }

      try {
        const { authenticator } = await import('@otplib/preset-default')
        const secret = decryptTotpSecret(user.twoFactorSecretEncrypted)
        verified = authenticator.check(code, secret)
      } catch (decryptErr) {
        logger.error('[verify-2fa] TOTP decrypt/verify error', {
          userId: user._id.toString(),
          errorMessage: decryptErr instanceof Error ? decryptErr.message : String(decryptErr),
        })
        return NextResponse.json(
          { error: 'Verification failed. Please try again.' },
          { status: 500 }
        )
      }

      if (!verified) {
        return NextResponse.json(
          { error: 'Invalid authenticator code. Please try again.' },
          { status: 401 }
        )
      }
    }

    // ── Promote to full session ───────────────────────────────────────────
    session.userId             = user._id.toString()
    session.name               = user.name
    session.email              = user.email
    session.isLoggedIn         = true
    session.emailVerified      = true   // 2FA gate is after the emailVerified gate in login
    session.twoFactorPending   = false
    session.pendingUserId      = undefined
    session.twoFactorPendingAt = undefined
    session.lastActiveAt       = Date.now() // inactivity timer starts at successful 2FA
    await session.save()

    logger.info('[verify-2fa] 2FA verified, session created', {
      userId: user._id.toString(),
      method: isRecovery ? 'recovery' : 'totp',
    })

    return NextResponse.json({
      message: 'Logged in successfully',
      user: { name: user.name, email: user.email },
    })
  } catch (error) {
    logger.error('[verify-2fa]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
