/**
 * GET /api/support/tickets/[id]/stream — Server-Sent Events stream for real-time chat.
 *
 * DESIGN
 * ──────
 * SSE was chosen over WebSockets because:
 * - It works natively with Next.js Route Handlers using a ReadableStream.
 * - Connections are unidirectional (server → client); messages from the client
 *   are sent via the normal POST /messages endpoint (HTTP + persist-first).
 * - Automatic browser reconnection (EventSource retry semantics).
 * - No additional infrastructure (no ws server, no Pusher, no Redis pub/sub).
 * - Suitable for a single-process deployment on EC2/Azure VM.
 *
 * AUTHENTICATION
 * ──────────────
 * The route calls requireAuth() for user streams. The stream is only opened
 * after the session is verified AND the ticket ownership is confirmed.
 * Admin streams use requireAdmin() instead — the client passes ?role=admin.
 *
 * EVENTS SENT
 * ───────────
 *   connect   — { ticketId, presenceSnapshot }  (sent once on connect)
 *   message   — serialized SupportMessage (new message in thread)
 *   presence  — { userOnline, adminOnline, onlineAdminNames }
 *   status    — { status: TicketStatus }
 *   ping      — {} (keepalive every 25 s)
 *
 * RECONNECTION
 * ─────────────
 * On reconnect the client should call GET /api/support/tickets/[id]?after=<lastMsgId>
 * to load any missed messages. The SSE stream itself does not replay history.
 *
 * PRESENCE LIFECYCLE
 * ──────────────────
 * 1. On connect: register lease, broadcast presence update.
 * 2. On disconnect (AbortSignal fires): deregister lease, broadcast presence update.
 * 3. Heartbeats via POST /api/support/presence/heartbeat keep leases alive.
 * 4. The presence sweeper (in lib/support/presence.ts) removes stale leases.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB }                  from '@/lib/db'
import { requireAuth }                from '@/lib/session'
import { requireAdmin }               from '@/lib/admin-auth'
import {
  registerSseChannel,
  unregisterSseChannel,
  registerPresence,
  deregisterPresence,
  getPresence,
  broadcastToTicket,
} from '@/lib/support/presence'
import SupportTicket from '@/models/SupportTicket'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: ticketId } = await params
  const role = req.nextUrl.searchParams.get('role') ?? 'user'

  // ── Authenticate ────────────────────────────────────────────────────────────
  let participantId: string
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

  // ── Ticket access check ─────────────────────────────────────────────────────
  try {
    await connectDB()
    const ticket = await SupportTicket.findById(ticketId).select('userId status').lean()
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    // Users can only stream their own tickets
    if (role === 'user' && ticket.userId.toString() !== participantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // ── Create SSE ReadableStream ───────────────────────────────────────────────
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(data))
        } catch {
          // Stream already closed — ignore
        }
      }

      // Register this stream as a broadcast target
      registerSseChannel(ticketId, send)

      // Register presence lease
      registerPresence(ticketId, {
        role: role === 'admin' ? 'admin' : 'user',
        id:   participantId,
        name: participantName,
      })

      // Broadcast updated presence to everyone on this ticket
      const presenceSnap = getPresence(ticketId)
      broadcastToTicket(ticketId, 'presence', presenceSnap)

      // Send initial 'connect' event with current presence
      send(`event: connect\ndata: ${JSON.stringify({ ticketId, presence: presenceSnap })}\n\n`)

      // Keepalive ping every 25 seconds
      const pingTimer = setInterval(() => {
        send(`event: ping\ndata: {}\n\n`)
      }, 25_000)

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        clearInterval(pingTimer)
        unregisterSseChannel(ticketId, send)
        deregisterPresence(ticketId, role === 'admin' ? 'admin' : 'user', participantId)
        // Broadcast presence update after this participant leaves
        const updatedPresence = getPresence(ticketId)
        broadcastToTicket(ticketId, 'presence', updatedPresence)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',  // disable Nginx buffering if behind a proxy
    },
  })
}
