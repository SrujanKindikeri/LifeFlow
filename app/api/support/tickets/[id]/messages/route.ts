/**
 * POST /api/support/tickets/[id]/messages — send a message in a ticket thread
 *
 * Rules:
 * - User must own the ticket.
 * - Ticket must not be closed (users cannot message on closed tickets).
 * - Message content is validated server-side.
 * - clientMsgId provides idempotency on retry — duplicate sends are silently
 *   deduplicated and the existing message is returned.
 * - After persisting, advances ticket status and broadcasts via SSE.
 */
import { NextRequest, NextResponse }   from 'next/server'
import { connectDB }                   from '@/lib/db'
import { requireAuth }                 from '@/lib/session'
import {
  handleRouteError, apiSuccess, forbidden, notFound, badRequest, apiError,
} from '@/lib/api-response'
import { checkMessageSendLimit, getClientIp } from '@/lib/auth/rate-limit'
import { broadcastToTicket }                  from '@/lib/support/presence'
import SupportTicket                          from '@/models/SupportTicket'
import SupportMessage                         from '@/models/SupportMessage'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth     = await requireAuth()
    const { userId, name: senderName } = auth
    const { id }   = await params
    const ip       = getClientIp(req)

    // Rate limit
    const rl = checkMessageSendLimit(ip, userId, id)
    if (!rl.allowed) {
      return apiError('RATE_LIMITED', 'Sending too fast. Please wait a moment.', 429)
    }

    // Parse body
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return badRequest('Invalid JSON') }

    const content     = typeof body.content     === 'string' ? body.content.trim()     : ''
    const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId.trim() : null

    if (!content || content.length < 1)     return badRequest('Message cannot be empty')
    if (content.length > 4000)               return badRequest('Message exceeds 4000 characters')

    // Validate clientMsgId format if provided (must be UUID-like, 36 chars max)
    if (clientMsgId && clientMsgId.length > 64) return badRequest('Invalid clientMsgId')

    await connectDB()

    const ticket = await SupportTicket.findById(id)
    if (!ticket) return notFound('Ticket not found')

    // Ownership
    if (ticket.userId.toString() !== userId) return forbidden('Access denied')

    // Closed tickets cannot receive user messages
    if (ticket.status === 'closed') {
      return apiError('FORBIDDEN', 'This ticket is closed and cannot receive new messages.', 403)
    }

    // Idempotency check — if clientMsgId already exists, return existing message
    if (clientMsgId) {
      const existing = await SupportMessage.findOne({ clientMsgId }).lean()
      if (existing) {
        return apiSuccess({ message: serializeMessage(existing as unknown as Record<string, unknown>), duplicate: true })
      }
    }

    // Persist message — server-generated timestamp
    const msgDoc = await SupportMessage.create({
      ticketId: ticket._id,
      senderId: userId,
      senderName,
      senderRole: 'user',
      content,
      clientMsgId: clientMsgId ?? null,
    })
    const message = msgDoc.toObject() as unknown as Record<string, unknown>

    // Advance ticket status: if it was resolved, reopen to waiting_for_admin
    // If it was waiting_for_user or open, move to waiting_for_admin
    const prevStatus = ticket.status
    let newStatus = ticket.status
    if (ticket.status === 'waiting_for_user' || ticket.status === 'open') {
      newStatus = 'waiting_for_admin'
    } else if (ticket.status === 'resolved') {
      newStatus = 'waiting_for_admin'
    }

    const now = new Date()
    const updatePayload: Record<string, unknown> = {
      lastMessageAt: now,
      $inc: { messageCount: 1, adminUnreadCount: 1 },
    }
    if (newStatus !== prevStatus) {
      updatePayload.status = newStatus
      updatePayload.$push = {
        statusHistory: {
          from: prevStatus, to: newStatus,
          changedBy: userId, changedByRole: 'user',
          reason: 'User sent message',
          timestamp: now,
        },
      }
    }

    await SupportTicket.updateOne({ _id: ticket._id }, updatePayload)

    // Broadcast to SSE streams
    const serialized = serializeMessage(message)
    broadcastToTicket(id, 'message', serialized)
    if (newStatus !== prevStatus) {
      broadcastToTicket(id, 'status', { status: newStatus })
    }

    return apiSuccess({ message: serialized }, 201)
  } catch (err) {
    return handleRouteError(err, '[support/tickets/[id]/messages POST]')
  }
}

function serializeMessage(m: Record<string, unknown>) {
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
