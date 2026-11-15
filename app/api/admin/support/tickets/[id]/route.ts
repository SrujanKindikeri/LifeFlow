/**
 * GET   /api/admin/support/tickets/[id]  — get ticket + messages
 * PATCH /api/admin/support/tickets/[id]  — assign, change status (resolve/close/reopen)
 */
import { NextRequest, NextResponse }                     from 'next/server'
import { requireAdmin, handleAdminAuthError, writeAuditLog } from '@/lib/admin-auth'
import { connectDB }                                     from '@/lib/db'
import { apiSuccess, notFound, badRequest, apiError }    from '@/lib/api-response'
import { broadcastToTicket }                             from '@/lib/support/presence'
import { sendStatusChangeEmailToUser }                   from '@/lib/support/email'
import SupportTicket                                     from '@/models/SupportTicket'
import SupportMessage                                    from '@/models/SupportMessage'
import User                                              from '@/models/User'
import type { TicketStatus }                             from '@/models/SupportTicket'

export const dynamic = 'force-dynamic'

// ── GET — ticket detail + messages ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin()
    const { id } = await params
    await connectDB()

    const ticket = await SupportTicket.findById(id).lean()
    if (!ticket) return notFound('Ticket not found')

    const { searchParams } = req.nextUrl
    const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '100', 10))
    const after = searchParams.get('after')

    const msgFilter: Record<string, unknown> = { ticketId: ticket._id }
    if (after) {
      const mongoose = await import('mongoose')
      if (mongoose.default.Types.ObjectId.isValid(after)) {
        msgFilter._id = { $gt: new mongoose.default.Types.ObjectId(after) }
      }
    }

    const [messages, user] = await Promise.all([
      SupportMessage.find(msgFilter).sort({ createdAt: 1 }).limit(limit).lean(),
      User.findById(ticket.userId).select('publicId email avatar createdAt').lean(),
    ])

    // Clear admin unread count
    if (ticket.adminUnreadCount > 0) {
      await SupportTicket.updateOne({ _id: ticket._id }, { $set: { adminUnreadCount: 0 } })
    }

    return apiSuccess({
      ticket:   serializeTicketFull(ticket as unknown as Record<string, unknown>),
      messages: (messages as unknown as Record<string, unknown>[]).map(serializeMessage),
      user: user ? {
        lifeFlowId: user.publicId,
        email:      user.email,
        avatar:     user.avatar ?? null,
        memberSince: user.createdAt.toISOString(),
      } : null,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

// ── PATCH — assign / change status ─────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open:               ['waiting_for_admin', 'waiting_for_user', 'resolved', 'closed'],
  waiting_for_admin:  ['waiting_for_user', 'resolved', 'closed'],
  waiting_for_user:   ['waiting_for_admin', 'resolved', 'closed'],
  resolved:           ['open', 'closed'],
  closed:             ['open'],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const admin  = await requireAdmin()
    const { id } = await params

    let body: Record<string, unknown>
    try { body = await req.json() } catch { return badRequest('Invalid JSON') }

    await connectDB()

    const ticket = await SupportTicket.findById(id)
    if (!ticket) return notFound('Ticket not found')

    const updates: Record<string, unknown>  = {}
    const pushUpdates: Record<string, unknown> = {}
    let auditAction: 'ticket_assigned' | 'ticket_resolved' | 'ticket_closed' | 'ticket_reopened' | 'ticket_status_changed' = 'ticket_status_changed'
    let emailNeeded: TicketStatus | null = null

    // ── Assign ───────────────────────────────────────────────────────────────
    if ('assignedTo' in body) {
      const assignTo = body.assignedTo
      if (assignTo === null) {
        updates.assignedTo     = null
        updates.assignedToName = null
      } else if (typeof assignTo === 'string' && assignTo.trim()) {
        // Verify that assignedTo is an active admin
        const { default: AdminUser } = await import('@/models/AdminUser')
        const assignee = await AdminUser.findById(assignTo.trim())
          .select('name isActive role').lean()
        if (!assignee || !assignee.isActive) {
          return badRequest('Assigned admin not found or inactive')
        }
        if (!['super_admin', 'admin', 'support'].includes(assignee.role)) {
          return badRequest('Assigned admin does not have support permissions')
        }
        updates.assignedTo     = assignee._id.toString()
        updates.assignedToName = assignee.name
      } else {
        return badRequest('Invalid assignedTo value')
      }
      auditAction = 'ticket_assigned'
    }

    // ── Status change ─────────────────────────────────────────────────────────
    if ('status' in body && typeof body.status === 'string') {
      const newStatus = body.status as TicketStatus
      const allowed = VALID_TRANSITIONS[ticket.status]
      if (!allowed.includes(newStatus)) {
        return apiError('VALIDATION_ERROR', `Cannot transition from ${ticket.status} to ${newStatus}`, 400)
      }

      const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined

      updates.status = newStatus
      pushUpdates['statusHistory'] = {
        from:          ticket.status,
        to:            newStatus,
        changedBy:     admin.adminId,
        changedByRole: 'admin',
        reason,
        timestamp:     new Date(),
      }

      if (newStatus === 'resolved') { auditAction = 'ticket_resolved'; emailNeeded = 'resolved' }
      if (newStatus === 'closed')   { auditAction = 'ticket_closed';   emailNeeded = 'closed'   }
      if (newStatus === 'open')     { auditAction = 'ticket_reopened'; emailNeeded = 'open'      }
    }

    if (Object.keys(updates).length === 0 && Object.keys(pushUpdates).length === 0) {
      return badRequest('No valid fields to update')
    }

    // Atomic update
    const finalUpdate: Record<string, unknown> = { $set: updates }
    if (Object.keys(pushUpdates).length > 0) finalUpdate.$push = pushUpdates

    await SupportTicket.updateOne({ _id: ticket._id }, finalUpdate)

    // Audit log (non-fatal)
    void writeAuditLog({
      actor:    admin,
      action:   auditAction,
      result:   'success',
      target:   { type: 'ticket', id: id },
      metadata: { newStatus: updates.status ?? ticket.status, assignedTo: updates.assignedTo },
    })

    // Broadcast status change via SSE
    if (updates.status) {
      broadcastToTicket(id, 'status', { status: updates.status })
    }

    // Send email notification to user (non-fatal, fire-and-forget after save)
    if (emailNeeded) {
      const freshTicket = await SupportTicket.findById(id).lean()
      if (freshTicket) {
        const user = await User.findById(freshTicket.userId).select('email').lean()
        if (user) {
          void sendStatusChangeEmailToUser({
            ticketId:  id,
            subject:   freshTicket.subject,
            userEmail: user.email,
            userName:  freshTicket.userName,
            newStatus: emailNeeded,
            adminName: admin.name,
          })
        }
      }
    }

    return apiSuccess({ ok: true })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeTicketFull(t: Record<string, unknown>) {
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
    assignedTo:      t.assignedTo   ?? null,
    assignedToName:  t.assignedToName ?? null,
    statusHistory:   Array.isArray(t.statusHistory) ? t.statusHistory.map((h: Record<string, unknown>) => ({
      from: h.from ?? null, to: h.to,
      changedByRole: h.changedByRole,
      reason: h.reason ?? null,
      timestamp: h.timestamp ? new Date(h.timestamp as Date).toISOString() : null,
    })) : [],
    lastMessageAt:   t.lastMessageAt ? new Date(t.lastMessageAt as Date).toISOString() : null,
    adminUnreadCount: t.adminUnreadCount ?? 0,
    userUnreadCount:  t.userUnreadCount  ?? 0,
    messageCount:     t.messageCount     ?? 0,
    createdAt:        new Date(t.createdAt as Date).toISOString(),
    updatedAt:        new Date(t.updatedAt as Date).toISOString(),
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
