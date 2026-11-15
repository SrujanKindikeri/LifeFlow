/**
 * GET  /api/projects/[id]/messages          — list messages (paginated, newest-first)
 * POST /api/projects/[id]/messages          — send a message
 *
 * Auth: accepted project members + owner only.
 * Pagination: cursor-based via ?before=<messageId> or ?limit=<n> (max 50).
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import ProjectMessage from '@/models/ProjectMessage'
import { resolveProjectAccess, isMember } from '@/lib/projectPermissions'
import { createNotificationForUser } from '@/lib/createNotification'
import ProjectMembership from '@/models/ProjectMembership'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import { checkChatMessageLimit, getClientIp } from '@/lib/auth/rate-limit'
import { z } from 'zod'

const PAGE_LIMIT = 50

const sendSchema = z.object({
  text:           z.string().min(1, 'Message cannot be empty').max(4000),
  idempotencyKey: z.string().uuid('idempotencyKey must be a UUID'),
})

function serializeMessage(m: {
  _id: { toString(): string }
  projectId: { toString(): string }
  senderId: { toString(): string }
  senderName: string
  senderLifeFlowId: string
  text: string
  deleted: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    _id:              m._id.toString(),
    projectId:        m.projectId.toString(),
    senderId:         m.senderId.toString(),
    senderName:       m.senderName,
    senderLifeFlowId: m.senderLifeFlowId,
    text:             m.deleted ? null : m.text,  // null for deleted messages
    deleted:          m.deleted,
    createdAt:        m.createdAt.toISOString(),
    updatedAt:        m.updatedAt.toISOString(),
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth({ skipActivityUpdate: true })
    const { id } = await params

    await connectDB()
    const { role } = await resolveProjectAccess(id, userId)

    if (!isMember(role)) return forbidden('Access denied')

    const limit  = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '30', 10), PAGE_LIMIT)
    const before = req.nextUrl.searchParams.get('before')

    const query: Record<string, unknown> = { projectId: id }
    if (before && mongoose.Types.ObjectId.isValid(before)) {
      const anchor = await ProjectMessage.findById(before).select('createdAt').lean<{ createdAt: Date } | null>()
      if (anchor) {
        query.createdAt = { $lt: anchor.createdAt }
      }
    }

    const messages = await ProjectMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    // Return in ascending order for the UI (chronological)
    const sorted = [...messages].reverse()

    return apiSuccess({
      messages: sorted.map(serializeMessage),
      hasMore:  messages.length === limit,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[messages GET]')
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, lifeFlowId, name } = await requireAuth()
    const { id } = await params
    const ip = getClientIp(req)

    // Rate limit
    const rl = checkChatMessageLimit(ip, userId, id)
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Sending too fast. Please wait.' } }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const parsed = sendSchema.safeParse(body)
    if (!parsed.success) return badRequest(parsed.error.issues[0].message)

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isMember(role)) return forbidden('Access denied')

    const { text, idempotencyKey } = parsed.data

    // Idempotent send — return existing message if key matches
    const existing = await ProjectMessage.findOne({ projectId: id, idempotencyKey }).lean()
    if (existing) {
      return apiSuccess({ message: serializeMessage(existing), duplicate: true }, 200)
    }

    let message
    try {
      message = await ProjectMessage.create({
        projectId:        new mongoose.Types.ObjectId(id),
        senderId:         new mongoose.Types.ObjectId(userId),
        senderName:       name,
        senderLifeFlowId: lifeFlowId,
        text,
        idempotencyKey,
      })
    } catch (createErr) {
      // Duplicate idempotency key (race)
      const code = (createErr as { code?: number })?.code
      if (code === 11000) {
        const dup = await ProjectMessage.findOne({ projectId: id, idempotencyKey }).lean()
        if (dup) return apiSuccess({ message: serializeMessage(dup), duplicate: true }, 200)
      }
      throw createErr
    }

    // Notify other members about new message (non-fatal, fire-and-forget)
    // Only notify if sender is not the sole member
    setImmediate(async () => {
      try {
        const memberships = await ProjectMembership.find({ projectId: id })
          .select('userId')
          .lean<{ userId: { toString(): string } }[]>()

        const otherIds = memberships
          .map((m) => m.userId.toString())
          .filter((uid) => uid !== userId)

        // Also include project owner if they are not in memberships (they won't be — owner record is separate)
        if (project.userId.toString() !== userId) {
          otherIds.push(project.userId.toString())
        }

        const uniqueIds = [...new Set(otherIds)]
        await Promise.all(
          uniqueIds.map((uid) =>
            createNotificationForUser({
              userId:  uid,
              title:   `New message in "${project.title}"`,
              message: `${name}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
              type:    'project',
            }),
          ),
        )
      } catch {
        // swallow — notification failure must not affect the send response
      }
    })

    return apiSuccess({ message: serializeMessage(message) }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[messages POST]')
  }
}
