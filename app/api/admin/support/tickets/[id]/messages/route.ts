/**
 * POST /api/admin/support/tickets/[id]/messages — admin sends a reply
 *
 * - Requires admin session with role >= support.
 * - Persists the message before broadcasting.
 * - Advances ticket status to waiting_for_user.
 * - Creates an in-app notification for the user.
 * - Sends an email reply notification to the user.
 * - Broadcasts via SSE to all active streams on the ticket.
 */
import { NextRequest, NextResponse }                     from 'next/server'
import { requireRole, handleAdminAuthError }             from '@/lib/admin-auth'
import { connectDB }                                     from '@/lib/db'
import { apiSuccess, notFound, badRequest, apiError }    from '@/lib/api-response'
import { checkMessageSendLimit, getClientIp }            from '@/lib/auth/rate-limit'
import { broadcastToTicket }                             from '@/lib/support/presence'
import { sendAdminReplyEmailToUser }                     from '@/lib/support/email'
import SupportTicket                                     from '@/models/SupportTicket'
import SupportMessage                                    from '@/models/SupportMessage'
import Notification                                      from '@/models/Notification'
import User                                              from '@/models/User'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // Support role or above can reply
    const admin  = await requireRole('support')
    const { id } = await params
    const ip     = getClientIp(req)

    // Rate limit (admin side)
    const rl = checkMessageSendLimit(ip, admin.adminId, id)
    if (!rl.allowed) {
      return apiError('RATE_LIMITED', 'Sending too fast.', 429)
    }

    let body: Record<string, unknown>
    try { body = await req.json() } catch { return badRequest('Invalid JSON') }

    const content     = typeof body.content     === 'string' ? body.content.trim()     : ''
    const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId.trim() : null

    if (!content)           return badRequest('Message cannot be empty')
    if (content.length > 4000) return badRequest('Message exceeds 4000 characters')
    if (clientMsgId && clientMsgId.length > 64) return badRequest('Invalid clientMsgId')

    await connectDB()

    const ticket = await SupportTicket.findById(id)
    if (!ticket) return notFound('Ticket not found')

    if (ticket.status === 'closed') {
      return apiError('FORBIDDEN', 'This ticket is closed.', 403)
    }

    // Idempotency check
    if (clientMsgId) {
      const existing = await SupportMessage.findOne({ clientMsgId }).lean()
      if (existing) {
        return apiSuccess({ message: serializeMessage(existing as unknown as Record<string, unknown>), duplicate: true })
      }
    }

    // Persist message
    const msgDoc = await SupportMessage.create({
      ticketId:   ticket._id,
      senderId:   admin.adminId,
      senderName: admin.name,
      senderRole: 'admin',
      content,
      clientMsgId: clientMsgId ?? null,
    })
    const message = msgDoc.toObject() as unknown as Record<string, unknown>

    const prevStatus = ticket.status
    const newStatus  = 'waiting_for_user'
    const now        = new Date()

    const updatePayload: Record<string, unknown> = {
      lastMessageAt: now,
      // Auto-assign to this admin if not yet assigned
      ...(ticket.assignedTo == null && {
        assignedTo:     admin.adminId,
        assignedToName: admin.name,
      }),
    }

    const incPayload: Record<string, number> = { messageCount: 1, userUnreadCount: 1 }
    if (newStatus !== prevStatus) {
      updatePayload.status = newStatus
      updatePayload.$push = {
        statusHistory: {
          from: prevStatus, to: newStatus,
          changedBy: admin.adminId, changedByRole: 'admin',
          reason: 'Admin replied',
          timestamp: now,
        },
      }
    }

    await SupportTicket.updateOne(
      { _id: ticket._id },
      { $set: updatePayload, $inc: incPayload }
    )

    const serialized = serializeMessage(message)
    broadcastToTicket(id, 'message', serialized)
    if (newStatus !== prevStatus) {
      broadcastToTicket(id, 'status', { status: newStatus })
    }

    // In-app notification for the user
    void (async () => {
      try {
        await (Notification.create as (doc: unknown) => Promise<unknown>)({
          userId:     ticket.userId,
          lifeFlowId: ticket.lifeFlowId,
          title:      'Support reply received',
          message:    `${admin.name} replied to your ticket: "${ticket.subject}"`,
          type:       'support',
        })
      } catch { /* non-fatal */ }
    })()

    // Email notification to the user (non-fatal)
    void (async () => {
      try {
        const user = await User.findById(ticket.userId).select('email').lean()
        if (user) {
          await sendAdminReplyEmailToUser({
            ticketId:  id,
            subject:   ticket.subject,
            userEmail: user.email,
            userName:  ticket.userName,
            adminName: admin.name,
          })
        }
      } catch { /* non-fatal */ }
    })()

    return apiSuccess({ message: serialized }, 201)
  } catch (err) {
    return handleAdminAuthError(err)
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
