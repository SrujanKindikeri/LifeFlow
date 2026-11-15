/**
 * GET /api/admin/support/tickets — list all support tickets (admin)
 *
 * Query params:
 *   status   — open | waiting_for_admin | waiting_for_user | resolved | closed | all
 *   priority — low | normal | high | urgent
 *   q        — search subject or user name/email
 *   page     — 1-indexed (default: 1)
 *   limit    — 1–100 (default: 25)
 *   sort     — lastMessage | created | priority (default: lastMessage)
 */
import { NextRequest, NextResponse }          from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB }                          from '@/lib/db'
import { apiSuccess }                         from '@/lib/api-response'
import SupportTicket                          from '@/models/SupportTicket'

export const dynamic = 'force-dynamic'

const VALID_STATUSES  = new Set(['open','waiting_for_admin','waiting_for_user','resolved','closed'])
const VALID_SORTS     = new Set(['lastMessage','created','priority'])
const PRIORITY_ORDER  = { urgent: 0, high: 1, normal: 2, low: 3 }

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status') ?? 'all'
    const priority = searchParams.get('priority') ?? ''
    const q        = searchParams.get('q')?.trim() ?? ''
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit    = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)))
    const sort     = VALID_SORTS.has(searchParams.get('sort') ?? '') ? searchParams.get('sort')! : 'lastMessage'
    const skip     = (page - 1) * limit

    const filter: Record<string, unknown> = {}
    if (status !== 'all' && VALID_STATUSES.has(status)) filter.status = status
    if (priority && ['low','normal','high','urgent'].includes(priority)) filter.priority = priority
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.$or = [
        { subject:  { $regex: esc, $options: 'i' } },
        { userName: { $regex: esc, $options: 'i' } },
      ]
    }

    const sortSpec: Record<string, 1 | -1> =
      sort === 'created'      ? { createdAt: -1 }
      : sort === 'priority'   ? { priority: 1, createdAt: -1 }
      : { lastMessageAt: -1, createdAt: -1 }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ])

    // Pending counts per status for sidebar badges
    const statusCounts = await SupportTicket.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const counts = Object.fromEntries(statusCounts.map((s: { _id: string; count: number }) => [s._id, s.count]))

    return apiSuccess({
      tickets:      (tickets as unknown as Record<string, unknown>[]).map(serializeTicket),
      total,
      page,
      pages:        Math.ceil(total / limit),
      statusCounts: counts,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

function serializeTicket(t: Record<string, unknown>) {
  return {
    _id:             String(t._id),
    userId:          String(t.userId),
    lifeFlowId:      t.lifeFlowId,
    userName:        t.userName,
    subject:         t.subject,
    category:        t.category,
    priority:        t.priority,
    description:     t.description,
    status:          t.status,
    assignedTo:      t.assignedTo ?? null,
    assignedToName:  t.assignedToName ?? null,
    lastMessageAt:   t.lastMessageAt ? new Date(t.lastMessageAt as Date).toISOString() : null,
    adminUnreadCount:t.adminUnreadCount ?? 0,
    userUnreadCount: t.userUnreadCount  ?? 0,
    messageCount:    t.messageCount     ?? 0,
    createdAt:       new Date(t.createdAt as Date).toISOString(),
    updatedAt:       new Date(t.updatedAt as Date).toISOString(),
  }
}
