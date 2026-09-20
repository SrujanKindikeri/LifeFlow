/**
 * GET /api/notifications/history
 *
 * Returns the enriched notification delivery history for the authenticated user.
 * Reads from NotificationLog (dedup/status log) rather than the Notification
 * collection (in-app feed), so it shows SCHEDULED notifications with their
 * full delivery lifecycle — including pending, failed, and successfully sent.
 *
 * RESPONSE SHAPE
 * ──────────────
 * Each entry includes:
 *   - type              e.g. "TASK_DUE_SOON", "MORNING_BRIEF", "DAILY_SUMMARY"
 *   - typeLabel         Human-readable label
 *   - scheduledAt       UTC ISO when notification was scheduled to fire
 *   - sentAt            UTC ISO when it was handed to SMTP (null if not yet sent)
 *   - status            "pending" | "processing" | "sent_to_smtp" | "failed"
 *   - contentPreview    Short human-readable summary (≤200 chars)
 *   - emailSubject      The exact email subject that was sent (null for old entries)
 *   - emailBodySnapshot Plain-text snapshot of the email body (null for old entries)
 *   - forDate           The logical date this notification applies to (YYYY-MM-DD)
 *
 * PAGINATION
 * ──────────
 * ?page=N    Page number (1-indexed, default 1)
 * ?limit=N   Records per page (default 25, max 100)
 *
 * FILTERS
 * ───────
 * ?type=TYPE     Filter by notification type
 * ?status=S      Filter by delivery status
 * ?since=DATE    Only return entries with scheduledAt >= DATE (ISO string)
 * ?channel=email Filter to email-only entries (those with emailSubject set)
 *
 * SECURITY
 * ────────
 * - Authentication required — unauthenticated calls receive 401.
 * - Only returns log entries for the authenticated user.
 * - errorMessage is NEVER returned to the browser.
 * - No SMTP credentials, session secrets, or tokens are exposed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB }   from '@/lib/db'
import { requireAuth } from '@/lib/session'
import NotificationLog from '@/models/NotificationLog'

/** Human-readable label for each notification type. */
const TYPE_LABELS: Record<string, string> = {
  MORNING_BRIEF:         'Morning Daily Brief',
  TASK_DUE_SOON:         'Task Reminder',
  TASK_INCOMPLETE_TODAY: 'Incomplete Tasks',
  TASK_TOMORROW:         'Tomorrow Preview',
  HABIT_REMINDER:        'Habit Reminder',
  HABIT_TOMORROW:        'Tomorrow Habits',
  SPENDING_ALERT:        'Spending Alert',
  DAILY_SUMMARY:         'Daily Summary',
  WEEKLY_SUMMARY:        'Weekly Summary',
}

function serializeLog(entry: {
  _id:               { toString(): string }
  type:              string
  scheduledAt:       Date
  sentAt:            Date | null
  status:            string
  contentPreview:    string
  emailSubject?:     string | null
  emailBodySnapshot?:string | null
  forDate:           string
  createdAt:         Date
}) {
  return {
    _id:               entry._id.toString(),
    type:              entry.type,
    typeLabel:         TYPE_LABELS[entry.type] ?? entry.type,
    scheduledAt:       entry.scheduledAt.toISOString(),
    sentAt:            entry.sentAt ? entry.sentAt.toISOString() : null,
    status:            entry.status,
    contentPreview:    entry.contentPreview || '',
    emailSubject:      entry.emailSubject   ?? null,
    emailBodySnapshot: entry.emailBodySnapshot ?? null,
    forDate:           entry.forDate,
    createdAt:         entry.createdAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)

    // ── Pagination ───────────────────────────────────────────────────────────
    const rawPage  = parseInt(searchParams.get('page')  ?? '1',  10)
    const rawLimit = parseInt(searchParams.get('limit') ?? '25', 10)
    const page     = Math.max(1, isNaN(rawPage)  ? 1  : rawPage)
    const limit    = Math.min(100, Math.max(1, isNaN(rawLimit) ? 25 : rawLimit))
    const skip     = (page - 1) * limit

    // ── Filters ──────────────────────────────────────────────────────────────
    const type    = searchParams.get('type')
    const status  = searchParams.get('status')
    const since   = searchParams.get('since')
    const channel = searchParams.get('channel')

    // Build query — always scoped to authenticated user
    const query: Record<string, unknown> = { userId }
    if (type)   query.type   = type
    if (status) query.status = status
    if (since) {
      const sinceDate = new Date(since)
      if (!isNaN(sinceDate.getTime())) {
        query.scheduledAt = { $gte: sinceDate }
      }
    }
    // channel=email → only entries that have an emailSubject stored
    if (channel === 'email') {
      query.emailSubject = { $ne: null }
    }

    // ── Run count + page fetch in parallel ───────────────────────────────────
    const [total, entries] = await Promise.all([
      NotificationLog.countDocuments(query),
      NotificationLog.find(query)
        .select('type scheduledAt sentAt status contentPreview emailSubject emailBodySnapshot forDate createdAt')
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ])

    return NextResponse.json({
      history: entries.map(serializeLog),
      total,
      page,
      limit,
      hasMore: skip + entries.length < total,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[notifications/history GET]', error)
    return NextResponse.json({ error: 'Failed to fetch notification history' }, { status: 500 })
  }
}
