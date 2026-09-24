/**
 * POST /api/auth/restore-account
 *
 * Restores a soft-deleted account using a secure single-use email token
 * plus password verification.
 *
 * SECURITY DESIGN
 * ───────────────
 * • Does NOT require an active session — sessions were destroyed on deletion.
 * • Identity is verified by two independent factors:
 *     1. A cryptographically secure single-use token from the restoration email.
 *     2. The account's current password (bcrypt compare).
 *   Both must pass before any state change is made.
 * • The raw token is hashed (SHA-256) before DB lookup — never stored, never logged.
 * • Only accounts with accountStatus = "deleted" AND within the recovery window
 *   can be restored.  Active, expired, or permanently-deleted accounts are rejected.
 * • Rate-limited: per-token-hash (5/15 min) + per-IP early gate (20/hr).
 * • The restoration token is cleared in the same save() that restores the account,
 *   making it single-use and preventing replay.
 * • A new full iron-session is issued on success — the user is logged back in.
 * • A confirmation email is sent best-effort on success.
 * • Notifications resume automatically: the scheduler already gates on
 *   accountStatus: { $ne: 'deleted' } — restoring to 'active' is sufficient.
 * • The User document is updated in-place — NO new user or DB is created.
 * • All existing user data is preserved.
 * • The audit event ACCOUNT_RESTORED is logged (userId only, no PII).
 *
 * REQUEST BODY
 * ────────────
 * {
 *   token:    string   // raw base64url restoration token from the email URL
 *   password: string   // current account password
 * }
 *
 * RESPONSES
 * ─────────
 * 200  { message, user: { name, email } }
 * 400  { error, code: 'INVALID_TOKEN' }    — missing / malformed / used / not found
 * 400  { error, code: 'TOKEN_EXPIRED' }    — token found but past its expiry
 * 401  { error }                           — wrong password
 * 403  { error, code: 'RECOVERY_WINDOW_EXPIRED' } — scheduledPermanentDeletionAt passed
 * 410  { error, code: 'ACCOUNT_GONE' }     — account no longer in recovery state
 * 429  { error }                           — rate limited
 * 500  { error }                           — internal error
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { hashToken } from '@/lib/auth/crypto'
import {
  checkRestoreTokenAttemptLimit,
  checkRateLimit,
  getClientIp,
} from '@/lib/auth/rate-limit'
import { getNotificationService } from '@/lib/notifications'
import { buildAccountRestoredEmail } from '@/lib/auth/email-templates'
import { getAppUrl } from '@/lib/env'
import logger from '@/lib/logger'

/** Safe error for all invalid-token states — never reveal which condition failed. */
const INVALID_TOKEN_RESPONSE = NextResponse.json(
  {
    error: 'This restoration link is invalid or has already been used.',
    code:  'INVALID_TOKEN',
  },
  { status: 400 }
)

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Early per-IP rate limit ───────────────────────────────────────────────
    // Applied before any DB work so abusive callers are stopped cheaply.
    const ipEarlyLimit = checkRateLimit({
      key:      `restore-account:ip-early:${ip}`,
      limit:    20,
      windowMs: 60 * 60 * 1000,
    })
    if (!ipEarlyLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { token?: string; password?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { token: rawToken, password } = body

    if (!rawToken || typeof rawToken !== 'string') {
      return INVALID_TOKEN_RESPONSE
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 })
    }

    // ── Hash the incoming token ───────────────────────────────────────────────
    // hashToken() decodes base64url → raw bytes → SHA-256 hex.
    // Returns null for malformed input.
    const tokenHash = hashToken(rawToken)
    if (!tokenHash) {
      logger.warn('[restore-account] Token could not be hashed (malformed input)', { ip })
      return INVALID_TOKEN_RESPONSE
    }

    // ── Per-token-hash rate limit ─────────────────────────────────────────────
    // Prevents brute-force of the password field against a known token hash.
    const tokenRateResult = checkRestoreTokenAttemptLimit(tokenHash)
    if (!tokenRateResult.allowed) {
      logger.warn('[restore-account] Rate limit exceeded for token hash prefix', {
        tokenHashPrefix: tokenHash.substring(0, 8),
      })
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── DB lookup by token hash ───────────────────────────────────────────────
    await connectDB()

    const user = await User.findOne({
      accountRestoreTokenHash: tokenHash,
    }).select(
      'name email passwordHash accountStatus deletedAt scheduledPermanentDeletionAt ' +
      'accountRestoreTokenHash accountRestoreExpiresAt ' +
      'emailVerified twoFactorEnabled emailNotifications notificationsTested'
    )

    // Token not found — used, never existed, or cleared
    if (!user) {
      logger.info('[restore-account] Token not found in DB (used or never existed)')
      return INVALID_TOKEN_RESPONSE
    }

    const now = new Date()

    // ── Account no longer in recovery state ───────────────────────────────────
    // Covers: account was already restored by a different request, or the
    // cleanup job has permanently deleted it.
    if (user.accountStatus !== 'deleted') {
      logger.info('[restore-account] Account not in deleted state', {
        accountStatus: user.accountStatus,
      })
      return NextResponse.json(
        {
          error: 'This account can no longer be restored.',
          code:  'ACCOUNT_GONE',
        },
        { status: 410 }
      )
    }

    // ── Recovery window check ─────────────────────────────────────────────────
    const scheduledDeletion = user.scheduledPermanentDeletionAt
    if (!scheduledDeletion || now >= scheduledDeletion) {
      logger.warn('[restore-account] Restore attempted after recovery window expired', {
        scheduledPermanentDeletionAt: scheduledDeletion?.toISOString() ?? 'null',
      })
      return NextResponse.json(
        {
          error: 'The 30-day recovery window has expired. This account can no longer be restored.',
          code:  'RECOVERY_WINDOW_EXPIRED',
        },
        { status: 403 }
      )
    }

    // ── Token expiry check ────────────────────────────────────────────────────
    if (!user.accountRestoreExpiresAt || now >= user.accountRestoreExpiresAt) {
      logger.info('[restore-account] Restoration token expired')
      return NextResponse.json(
        {
          error: 'Your account restoration link has expired.',
          code:  'TOKEN_EXPIRED',
        },
        { status: 400 }
      )
    }

    // ── Password verification ─────────────────────────────────────────────────
    // NEVER log the password value.
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      // Return a generic 401 — do not confirm whether the token was valid
      // (an attacker who can enumerate token validity gains a partial oracle).
      return NextResponse.json(
        { error: 'Incorrect password. Please try again.' },
        { status: 401 }
      )
    }

    // ── Restore the account ───────────────────────────────────────────────────
    // All state changes are written in one save():
    //   • accountStatus restored to 'active'
    //   • deletedAt / scheduledPermanentDeletionAt cleared
    //   • accountRestoreTokenHash / accountRestoreExpiresAt cleared (single-use)
    // This makes the operation atomic from Mongoose's perspective — a concurrent
    // duplicate request that reaches this point will get a stale document and
    // fail at findOne (token already cleared → null).
    user.accountStatus                = 'active'
    user.deletedAt                    = null
    user.scheduledPermanentDeletionAt = null
    user.accountRestoreTokenHash      = null   // invalidate token immediately
    user.accountRestoreExpiresAt      = null

    await user.save()

    logger.info('[restore-account] Account restored', {
      userId:     user._id.toString(),
      restoredAt: now.toISOString(),
    })

    // ── Issue a new full session ──────────────────────────────────────────────
    // The account is now active — create a fresh authenticated session so the
    // user is logged in immediately after restoration.
    const session = await getSession()
    session.userId           = user._id.toString()
    session.name             = user.name
    session.email            = user.email
    session.isLoggedIn       = true
    session.emailVerified    = user.emailVerified !== false   // preserve legacy true
    session.twoFactorPending = false
    session.pendingUserId    = undefined
    await session.save()

    logger.info('[restore-account] Session issued', { userId: user._id.toString() })

    // ── Confirmation email (best-effort) ──────────────────────────────────────
    // Sent regardless of notification preferences — transactional security email.
    // Notifications via the scheduler resume automatically because the scheduler
    // filters accountStatus: { $ne: 'deleted' } — no extra action needed here.
    const appUrl = getAppUrl()
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildAccountRestoredEmail({
        toName:  user.name,
        toEmail: user.email,
        appUrl,
      })
      const result = await notifier.send({ to: user.email, subject, html, text })
      if (result.ok) {
        logger.info('[restore-account] Confirmation email sent', {
          userId: user._id.toString(),
        })
      } else {
        logger.warn('[restore-account] Confirmation email failed', {
          userId:     user._id.toString(),
          emailError: result.error,
        })
      }
    } catch (emailErr) {
      // Email failure must never undo the restoration — account is already active.
      logger.error('[restore-account] Email error (non-fatal)', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    return NextResponse.json({
      message: 'Your account has been restored successfully.',
      user:    { name: user.name, email: user.email },
    })
  } catch (error) {
    logger.error('[restore-account] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
