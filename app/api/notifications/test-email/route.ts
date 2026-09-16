/**
 * POST /api/notifications/test-email
 *
 * One-time test notification endpoint.  Sends a branded test email to the
 * currently authenticated user's registered email address, then persists
 * `notificationsTested = true` on success.
 *
 * IDEMPOTENCY
 * ───────────
 * • Already verified (notificationsTested=true)  → 200 { alreadyActive: true }
 *   No email is sent.  The UI button must not be visible at this point, but the
 *   endpoint is safe even if called directly.
 * • Not yet verified                             → send test → persist on success
 * • SMTP failure                                 → 502, notificationsTested unchanged
 *
 * SECURITY
 * ────────
 * • Authentication required — unauthenticated calls receive 401.
 * • Recipient is ALWAYS taken from the User document in MongoDB.
 *   The request body is ignored for recipient resolution.
 * • Rate limited: 1 req/60 s + 3 req/day per user + 5 req/h per IP.
 * • SMTP credentials and session secrets are never logged or returned.
 */

import { NextRequest, NextResponse }          from 'next/server'
import { requireAuth }                        from '@/lib/session'
import { connectDB }                          from '@/lib/db'
import User                                   from '@/models/User'
import { getNotificationService }             from '@/lib/notifications'
import { buildTestNotificationEmail }         from '@/lib/auth/email-templates'
import {
  checkNotificationTestLimit,
  getClientIp,
}                                             from '@/lib/auth/rate-limit'
import logger                                 from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Authentication ──────────────────────────────────────────────────────
  let authUser: Awaited<ReturnType<typeof requireAuth>>
  try {
    authUser = await requireAuth()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg === 'UserNotFound' ? 404 : 401
    return NextResponse.json({ error: 'Unauthorized' }, { status })
  }

  // ── 2. Rate limiting ───────────────────────────────────────────────────────
  const ip = getClientIp(req)
  const rateResult = checkNotificationTestLimit(ip, authUser.userId)
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
        },
      }
    )
  }

  // ── 3. Load user from DB ───────────────────────────────────────────────────
  // Recipient is ALWAYS sourced from the database — never from the request body.
  await connectDB()
  const user = await User.findById(authUser.userId)
    .select('name email notificationsTested notificationsTestedAt emailNotifications')
    .lean()

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // ── 4. Idempotency gate ────────────────────────────────────────────────────
  // If the user has already verified, return success without sending another email.
  if (user.notificationsTested === true) {
    return NextResponse.json(
      {
        alreadyActive: true,
        message:       'Notifications are already active for your account.',
        testedAt:      user.notificationsTestedAt?.toISOString() ?? null,
      },
      { status: 200 }
    )
  }

  // ── 5. Build and send test email ───────────────────────────────────────────
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')

  const { subject, html, text } = buildTestNotificationEmail({
    toName: user.name,
    appUrl,
  })

  let sendResult: { ok: boolean; messageId?: string; error?: string }
  try {
    const notifier = await getNotificationService()
    // Recipient address comes exclusively from the User document — never from
    // the request body, headers, or any other client-supplied value.
    sendResult = await notifier.send({
      to:      user.email,
      subject,
      html,
      text,
    })
  } catch (err) {
    // Infrastructure error (provider init failure, etc.) — log safely.
    logger.error('[test-email] Notification service error', {
      // Safe diagnostics — never log email, SMTP credentials, or secrets
      userId:    authUser.userId,
      errorType: err instanceof Error ? err.constructor.name : 'unknown',
    })
    return NextResponse.json(
      { error: 'Failed to send test notification. Please try again.' },
      { status: 502 }
    )
  }

  // ── 6. Handle send failure ─────────────────────────────────────────────────
  if (!sendResult.ok) {
    logger.warn('[test-email] SMTP delivery failed — activation not recorded', {
      userId:    authUser.userId,
      // provider error message is safe (already sanitised by smtp.provider.ts)
      smtpError: sendResult.error ?? 'unknown',
    })
    return NextResponse.json(
      { error: 'Failed to deliver test notification. Please check your email configuration and try again.' },
      { status: 502 }
    )
  }

  // ── 7. Persist activation ──────────────────────────────────────────────────
  // Only reached on successful SMTP acceptance.
  const now = new Date()
  await User.findByIdAndUpdate(
    authUser.userId,
    {
      $set: {
        notificationsTested:   true,
        notificationsTestedAt: now,
        // Also flip the master email switch on — a successful test implies the
        // user wants emails.  Category flags already default to true.
        'emailNotifications.enabled': true,
      },
    },
    { new: false } // we don't need the updated doc
  )

  logger.info('[test-email] Test email accepted, activation recorded', {
    userId:    authUser.userId,
    messageId: sendResult.messageId ?? '(none)',
  })

  return NextResponse.json(
    {
      ok:        true,
      testedAt:  now.toISOString(),
      message:   'Test notification sent. Email notifications are now active.',
    },
    { status: 200 }
  )
}

// ── GET — return current activation status ────────────────────────────────────
// Allows the UI to refresh state without a full /api/auth/me fetch.
export async function GET(): Promise<NextResponse> {
  let authUser: Awaited<ReturnType<typeof requireAuth>>
  try {
    authUser = await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const user = await User.findById(authUser.userId)
    .select('notificationsTested notificationsTestedAt')
    .lean()

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    notificationsTested:   user.notificationsTested ?? false,
    notificationsTestedAt: user.notificationsTestedAt?.toISOString() ?? null,
  })
}
