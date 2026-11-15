/**
 * GET  /api/support/tickets  — list the authenticated user's tickets
 * POST /api/support/tickets  — create a new support ticket
 */
import { NextRequest, NextResponse } from 'next/server'
import { connectDB }                 from '@/lib/db'
import { requireAuth }               from '@/lib/session'
import {
  handleRouteError, apiSuccess, badRequest, apiError,
} from '@/lib/api-response'
import { checkTicketCreateLimit, getClientIp } from '@/lib/auth/rate-limit'
import { sendNewTicketEmailToSupport }          from '@/lib/support/email'
import SupportTicket                            from '@/models/SupportTicket'
import Notification                             from '@/models/Notification'

export const dynamic = 'force-dynamic'

// ── GET — list own tickets ────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth({ skipActivityUpdate: true })
    await connectDB()

    const { searchParams } = req.nextUrl
    const status = searchParams.get('status') ?? ''
    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const skip   = (page - 1) * limit

    const filter: Record<string, unknown> = { userId }
    if (status && status !== 'all') filter.status = status

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .select('subject category priority status assignedToName lastMessageAt userUnreadCount messageCount createdAt updatedAt')
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ])

    return apiSuccess({
      tickets: (tickets as unknown as Record<string, unknown>[]).map(serializeTicketSummary),
      total,
      page,
      pages: Math.ceil(total / limit),
    })
  } catch (err) {
    return handleRouteError(err, '[support/tickets GET]')
  }
}

// ── POST — create ticket ──────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set([
  'account_and_login', 'notifications', 'offline_sync',
  'notes_tasks_habits_projects', 'expenses_and_subscriptions',
  'payments_and_group_bills', 'bugs_and_technical', 'other',
])
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth()
    const { userId, lifeFlowId, name: userName } = auth
    const ip = getClientIp(req)

    // Rate limit — keyed on server-verified userId (primary) and IP (secondary)
    const rl = checkTicketCreateLimit(ip, userId)
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many tickets. Please wait before submitting another.', retryAfter: retryAfterSec } },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      )
    }

    // Parse and validate body
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const subject     = (typeof body.subject     === 'string' ? body.subject.trim()     : '')
    const category    = (typeof body.category    === 'string' ? body.category.trim()    : '')
    const priority    = (typeof body.priority    === 'string' ? body.priority.trim()    : 'normal')
    const description = (typeof body.description === 'string' ? body.description.trim() : '')

    if (!subject || subject.length < 5 || subject.length > 120)
      return badRequest('Subject must be 5–120 characters')
    if (!VALID_CATEGORIES.has(category))
      return badRequest('Invalid category')
    if (!VALID_PRIORITIES.has(priority))
      return badRequest('Invalid priority')
    if (!description || description.length < 10 || description.length > 2000)
      return badRequest('Description must be 10–2000 characters')

    await connectDB()

    // Create the ticket — persist BEFORE sending any notification
    // Use 'new + save' to avoid TypeScript's strict overload inference on .create()
    const ticketDoc = new SupportTicket({
      userId,
      lifeFlowId,
      userName,
      subject,
      category,
      priority,
      description,
      status: 'open' as const,
      statusHistory: [{
        from: null,
        to: 'open',
        changedBy: userId,
        changedByRole: 'user' as const,
        timestamp: new Date(),
      }],
    })
    await ticketDoc.save()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticket = ticketDoc.toObject() as any as Record<string, unknown> & {
      _id: { toString(): string }; createdAt: Date
    }

    const ticketId = ticket._id.toString()

    // Set idempotency key for email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (SupportTicket.updateOne as any)(
      { _id: ticketDoc._id },
      { $set: { emailNotificationKey: `ticket-created:${ticketId}` } }
    )

    // Create an in-app notification for the submitting user as confirmation
    await (Notification.create as (doc: unknown) => Promise<unknown>)({
      userId,
      lifeFlowId,
      title: 'Support ticket submitted',
      message: `Your ticket "${subject}" has been received. We'll respond shortly.`,
      type: 'support',
    })

    // Send email to support team (non-fatal — fire-and-forget after persist)
    const emailResult = await sendNewTicketEmailToSupport({
      ticketId,
      subject,
      category,
      priority,
      userName,
      userEmail: auth.email,
      createdAt: ticket.createdAt as Date,
    })

    // Record email delivery status on the ticket
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (SupportTicket.updateOne as any)(
      { _id: ticketDoc._id },
      {
        $set: {
          emailNotificationSent:  emailResult.ok,
          emailNotificationError: emailResult.ok ? null : (emailResult.error ?? 'Unknown error'),
        },
      }
    )

    return apiSuccess({ ticket: serializeTicketFull(ticket) }, 201)
  } catch (err) {
    return handleRouteError(err, '[support/tickets POST]')
  }
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeTicketSummary(t: Record<string, unknown>) {
  return {
    _id:             String(t._id),
    subject:         t.subject,
    category:        t.category,
    priority:        t.priority,
    status:          t.status,
    assignedToName:  t.assignedToName ?? null,
    lastMessageAt:   t.lastMessageAt ? new Date(t.lastMessageAt as Date).toISOString() : null,
    userUnreadCount: t.userUnreadCount ?? 0,
    messageCount:    t.messageCount   ?? 0,
    createdAt:       new Date(t.createdAt as Date).toISOString(),
    updatedAt:       new Date(t.updatedAt as Date).toISOString(),
  }
}

function serializeTicketFull(t: { _id: { toString(): string }; [k: string]: unknown }) {
  return {
    _id:             t._id.toString(),
    subject:         t.subject,
    category:        t.category,
    priority:        t.priority,
    description:     t.description,
    status:          t.status,
    assignedTo:      t.assignedTo ?? null,
    assignedToName:  t.assignedToName ?? null,
    lastMessageAt:   t.lastMessageAt ? new Date(t.lastMessageAt as Date).toISOString() : null,
    userUnreadCount: t.userUnreadCount ?? 0,
    messageCount:    t.messageCount   ?? 0,
    createdAt:       new Date(t.createdAt as Date).toISOString(),
    updatedAt:       new Date(t.updatedAt as Date).toISOString(),
  }
}
