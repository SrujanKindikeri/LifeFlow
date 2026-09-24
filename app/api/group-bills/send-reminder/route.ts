/**
 * POST /api/group-bills/send-reminder
 *
 * Allows the authenticated bill owner to manually send a Group Bill reminder
 * to a specific person who appears in their Group Bills.
 *
 * ── SECURITY MODEL ────────────────────────────────────────────────────────────
 * 1. Sender must be authenticated (requireAuth).
 * 2. personKey (normalised name) is resolved to a Person record owned by the
 *    authenticated user — never trusted raw from the client.
 * 3. Outstanding balance is re-calculated live from the database — never
 *    accepted from the client body.
 * 4. Recipient email is resolved from the Person record in MongoDB — never
 *    accepted from the client body.
 * 5. Recipient in-app user ID is resolved from Person.linkedUserId — never
 *    accepted from the client body.
 * 6. Delivery channels are gated by the recipient's notification preferences
 *    (spendingAlerts flag, same as the scheduled GROUP_BILL_REMINDER).
 * 7. Server-side idempotency via NotificationLog unique key prevents
 *    double-sends even if the client fires the request twice.
 * 8. Rate-limited via checkBillReminderLimit (60-s cooldown, 3/day per
 *    recipient, 10/day total, 20/hr per IP).
 * 9. A secure public-reminder token (GroupBillReminderToken) is generated and
 *    stored at send time.  The raw token is embedded in the email URL only —
 *    the database stores only its SHA-256 hash.  The token expires after
 *    TOKEN_TTL_DAYS days so the public link does not persist indefinitely.
 *
 * ── REQUEST BODY ──────────────────────────────────────────────────────────────
 * {
 *   personKey:  string   // normalised (lowercase) name key from PersonSummary
 *   channel:    "app" | "email" | "both"
 *   requestId:  string   // client-generated UUID for idempotency
 * }
 *
 * ── RESPONSE ──────────────────────────────────────────────────────────────────
 * 200 { appSent: boolean, emailSent: boolean }
 * 400 validation / no outstanding balance / no channel available
 * 401 unauthenticated
 * 409 idempotency conflict (already sent this requestId)
 * 429 rate limited
 * 500 server error
 */

import { NextRequest } from 'next/server'
import mongoose from 'mongoose'
import { z } from 'zod'

import { connectDB }          from '@/lib/db'
import { requireAuth }        from '@/lib/session'
import {
  apiSuccess,
  badRequest,
  unauthorized,
  apiError,
} from '@/lib/api-response'
import {
  checkBillReminderLimit,
  getClientIp,
} from '@/lib/auth/rate-limit'
import {
  buildGroupBillManualReminderEmail,
} from '@/lib/auth/email-templates'
import { getNotificationService }  from '@/lib/notifications'
import { aggregateGroupBillPeople } from '@/lib/groupBillAggregator'
import { getAppUrl }                from '@/lib/env'
import {
  generateReminderToken,
  hashEmailForStorage,
}                                   from '@/lib/auth/crypto'

import GroupBill      from '@/models/GroupBill'
import Person         from '@/models/Person'
import User           from '@/models/User'
import Notification   from '@/models/Notification'
import NotificationLog from '@/models/NotificationLog'
import GroupBillReminderToken, { TOKEN_TTL_DAYS } from '@/models/GroupBillReminderToken'

import type { IGroupBill } from '@/models/GroupBill'
import type { IPerson }    from '@/models/Person'

// ─── Recipient user shape (lean projection) ───────────────────────────────────

interface RecipientUser {
  _id:                     mongoose.Types.ObjectId
  publicId:                string
  name:                    string
  notificationPreferences: { spendingAlerts: boolean }
  emailNotifications:      { enabled: boolean; spendingAlerts: boolean }
}

// ─── Constants ────────────────────────────────────────────────────────────────
// APP_URL is resolved at request time via getAppUrl() — not at module load —
// so it always reflects the live environment variable value.

// ─── Request schema ────────────────────────────────────────────────────────────

const bodySchema = z.object({
  /**
   * The normalised (lowercase+trimmed) name key from PersonSummary.
   * Used server-side to look up the Person record — never trusted for auth.
   */
  personKey: z
    .string()
    .min(1)
    .max(100)
    .transform((v) => v.toLowerCase().trim()),

  /** Delivery channel requested by the sender. */
  channel: z.enum(['app', 'email', 'both']),

  /**
   * Client-generated UUIDv4 for idempotency.
   * Prevents double-send if the client fires the request twice.
   * Server builds the NotificationLog key using this value.
   */
  requestId: z
    .string()
    .uuid('requestId must be a valid UUID')
    .max(36),
})

// ─── NotificationLog key builder ──────────────────────────────────────────────

