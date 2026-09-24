/**
 * POST /api/auth/delete-account
 *
 * Soft-deletes the authenticated user's account.
 *
 * SECURITY INVARIANTS
 * ───────────────────
 * • userId is always taken from the authenticated session — never from the request body.
 * • Current password must be provided and verified with bcrypt before any state change.
 * • The user must type the exact confirmation phrase to prevent accidental deletion.
 * • Rate-limited: max 3 attempts per user per hour, max 10 per IP per hour.
 * • All active sessions are destroyed immediately after soft-deletion.
 * • No data is permanently deleted — accountStatus is set to "deleted" and
 *   scheduledPermanentDeletionAt is set to now + 30 days.
 * • A cryptographically secure single-use restoration token is generated.
 *   Only its SHA-256 hash is stored in MongoDB; the raw token goes only into
 *   the email URL and is discarded immediately afterward.  It is NEVER logged.
 * • One confirmation email is sent containing the secure restore link.
 *   (Silently skipped if email is not configured.)
 * • The audit event ACCOUNT_DELETED is logged.
 *
 * TOKEN SECURITY
 * ──────────────
 * • generateVerificationToken() → 32 random bytes → base64url (URL) + SHA-256 (DB).
 * • Token expiry matches the 30-day recovery window so the link is valid for
 *   the entire restoration period (configurable via ACCOUNT_RESTORE_TOKEN_EXPIRY_DAYS).
 * • The token is single-use: cleared from the DB on successful restoration.
 * • The raw token is NEVER logged; only the userId is logged for audit.
 *
 * REQUEST BODY
 * ────────────
 * {
 *   password: string       // current account password
 *   confirmPhrase: string  // must equal "Delete my LifeFlow account"
 * }
 *
 * RESPONSES
 * ─────────
 * 200  { message, deletedAt, scheduledPermanentDeletionAt }
 * 400  { error }  — missing fields / wrong confirmation phrase
 * 401  { error }  — not authenticated
 * 403  { error }  — wrong password
 * 409  { error }  — account already soft-deleted
 * 429  { error }  — rate limited
 * 500  { error }  — internal error
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { checkAccountDeletionLimit, getClientIp } from '@/lib/auth/rate-limit'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { getNotificationService } from '@/lib/notifications'
import { buildAccountDeletedEmail } from '@/lib/auth/email-templates'
import { getAppUrl } from '@/lib/env'
import logger from '@/lib/logger'

/** The exact phrase the user must type to confirm deletion. */
export const DELETE_CONFIRMATION_PHRASE = 'Delete my LifeFlow account'

