/**
 * GET /api/auth/verify-email?token=...
 *
 * Verifies the email verification token, marks the user as verified,
 * creates an authenticated session so the user lands on /app/dashboard
 * without having to log in again, and redirects to
 * /verify-email?status=success|expired|invalid on completion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { connectDB } from '@/lib/db'
import { publicEnv } from '@/lib/env'
import User from '@/models/User'
import { hashToken } from '@/lib/auth/crypto'
import { SessionData, getSessionOptions } from '@/lib/session'
import logger from '@/lib/logger'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawToken = searchParams.get('token')

  // Always sourced from NEXT_PUBLIC_APP_URL env var — works on localhost,
  // AWS, or Azure without any code change between deployments.
  const redirectBase = `${publicEnv.APP_URL}/verify-email`

  // ── Reject missing token ──────────────────────────────────────────────────
  if (!rawToken) {
    return NextResponse.redirect(`${redirectBase}?status=invalid`)
  }

  // ── Hash the token ────────────────────────────────────────────────────────
  const tokenHash = hashToken(rawToken)
  if (!tokenHash) {
    return NextResponse.redirect(`${redirectBase}?status=invalid`)
  }

  try {
    await connectDB()

    // ── Look up user by token hash ────────────────────────────────────────
    const user = await User.findOne({ emailVerificationTokenHash: tokenHash })

    if (!user) {
      // Token not found — either already used or never existed
      return NextResponse.redirect(`${redirectBase}?status=invalid`)
    }

    // ── Already verified ──────────────────────────────────────────────────
    if (user.emailVerified) {
      return NextResponse.redirect(`${redirectBase}?status=already-verified`)
    }

    // ── Check expiry ──────────────────────────────────────────────────────
    if (
      !user.emailVerificationExpiresAt ||
      new Date() > user.emailVerificationExpiresAt
    ) {
      // Expired — clear the token so a fresh resend generates a new one
      user.emailVerificationTokenHash  = null
      user.emailVerificationExpiresAt  = null
      await user.save()
      return NextResponse.redirect(`${redirectBase}?status=expired`)
    }

    // ── Mark as verified and clear token (single-use) ──────────────────────
    user.emailVerified                  = true
    user.emailVerificationTokenHash     = null
    user.emailVerificationExpiresAt     = null
    await user.save()

    logger.info('[verify-email] Email verified', { userId: user._id.toString() })

    // ── Create an authenticated session ───────────────────────────────────
    // Build the redirect response first so iron-session can attach the
    // Set-Cookie header directly onto it.
    const redirectResponse = NextResponse.redirect(`${redirectBase}?status=success`)

    const session = await getIronSession<SessionData>(req, redirectResponse, getSessionOptions())
    session.userId           = user._id.toString()
    session.name             = user.name
    session.email            = user.email
    session.isLoggedIn       = true
    session.emailVerified    = true
    session.twoFactorPending = false
    await session.save()

    logger.info('[verify-email] Session created after verification', { userId: user._id.toString() })

    return redirectResponse
  } catch (error) {
    logger.error('[verify-email]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.redirect(`${redirectBase}?status=error`)
  }
}
