/**
 * POST /api/notifications/test-email
 *
 * Send a test notification email to the currently authenticated user's own
 * registered email address.
 *
 * SECURITY
 * ────────
 * • Requires a valid session — unauthenticated calls return 401.
 * • The recipient address is ALWAYS resolved from the authenticated user's
 *   database record.  No client-supplied "to" address is ever accepted.
 * • Rate-limited: 3 test emails per user per hour to prevent abuse.
 * • Only available when EMAIL_PROVIDER != 'none'.
 *
 * ISOLATION FROM EMAIL VERIFICATION
 * ───────────────────────────────────
 * This route sends a simple test notification email only.  It never touches
 * verification tokens, verification routes, or any auth flow.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { getNotificationService } from '@/lib/notifications'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { buildDailySummaryEmail } from '@/lib/auth/email-templates'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// 3 test emails per user per hour
const TEST_EMAIL_LIMIT    = 3
const TEST_EMAIL_WINDOW   = 60 * 60 * 1000  // 1 hour in ms

export async function POST(req: NextRequest) {
  // Suppress unused parameter warning — req used for body parsing below
  void req

  let userId: string

  try {
    ;({ userId } = await requireAuth())
  } catch {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 }
    )
  }

  // ── Rate limiting (per user) ─────────────────────────────────────────────
  const rateLimitKey = `test-email:${userId}`
  const rateResult   = checkRateLimit({
    key:      rateLimitKey,
    limit:    TEST_EMAIL_LIMIT,
    windowMs: TEST_EMAIL_WINDOW,
  })

  if (!rateResult.allowed) {
    return NextResponse.json(
      {
        error: {
          code:    'RATE_LIMITED',
          message: 'Too many test emails. Please wait before sending another.',
          resetAt: rateResult.resetAt,
        },
      },
      { status: 429 }
    )
  }

  // ── Email provider check ─────────────────────────────────────────────────
  const provider = (process.env.EMAIL_PROVIDER ?? 'none').toLowerCase()
  if (provider === 'none') {
    return NextResponse.json(
      {
        error: {
          code:    'EMAIL_NOT_CONFIGURED',
          message: 'Email notifications are not configured on this server. Set EMAIL_PROVIDER=smtp and SMTP credentials.',
        },
      },
      { status: 503 }
    )
  }

  // ── Resolve recipient from database ─────────────────────────────────────
  // The recipient is ALWAYS the authenticated user's own registered address.
  // No client-supplied address is ever used.
  try {
    await connectDB()
    const user = await User.findById(userId)
      .select('name email emailVerified')
      .lean()

    if (!user) {
      return NextResponse.json(
        { error: { code: 'USER_NOT_FOUND', message: 'User not found.' } },
        { status: 404 }
      )
    }

    if (!user.emailVerified) {
      return NextResponse.json(
        {
          error: {
            code:    'EMAIL_NOT_VERIFIED',
            message: 'Your email address must be verified before test emails can be sent.',
          },
        },
        { status: 403 }
      )
    }

    // Build a simple test email using the daily summary template with dummy data
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const today  = new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      day:     'numeric',
      month:   'short',
    })

    const { subject, html, text } = buildDailySummaryEmail({
      toName:          user.name,
      todayLabel:      today,
      tasksCompleted:  2,
      tasksRemaining:  1,
      habitsCompleted: 3,
      habitsTotal:     4,
      spendingNote:    undefined,
      appUrl,
    })

    // Prefix the subject so the user knows it's a test
    const testSubject = `[Test] ${subject}`

    // ── Send ───────────────────────────────────────────────────────────────
    const notifier = await getNotificationService()
    const result   = await notifier.send({
      to:      user.email,   // always the authenticated user's own address
      subject: testSubject,
      html,
      text,
    })

    if (result.ok) {
      logger.info('[test-email] Test notification email sent', {
        userId,
        // Recipient is the user's own registered address — safe to log
        recipient: user.email,
      })

      return NextResponse.json({
        ok:        true,
        message:   `Test email sent to ${user.email}`,
        messageId: result.messageId,
      })
    }

    // Provider returned a non-OK result
    logger.warn('[test-email] Provider returned failure', {
      userId,
      providerError: result.error,
    })

    return NextResponse.json(
      {
        error: {
          code:    'DELIVERY_FAILED',
          message: 'The email provider could not deliver the message. Check SMTP configuration.',
        },
      },
      { status: 502 }
    )
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[test-email] Unexpected error', { userId, errorMessage })

    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to send test email.' } },
      { status: 500 }
    )
  }
}
