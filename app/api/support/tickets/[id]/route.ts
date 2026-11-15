/**
 * GET /api/support/tickets/[id]  — get a single ticket (owner-only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { connectDB }                 from '@/lib/db'
import { requireAuth }               from '@/lib/session'
import {
  handleRouteError, apiSuccess, forbidden, notFound,
} from '@/lib/api-response'
import SupportTicket from '@/models/SupportTicket'
import SupportMessage from '@/models/SupportMessage'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth({ skipActivityUpdate: true })
    const { id }     = await params

    await connectDB()

    const ticket = await SupportTicket.findById(id).lean()
    if (!ticket) return notFound('Ticket not found')

    // Ownership check — users can only view their own tickets
    if (ticket.userId.toString() !== userId) {
      return forbidden('Access denied')
    }

    // Fetch messages (oldest first for the thread view)
    const { searchParams } = req.nextUrl
    const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
    const after  = searchParams.get('after') // cursor: last known message _id

    const msgFilter: Record<string, unknown> = { ticketId: ticket._id }
    if (after) {
      // Reconnection: return messages AFTER the last seen message ID
      const mongoose = await import('mongoose')
      if (mongoose.default.Types.ObjectId.isValid(after)) {
        msgFilter._id = { $gt: new mongoose.default.Types.ObjectId(after) }
      }
    }

    const messages = await SupportMessage.find(msgFilter)
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()

    // Mark user-side unread count as zero after viewing
    if (ticket.userUnreadCount > 0) {
      await SupportTicket.updateOne(
        { _id: ticket._id },
        { $set: { userUnreadCount: 0 } }
      )
    }

    return apiSuccess({
      ticket:   serializeTicketFull(ticket as unknown as Record<string, unknown>),
      messages: (messages as unknown as Record<string, unknown>[]).map(serializeMessage),
    })
  } catch (err) {
    return handleRouteError(err, '[support/tickets/[id] GET]')
  }
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeTicketFull(t: Record<string, unknown>) {
  return {
    _id:             String(t._id),
    subject:         t.subject,
    category:        t.category,
    priority:        t.priority,
    description:     t.description,
    status:          t.status,
    assignedTo:      t.assignedTo ?? null,
    assignedToName:  t.assignedToName ?? null,
    statusHistory:   Array.isArray(t.statusHistory) ? t.statusHistory.map((h: Record<string, unknown>) => ({
      from:          h.from ?? null,
      to:            h.to,
      changedByRole: h.changedByRole,
      reason:        h.reason ?? null,
      timestamp:     h.timestamp ? new Date(h.timestamp as Date).toISOString() : null,
    })) : [],
    lastMessageAt:   t.lastMessageAt ? new Date(t.lastMessageAt as Date).toISOString() : null,
    userUnreadCount: t.userUnreadCount ?? 0,
    messageCount:    t.messageCount   ?? 0,
    createdAt:       new Date(t.createdAt as Date).toISOString(),
    updatedAt:       new Date(t.updatedAt as Date).toISOString(),
  }
}

export function serializeMessage(m: Record<string, unknown>) {
  return {
    _id:        String(m._id),
    ticketId:   String(m.ticketId),
    senderId:   m.senderId,
    senderName: m.senderName,
    senderRole: m.senderRole,
    content:    m.content,
    createdAt:  new Date(m.createdAt as Date).toISOString(),
  }
}