function buildReminderKey(
  senderUserId: string,
  personKey: string,
  requestId: string,
): string {
  // Format: "<senderUserId>:GROUP_BILL_MANUAL_REMINDER:<personKey>:<requestId>"
  // personKey is already normalised (lowercase+trimmed) by Zod transform.
  return `${senderUserId}:GROUP_BILL_MANUAL_REMINDER:${personKey}:${requestId}`
}

// ─── Strip HTML helper (inline — mirrors notificationScheduler) ───────────────

function stripHtmlForSnapshot(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(p|div|br|tr|li|h[1-6]|section|article|header|footer|blockquote)[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000)
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── 1. Authentication ────────────────────────────────────────────────────
  let sender: { userId: string; name: string; email: string; lifeFlowId: string }
  try {
    sender = await requireAuth()
  } catch {
    return unauthorized()
  }

  // ── 2. Rate limiting ─────────────────────────────────────────────────────
  // personKey from rate-limit key: we parse body first for the personKey.
  // Parse body before rate-limit so we can include personKey in the bucket.
  let body: z.infer<typeof bodySchema>
  try {
    const raw = await req.json()
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    body = parsed.data
  } catch {
    return badRequest('Invalid JSON body')
  }

  const ip      = getClientIp(req)
  const rlCheck = checkBillReminderLimit(ip, sender.userId, body.personKey)
  if (!rlCheck.allowed) {
    return apiError('RATE_LIMITED', 'Too many reminders sent. Please wait before sending another.', 429)
  }

  // ── 3. Connect DB & resolve sender's full record ─────────────────────────
  await connectDB()

  const senderObjectId = new mongoose.Types.ObjectId(sender.userId)

  // Fetch sender's upiId from the database — never trusted from the client.
  // Only publicId and upiId are needed beyond what requireAuth() already gives us.
  const senderDbRecord = await User.findById(senderObjectId)
    .select('publicId upiId')
    .lean<{ publicId: string; upiId: string | null }>()

  // Fall back to session lifeFlowId if the DB record is unavailable (shouldn't happen).
  const senderLifeFlowId = senderDbRecord?.publicId ?? sender.lifeFlowId ?? ''
  const senderUpiId      = senderDbRecord?.upiId    ?? null

  // ── 4. Idempotency check ─────────────────────────────────────────────────
  const idempotencyKey = buildReminderKey(sender.userId, body.personKey, body.requestId)

  const existingLog = await NotificationLog.findOne({ key: idempotencyKey })
    .select('status')
    .lean()

  if (existingLog) {
    // Already processed — return the same logical "success" to the client
    // so UI doesn't show a confusing error on retry.
    return apiSuccess({
      appSent:   false,
      emailSent: false,
      duplicate: true,
      message:   'Reminder already sent for this request.',
    })
  }

  // ── 5. Resolve Person record (scoped to authenticated user) ──────────────
  // We match by normalised name — same strategy as the aggregator.
  const allPersons = await Person.find({ userId: senderObjectId })
    .select('name email linkedLifeFlowId linkedUserId source')
    .lean()

  const personRecord = allPersons.find(
    (p) => p.name.toLowerCase().trim() === body.personKey,
  ) as (IPerson & { _id: mongoose.Types.ObjectId }) | undefined

  // ── 6. Aggregate outstanding balance (live, never from client) ───────────
  const bills = await GroupBill.find({ userId: senderObjectId })
    .select('name date currency people settlements')
    .lean()

  const summaries = aggregateGroupBillPeople(
    bills as unknown as (IGroupBill & { _id: mongoose.Types.ObjectId })[],
    allPersons as unknown as (IPerson & { _id: mongoose.Types.ObjectId })[],
  )

  const personSummary = summaries.find(
    (s) => s.key === body.personKey,
  )

  if (!personSummary) {
    return badRequest('Person not found in your Group Bills.')
  }

  // ── 7. Verify outstanding balance > 0 ────────────────────────────────────
  // Only owes_you direction is actionable for a manual reminder from the sender.
  if (personSummary.direction !== 'owes_you' || personSummary.netBalance <= 0) {
    return badRequest('No outstanding balance for this person. Reminder cannot be sent.')
  }

  const totalOutstanding = personSummary.totalOwesYou  // positive: they owe sender
  const currency = personSummary.bills[0]?.currency ?? 'INR'

  // ── 8. Determine available channels ──────────────────────────────────────
  const hasEmail    = Boolean(personRecord?.email && personRecord.email.includes('@'))
  const linkedUserId = personRecord?.linkedUserId
    ? (personRecord.linkedUserId instanceof mongoose.Types.ObjectId
        ? personRecord.linkedUserId
        : new mongoose.Types.ObjectId(String(personRecord.linkedUserId)))
    : null

  // Resolve recipient LifeFlow user for in-app preferences
  let recipientUser: RecipientUser | null = null

  if (linkedUserId) {
    recipientUser = await User.findById(linkedUserId)
      .select('publicId name notificationPreferences emailNotifications')
      .lean() as RecipientUser | null
  }

  const hasAppChannel   = Boolean(recipientUser)
  const hasEmailChannel = hasEmail

  // ── 9. Validate the requested channel is available ────────────────────────
  if (body.channel === 'app' && !hasAppChannel) {
    return badRequest('This person does not have a LifeFlow account. In-app notification is not available.')
  }
  if (body.channel === 'email' && !hasEmailChannel) {
    return badRequest('This person does not have an email address on file. Email notification is not available.')
  }
  if (body.channel === 'both' && !hasAppChannel && !hasEmailChannel) {
    return badRequest('No notification method is available for this person.')
  }

  // ── 10. Respect recipient's notification preferences ─────────────────────
  const appEnabled = hasAppChannel
    && (recipientUser?.notificationPreferences?.spendingAlerts ?? true)
  const emailEnabled = hasEmailChannel
    && (recipientUser
      ? (recipientUser.emailNotifications?.enabled && recipientUser.emailNotifications?.spendingAlerts)
      : true)   // non-LF user has no prefs — allow email

  if (body.channel === 'app' && !appEnabled) {
    return badRequest('In-app notifications are disabled for this person.')
  }
  if (body.channel === 'email' && !emailEnabled) {
    return badRequest('Email notifications are disabled for this person.')
  }
  if (body.channel === 'both' && !appEnabled && !emailEnabled) {
    return badRequest('All notification channels are disabled for this person.')
  }

  // ── 11. Build content ────────────────────────────────────────────────────
  const recipientName  = personSummary.displayName
  const billLines = personSummary.bills
    .filter((b) => b.owesYouAmount > 0)
    .map((b) => ({
      billName:   b.billName,
      billDate:   b.billDate,
      amountOwed: b.owesYouAmount,
    }))

  const inAppTitle   = 'Group Bill Reminder'
  const inAppMessage =
    `${sender.name} sent you a reminder. You have ` +
    `${_fmtAmount(totalOutstanding, currency)} outstanding across ` +
    `${personSummary.billCount} Group Bill${personSummary.billCount !== 1 ? 's' : ''}` +
    (senderUpiId ? `. Pay to: ${senderUpiId}` : '') +
    '.'

  // ── 11b. Generate public reminder token ──────────────────────────────────
  // A cryptographically secure raw token is embedded in the email URL only.
  // Only its SHA-256 hash is written to MongoDB.
  // The token expires after TOKEN_TTL_DAYS days.
  // On failure we degrade gracefully — the email still sends, but with the
  // authenticated fallback URL instead of the public page.
  let publicReminderUrl: string | undefined
  const appBaseUrl = getAppUrl()

  try {
    const { rawToken, tokenHash } = generateReminderToken()

    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

    // Collect bill ObjectIds for future revocation cross-checks.
    const billObjectIds = personSummary.bills.map((b) => {
      try {
        return new mongoose.Types.ObjectId(b.billId)
      } catch {
        return null
      }
    }).filter(Boolean) as mongoose.Types.ObjectId[]

    // Build per-bill snapshots (matches IBillSnapshot shape).
    const billsSnapshot = billLines.map((b) => ({
      billId:    personSummary.bills.find(
        (pb) => pb.billName === b.billName && pb.billDate === b.billDate
      )?.billId ?? '',
      billName:  b.billName,
      billDate:  b.billDate,
      amountOwed: b.amountOwed,
      currency,
    }))

    await GroupBillReminderToken.create({
      tokenHash,
      notificationLogId:  null,  // will be back-patched after logDoc is created
      senderUserId:        senderObjectId,
      recipientPersonId:   personRecord?._id ?? null,
      recipientEmailHash:  personRecord?.email
        ? hashEmailForStorage(personRecord.email)
        : null,
      billIds:             billObjectIds,
      senderSnapshot: {
        name:       sender.name,
        lifeFlowId: senderLifeFlowId,
        upiId:      senderUpiId ?? null,
      },
      billsSnapshot,
      recipientName,
      currency,
      expiresAt,
      revokedAt: null,
    })

    // Raw token goes into the URL — never into the DB.
    publicReminderUrl = new URL(
      `/group-bill/view/${rawToken}`,
      appBaseUrl,
    ).toString()
  } catch (tokenErr: unknown) {
    // Non-fatal — email still sends with the authenticated fallback URL.
    // Log minimally; never log the raw token.
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr)
    console.error('[send-reminder] Failed to create public reminder token:', msg)
    publicReminderUrl = undefined
  }

  // ── 12. Claim the idempotency slot BEFORE sending ────────────────────────
  const logDoc = await NotificationLog.create({
    key:            idempotencyKey,
    userId:         senderObjectId,   // sender owns the log entry
    type:           'GROUP_BILL_MANUAL_REMINDER',
    forDate:        new Date().toISOString().slice(0, 10),
    scheduledAt:    new Date(),
    status:         'pending',
    contentPreview: inAppMessage.slice(0, 200),
  }).catch((err: unknown) => {
    // E11000 — concurrent duplicate request; treat as already-sent
    if (
      err instanceof Error &&
      (err.message.includes('E11000') || err.message.includes('duplicate key'))
    ) {
      return null
    }
    throw err
  })

  if (!logDoc) {
    // Race condition: another request with the same requestId won the race
    return apiSuccess({
      appSent:   false,
      emailSent: false,
      duplicate: true,
      message:   'Reminder already sent for this request.',
    })
  }

  // Back-patch the notificationLogId on the reminder token now that logDoc exists.
  // Fire-and-forget — never let this failure break the send flow.
  if (publicReminderUrl) {
    GroupBillReminderToken.findOneAndUpdate(
      { senderUserId: senderObjectId, notificationLogId: null, revokedAt: null,
        expiresAt: { $gt: new Date() } },
      { $set: { notificationLogId: logDoc._id } },
      { sort: { createdAt: -1 } },
    ).catch(() => undefined)
  }

  // ── 13. Deliver — treat each channel independently ───────────────────────
  let appSent   = false
  let emailSent = false
  let appError: string | null   = null
  let emailError: string | null = null

  const shouldSendApp   = (body.channel === 'app'   || body.channel === 'both') && appEnabled
  const shouldSendEmail = (body.channel === 'email' || body.channel === 'both') && emailEnabled

  // 13a. In-app notification → recipient's Notification collection
  if (shouldSendApp && recipientUser) {
    try {
      await Notification.create({
        userId:     recipientUser._id,
        lifeFlowId: recipientUser.publicId ?? '',
        title:      inAppTitle,
        message:    inAppMessage,
        type:       'reminder',
      })
      appSent = true
    } catch (err: unknown) {
      appError = err instanceof Error ? err.message : 'Unknown error'
    }
  }

  // 13b. Email → resolved email address (never from client)
  let emailContent: { subject: string; html: string; text: string } | null = null
  if (shouldSendEmail && hasEmail) {
    try {
      emailContent = buildGroupBillManualReminderEmail({
        recipientName,
        senderName:       sender.name,
        senderLifeFlowId,
        senderUpiId,
        totalOutstanding,
        currency,
        bills:            billLines,
        appUrl:           appBaseUrl,
        publicReminderUrl,
      })

      const notifier = await getNotificationService()
      const result   = await notifier.send({
        to:      personRecord!.email!,
        subject: emailContent.subject,
        html:    emailContent.html,
        text:    emailContent.text,
      })

      if (result.ok) {
        emailSent = true
      } else {
        emailError = result.error ?? 'Provider returned non-OK'
      }
    } catch (err: unknown) {
      emailError = err instanceof Error
        ? err.message.replace(/pass(word)?[=:\s]+\S+/gi, '[REDACTED]')
        : 'Unexpected error'
    }
  }

  // ── 14. Update NotificationLog status ────────────────────────────────────
  const overallSuccess = (!shouldSendApp || appSent) && (!shouldSendEmail || emailSent)
  const anySuccess     = appSent || emailSent

  const logUpdate: Record<string, unknown> = {
    sentAt: anySuccess ? new Date() : null,
    status: overallSuccess
      ? 'sent_to_smtp'
      : anySuccess
        ? 'sent_to_smtp'    // partial — at least one channel succeeded
        : 'failed',
  }

  if (emailContent?.subject) {
    logUpdate.emailSubject = emailContent.subject.slice(0, 500)
  }
  if (emailSent && emailContent?.html) {
    logUpdate.emailBodySnapshot = stripHtmlForSnapshot(emailContent.html)
  }

  // Collect error info
  const errors: string[] = []
  if (appError)   errors.push(`app: ${appError}`)
  if (emailError) errors.push(`email: ${emailError}`)
  if (errors.length > 0) {
    logUpdate.errorMessage = errors.join('; ').slice(0, 500)
  }

  await NotificationLog.updateOne(
    { key: idempotencyKey },
    { $set: logUpdate },
  ).catch(() => undefined)  // never let log update failure break the response

  // ── 15. Build response ────────────────────────────────────────────────────
  if (!anySuccess) {
    return apiError('INTERNAL_ERROR', 'Failed to send reminder. Please try again.', 500)
  }

  return apiSuccess({
    appSent,
    emailSent,
    ...(appError   && { appError:   'Failed to send in-app notification.' }),
    ...(emailError && { emailError: 'Failed to send email.' }),
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _fmtAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  }
  const sym = symbols[currency] ?? currency
  return `${sym}${Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
