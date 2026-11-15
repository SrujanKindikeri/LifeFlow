/**
 * POST /api/support/presence/heartbeat
 *
 * Called by the client every HEARTBEAT_INTERVAL_MS (20 s) to keep the
 * server-side presence lease alive. If no heartbeat is received within
 * LEASE_TTL_MS (45 s), the participant is marked offline.
 *
 * Body: { ticketId: string }
 *
 * Auth: user session OR admin session. The route checks both and picks
 * whichever is valid. The role is inferred from the query param: ?role=admin.
 *
 * SECURITY
 * ────────
 * The ticketId is validated against the user's ownership (or admin auth).
 * A user cannot heartbeat a ticket they don't own.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth }               from '@/lib/session'
import { requireAdmin }              from '@/lib/admin-auth'
import { heartbeat, registerPresence, broadcastToTicket, getPresence } from '@/lib/support/presence'
import { connectDB }                 from '@/lib/db'
import SupportTicket                 from '@/models/SupportTicket'
import { badRequest, apiSuccess, forbidden } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const role = req.nextUrl.searchParams.get('role') ?? 'user'

  let participantId:   string
  let participantName: string

  try {
    if (role === 'admin') {
      const admin = await requireAdmin()
      participantId   = admin.adminId
      participantName = admin.name
    } else {
      const auth = await requireAuth({ skipActivityUpdate: true })
      participantId   = auth.userId
      participantName = auth.name
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return badRequest('Invalid JSON') }

  const ticketId = typeof body.ticketId === 'string' ? body.ticketId.trim() : ''
  if (!ticketId) return badRequest('ticketId is required')

  // For user role: verify ticket ownership
  if (role !== 'admin') {
    try {
      await connectDB()
      const ticket = await SupportTicket.findById(ticketId).select('userId').lean()
      if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (ticket.userId.toString() !== participantId) return forbidden('Access denied')
    } catch {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
  }

  // Refresh existing lease — if the lease doesn't exist (reconnection after
  // stale sweep), re-register it so the participant becomes online again.
  const found = heartbeat(ticketId, role === 'admin' ? 'admin' : 'user', participantId)

  if (!found) {
    // Lease was evicted — re-register
    registerPresence(ticketId, {
      role: role === 'admin' ? 'admin' : 'user',
      id:   participantId,
      name: participantName,
    })
    const snap = getPresence(ticketId)
    broadcastToTicket(ticketId, 'presence', snap)
  }

  return apiSuccess({ ok: true, ticketId })
}