/** Recovery window in days — also used as the restore-token lifetime. */
const RECOVERY_WINDOW_DAYS =
  parseInt(process.env.ACCOUNT_RESTORE_TOKEN_EXPIRY_DAYS ?? '30', 10) || 30

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const { userId } = await requireAuth()

    // ── Rate limit ────────────────────────────────────────────────────────────
    const rateResult = checkAccountDeletionLimit(ip, userId)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { password?: string; confirmPhrase?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { password, confirmPhrase } = body

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 })
    }

    if (!confirmPhrase || typeof confirmPhrase !== 'string') {
      return NextResponse.json({ error: 'Confirmation phrase is required.' }, { status: 400 })
    }

    // ── Confirmation phrase check ─────────────────────────────────────────────
    // Trim whitespace but keep case-sensitive to ensure deliberate intent.
    if (confirmPhrase.trim() !== DELETE_CONFIRMATION_PHRASE) {
      return NextResponse.json(
        { error: `Please type "${DELETE_CONFIRMATION_PHRASE}" exactly to confirm.` },
        { status: 400 }
      )
    }

    await connectDB()

    // ── Fetch user ────────────────────────────────────────────────────────────
    const user = await User.findById(userId).select(
      'name email passwordHash accountStatus deletedAt scheduledPermanentDeletionAt accountRestoreTokenHash accountRestoreExpiresAt'
    )
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    // ── Already deleted? ──────────────────────────────────────────────────────
    if (user.accountStatus === 'deleted') {
      return NextResponse.json(
        { error: 'Account is already scheduled for deletion.' },
        { status: 409 }
      )
    }

    // ── Password verification ─────────────────────────────────────────────────
    // NEVER log the password value.
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Incorrect password. Please try again.' },
        { status: 403 }
      )
    }

    // ── Generate restoration token ────────────────────────────────────────────
    // generateVerificationToken() uses crypto.randomBytes(32) → base64url (URL)
    // + SHA-256 (DB).  The raw token is placed only in the email URL and then
    // discarded.  Only the hash is written to MongoDB.  Never logged.
    const { token: rawRestoreToken, tokenHash: restoreTokenHash } =
      generateVerificationToken()

    // Token lifetime matches the recovery window so the link is valid for the
    // entire 30-day period.
    const now = new Date()
    const scheduledDeletion = new Date(now)
    scheduledDeletion.setDate(scheduledDeletion.getDate() + RECOVERY_WINDOW_DAYS)

    // ── Soft-delete + store token in one save() ───────────────────────────────
    // All five fields are written atomically from Mongoose's perspective.
    user.accountStatus                = 'deleted'
    user.deletedAt                    = now
    user.scheduledPermanentDeletionAt = scheduledDeletion
    user.accountRestoreTokenHash      = restoreTokenHash
    user.accountRestoreExpiresAt      = scheduledDeletion   // same deadline

    await user.save()

    logger.info('[delete-account] Account soft-deleted', {
      userId,
      deletedAt:                    now.toISOString(),
      scheduledPermanentDeletionAt: scheduledDeletion.toISOString(),
      // Raw token NOT logged — only confirm that a hash was stored
      restoreTokenHashStored: true,
    })

    // ── Invalidate all sessions ───────────────────────────────────────────────
    // iron-session stores encrypted data in the cookie itself — there is no
    // server-side session store to flush.  Destroying this request's session
    // is sufficient; any other browser tabs will get 401/AccountDeleted on
    // their next requireAuth() call because the DB record is now "deleted".
    const session = await getSession()
    await session.destroy()

    logger.info('[delete-account] Session destroyed', { userId })

    // ── Restoration email (best-effort) ──────────────────────────────────────
    // Always sent regardless of the user's notification preferences — this is a
    // transactional security email, not a marketing or scheduled notification.
    // The raw token lives only in restoreUrl; it is never assigned to a variable
    // that might reach a logger.
    const appUrl = getAppUrl()
    // Construct the URL here — rawRestoreToken leaves this scope only inside
    // this string and then in the email body.  After this line rawRestoreToken
    // goes out of scope with the function.
    const restoreUrl = `${appUrl}/restore-account?token=${rawRestoreToken}`

    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildAccountDeletedEmail({
        toName:                       user.name,
        toEmail:                      user.email,
        deletedAt:                    now.toISOString(),
        scheduledPermanentDeletionAt: scheduledDeletion.toISOString(),
        appUrl,
        restoreUrl,   // contains raw token — only passes into the email body
      })
      const result = await notifier.send({ to: user.email, subject, html, text })
      if (result.ok) {
        logger.info('[delete-account] Restoration email sent', { userId })
      } else {
        logger.warn('[delete-account] Restoration email failed', {
          userId,
          emailError: result.error,
        })
      }
    } catch (emailErr) {
      // Email failure must never abort the deletion — the account is already
      // soft-deleted.  Log and continue.
      logger.error('[delete-account] Email error (non-fatal)', {
        userId,
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    return NextResponse.json({
      message:                      'Account scheduled for deletion.',
      deletedAt:                    now.toISOString(),
      scheduledPermanentDeletionAt: scheduledDeletion.toISOString(),
    })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
      }
      if (error.message === 'AccountDeleted') {
        return NextResponse.json(
          { error: 'Account is already scheduled for deletion.' },
          { status: 409 }
        )
      }
    }
    logger.error('[delete-account] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
