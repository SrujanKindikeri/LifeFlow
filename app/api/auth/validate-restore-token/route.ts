/**
 * GET /api/auth/validate-restore-token?token=<raw-token>
 *
 * Validates a restoration token before the user commits to restoring.
 * Called by the /restore-account page on mount to decide which UI state
 * to show (valid form, expired notice, or already-deleted notice).
 *
 * SECURITY DESIGN
 * ───────────────
 * • The raw token is hashed (SHA-256) before any DB lookup — the plaintext
 *   is never stored or logged.
 * • Rate-limited per token hash (5 attempts / 15 min) to prevent brute-force.
 * • Returns an identical generic 400 for every invalid state (not found,
 *   expired, already used, account gone) so callers cannot distinguish
 *   between them.  The only distinction exposed is EXPIRED vs INVALID so
 *   the UI can show the right human-friendly message without leaking state.
 * • Never reveals whether an arbitrary email address belongs to an account.
 * • The account's name is returned on success so the page can personalise
 *   the greeting — no other PII is exposed.
 *
 * RESPONSES
 * ─────────
 * 200  { valid: true,  name: string, scheduledPermanentDeletionAt: string }
 * 400  { valid: false, code: 'INVALID_TOKEN' }   — missing / malformed / used / not found
 * 400  { valid: false, code: 'TOKEN_EXPIRED' }   — token found but past its expiry
 * 410  { valid: false, code: 'ACCOUNT_GONE' }    — recovery window has fully closed
 * 429  { error: string }                          — rate limited
 * 500  { error: string }                          — internal error
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { hashToken } from '@/lib/auth/crypto'
import { checkRestoreTokenAttemptLimit, checkRateLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

/** Returned for every invalid / unusable token state — uniform to prevent info leakage. */
const INVALID_TOKEN_RESPONSE = NextResponse.json(
  { valid: false, code: 'INVALID_TOKEN' },
  { status: 400 }
)

export async function GET(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // ── Early per-IP rate limit ───────────────────────────────────────────────
    // Applied before DB or token hashing so crawlers/scanners are stopped cheaply.
    const ipLimit = checkRateLimit({
      key:      `validate-restore-token:ip:${ip}`,
      limit:    30,
      windowMs: 60 * 60 * 1000,   // 30 validation checks per IP per hour
    })
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── Extract raw token from query string ───────────────────────────────────
    const rawToken = req.nextUrl.searchParams.get('token') ?? ''
    if (!rawToken) {
      return INVALID_TOKEN_RESPONSE
    }

    // ── Hash the incoming token ───────────────────────────────────────────────
    // hashToken() decodes base64url → raw bytes → SHA-256 hex.
    // Returns null for malformed input — treated as INVALID_TOKEN.
    const tokenHash = hashToken(rawToken)
    if (!tokenHash) {
      logger.warn('[validate-restore-token] Could not hash token (malformed input)', { ip })
      return INVALID_TOKEN_RESPONSE
    }

    // ── Per-token-hash rate limit ─────────────────────────────────────────────
    const tokenLimit = checkRestoreTokenAttemptLimit(tokenHash)
    if (!tokenLimit.allowed) {
      logger.warn('[validate-restore-token] Rate limit exceeded for token hash prefix', {
        tokenHashPrefix: tokenHash.substring(0, 8),
      })
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // ── DB lookup ─────────────────────────────────────────────────────────────
    await connectDB()

    const user = await User.findOne({
      accountRestoreTokenHash: tokenHash,
    }).select('name accountStatus accountRestoreExpiresAt scheduledPermanentDeletionAt')

    // Token not found (never existed, already used, or cleared) → INVALID
    if (!user) {
      logger.info('[validate-restore-token] Token not found in DB (used or never existed)')
      return INVALID_TOKEN_RESPONSE
    }

    const now = new Date()

    // ── Account permanently gone ──────────────────────────────────────────────
    // The cleanup job may have already run and hard-deleted the user; or
    // scheduledPermanentDeletionAt has passed but the job hasn't run yet.
    // Either way the account cannot be restored.
    if (
      user.accountStatus !== 'deleted' ||
      !user.scheduledPermanentDeletionAt ||
      now >= user.scheduledPermanentDeletionAt
    ) {
      logger.info('[validate-restore-token] Account no longer in recovery window', {
        accountStatus:                user.accountStatus,
        scheduledPermanentDeletionAt: user.scheduledPermanentDeletionAt?.toISOString() ?? null,
      })
      return NextResponse.json(
        { valid: false, code: 'ACCOUNT_GONE' },
        { status: 410 }
      )
    }

    // ── Token expiry check ────────────────────────────────────────────────────
    if (!user.accountRestoreExpiresAt || now >= user.accountRestoreExpiresAt) {
      logger.info('[validate-restore-token] Token expired', {
        expiredAt: user.accountRestoreExpiresAt?.toISOString() ?? null,
      })
      // Return TOKEN_EXPIRED so the page can show "Your restoration link has expired."
      // instead of the generic invalid-token message — better UX, no security risk
      // because we are not leaking any account state beyond what the token holder
      // already knows (they received the email).
      return NextResponse.json(
        { valid: false, code: 'TOKEN_EXPIRED' },
        { status: 400 }
      )
    }

    // ── Valid token ───────────────────────────────────────────────────────────
    logger.info('[validate-restore-token] Token valid', {
      // Log only non-PII: the scheduled deletion date and that a valid token was found.
      scheduledPermanentDeletionAt: user.scheduledPermanentDeletionAt.toISOString(),
    })

    return NextResponse.json({
      valid:                        true,
      name:                         user.name,
      scheduledPermanentDeletionAt: user.scheduledPermanentDeletionAt.toISOString(),
    })
  } catch (error) {
    logger.error('[validate-restore-token] Unexpected error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
