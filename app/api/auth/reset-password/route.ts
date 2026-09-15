/**
 * POST /api/auth/reset-password
 *
 * Completes the password reset flow.
 *
 * Steps:
 *  1. Validate input (token + new password + confirm password).
 *  2. Hash the incoming raw token (SHA-256) for safe DB lookup.
 *  3. Rate-limit per token hash (prevents brute-force against the token space).
 *  4. Find the matching reset-token record on the User document.
 *  5. Verify the token is not expired.
 *  6. Verify the token has not already been used (cleared = used).
 *  7. Hash the new password with bcrypt (cost 12 — same as signup).
 *  8. Update the user's passwordHash and clear the reset token (single-use).
 *  9. Destroy any active session for this user (non-critical, force re-login).
 * 10. Return success.
 *
 * Security notes:
 *  - Plaintext passwords are NEVER stored or logged.
 *  - Raw reset tokens are NEVER stored or logged.
 *  - Invalid / expired / used tokens all return the same safe error message
 *    to prevent information leakage.
 *  - Session destruction is non-critical: if it fails the password has already
 *    been changed and we still return success.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { resetPasswordSchema } from '@/lib/validations'
import User from '@/models/User'
import { hashToken } from '@/lib/auth/crypto'
import { getSession } from '@/lib/session'
import { checkPasswordResetAttemptLimit } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

const isDev = process.env.NODE_ENV === 'development'

/** Safe error message for all invalid-token states. Never reveal the reason. */
const INVALID_TOKEN_RESPONSE = NextResponse.json(
  {
    success: false,
    error:   'This password reset link is invalid or has expired.',
    code:    'INVALID_TOKEN',
  },
  { status: 400 }
)

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse body ─────────────────────────────────────────────────────
    let body: unknown
    try {
      body = await req.json()
    } catch {
      logger.warn('[reset-password] Failed to parse request body as JSON')
      return NextResponse.json(
        { success: false, error: 'Invalid request.' },
        { status: 400 }
      )
    }

    // ── 2. Validate input ─────────────────────────────────────────────────
    const parsed = resetPasswordSchema.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Validation failed.'
      logger.warn('[reset-password] Validation failed', {
        issue: isDev ? msg : '[redacted]',
      })
      return NextResponse.json(
        { success: false, error: msg },
        { status: 400 }
      )
    }

    const { token: rawToken, password } = parsed.data

    // ── 3. Hash the incoming token ────────────────────────────────────────
    // hashToken() decodes base64url → raw bytes → SHA-256 hex.
    // Returns null for malformed input.
    const tokenHash = hashToken(rawToken)
    if (!tokenHash) {
      logger.warn('[reset-password] Token could not be hashed (malformed input)')
      return INVALID_TOKEN_RESPONSE
    }

    // ── 4. Rate-limit per token hash ──────────────────────────────────────
    const rateResult = checkPasswordResetAttemptLimit(tokenHash)
    if (!rateResult.allowed) {
      logger.warn('[reset-password] Rate limit exceeded for token hash prefix', {
        tokenHashPrefix: tokenHash.substring(0, 8),
      })
      return NextResponse.json(
        {
          success: false,
          error:   'Too many attempts. Please request a new reset link.',
          code:    'RATE_LIMITED',
        },
        { status: 429 }
      )
    }

    // ── 5. Connect to DB ──────────────────────────────────────────────────
    try {
      await connectDB()
    } catch (dbErr) {
      logger.error('[reset-password] Database connection failed', {
        errorMessage: dbErr instanceof Error ? dbErr.message : String(dbErr),
      })
      return NextResponse.json(
        { success: false, error: 'Service temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    // ── 6. Find user by token hash ────────────────────────────────────────
    let user: Awaited<ReturnType<typeof User.findOne>>
    try {
      user = await User.findOne({ passwordResetTokenHash: tokenHash })
    } catch (findErr) {
      logger.error('[reset-password] User lookup failed', {
        errorMessage: findErr instanceof Error ? findErr.message : String(findErr),
      })
      return NextResponse.json(
        { success: false, error: 'Service temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    if (!user) {
      logger.info('[reset-password] Token not found in database (used or never existed)')
      return INVALID_TOKEN_RESPONSE
    }

    // ── 7. Check expiry ───────────────────────────────────────────────────
    if (!user.passwordResetExpiresAt || new Date() > user.passwordResetExpiresAt) {
      // Clear the stale token — subsequent requests for same token also return invalid
      try {
        user.passwordResetTokenHash = null
        user.passwordResetExpiresAt = null
        await user.save()
      } catch (clearErr) {
        // Non-fatal: stale token stays in DB but is already expired
        logger.warn('[reset-password] Failed to clear expired token', {
          userId:       user._id.toString(),
          errorMessage: clearErr instanceof Error ? clearErr.message : String(clearErr),
        })
      }
      logger.info('[reset-password] Token expired', { userId: user._id.toString() })
      return INVALID_TOKEN_RESPONSE
    }

    // ── 8. Hash the new password ──────────────────────────────────────────
    // bcrypt cost factor 12 — same as signup.
    let newPasswordHash: string
    try {
      newPasswordHash = await bcrypt.hash(password, 12)
    } catch (hashErr) {
      logger.error('[reset-password] bcrypt.hash failed', {
        userId:       user._id.toString(),
        errorMessage: hashErr instanceof Error ? hashErr.message : String(hashErr),
      })
      return NextResponse.json(
        { success: false, error: 'Something went wrong. Please try again.' },
        { status: 500 }
      )
    }

    // ── 9. Update password + clear token (single-use) ────────────────────
    // All three fields are written in one save() — password update and token
    // invalidation are atomic from Mongoose's perspective.
    try {
      user.passwordHash           = newPasswordHash
      user.passwordResetTokenHash = null
      user.passwordResetExpiresAt = null
      await user.save()
    } catch (saveErr) {
      logger.error('[reset-password] user.save() failed after bcrypt', {
        userId:       user._id.toString(),
        errorMessage: saveErr instanceof Error ? saveErr.message : String(saveErr),
        // Safe to log these field names — no values
        fieldsTouched: ['passwordHash', 'passwordResetTokenHash', 'passwordResetExpiresAt'],
      })
      return NextResponse.json(
        { success: false, error: 'Something went wrong. Please try again.' },
        { status: 500 }
      )
    }

    // Password is successfully changed from this point forward.
    logger.info('[reset-password] Password reset successful', {
      userId: user._id.toString(),
    })

    // ── 10. Invalidate the current session (non-critical) ─────────────────
    // Destroy the lifeflow_session cookie so any active browser session for
    // this account is forced to re-login with the new password.
    // Wrapped in try/catch — session destruction failure must NOT cause the
    // API to report failure after the password has already been changed.
    try {
      const session = await getSession()
      await session.destroy()
      logger.info('[reset-password] Session invalidated after password reset', {
        userId: user._id.toString(),
      })
    } catch (sessionErr) {
      // Non-fatal: password changed successfully, session cookie may linger
      // until it expires naturally (7 days max), but the old password is gone.
      logger.warn('[reset-password] Session destruction failed (non-fatal, password was changed)', {
        userId:       user._id.toString(),
        errorMessage: sessionErr instanceof Error ? sessionErr.message : String(sessionErr),
      })
    }

    // ── 11. Return success ────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      message: 'Your password has been reset. Please log in with your new password.',
    })
  } catch (error) {
    // Top-level catch — should not be reachable in normal operation.
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[reset-password] Unhandled error', { errorMessage: msg })

    if (isDev) {
      // In development, surface the actual error to make debugging easier.
      // Never do this in production.
      return NextResponse.json(
        {
          success: false,
          error:   'Something went wrong. Please try again.',
          _devDetail: msg,
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
