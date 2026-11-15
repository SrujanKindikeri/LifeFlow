/**
 * GET /api/projects/[id]/members/search?q=<email_or_lifeflowid>
 *
 * Search for a LifeFlow user to invite. Returns ONLY the minimum fields
 * needed to identify a match. Never exposes private user data.
 *
 * Rules:
 * - Only the project owner may search.
 * - Search by exact email (case-insensitive) or publicId prefix.
 * - Returns 0 or 1 result. If the user is already a member or has a
 *   pending invitation, that status is included so the UI can warn.
 * - Rate-limited to prevent email enumeration.
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import ProjectMembership from '@/models/ProjectMembership'
import ProjectInvitation from '@/models/ProjectInvitation'
import { resolveProjectAccess, isOwner } from '@/lib/projectPermissions'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import { checkUserSearchLimit, getClientIp } from '@/lib/auth/rate-limit'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const ip = getClientIp(req)

    // Rate limit
    const rl = checkUserSearchLimit(ip, userId)
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many searches. Please wait.' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const q = req.nextUrl.searchParams.get('q')?.trim()
    if (!q || q.length < 3) return badRequest('Search query must be at least 3 characters')

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isOwner(role)) return forbidden('Only the project owner can search for members')

    // Search by exact email OR exact publicId (case-insensitive for email)
    const isEmail = q.includes('@')
    const userDoc = await User.findOne(
      isEmail
        ? { email: q.toLowerCase(), accountStatus: 'active' }
        : { publicId: q.toUpperCase(), accountStatus: 'active' },
    )
      .select('_id publicId name avatar')
      .lean<{ _id: { toString(): string }; publicId: string; name: string; avatar?: string } | null>()

    if (!userDoc) return apiSuccess({ user: null })

    // Prevent inviting self
    if (userDoc._id.toString() === userId) {
      return apiSuccess({ user: null, reason: 'self' })
    }

    // Check existing membership
    const membership = await ProjectMembership.findOne({
      projectId: id,
      userId: userDoc._id.toString(),
    }).lean()

    if (membership) {
      return apiSuccess({
        user: {
          _id:        userDoc._id.toString(),
          publicId:   userDoc.publicId,
          name:       userDoc.name,
          avatar:     userDoc.avatar ?? null,
        },
        alreadyMember: true,
      })
    }

    // Check pending invitation
    const pending = await ProjectInvitation.findOne({
      projectId: id,
      inviteeId: userDoc._id.toString(),
      status: 'pending',
    }).lean()

    return apiSuccess({
      user: {
        _id:      userDoc._id.toString(),
        publicId: userDoc.publicId,
        name:     userDoc.name,
        avatar:   userDoc.avatar ?? null,
      },
      pendingInvitation: !!pending,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[member-search GET]')
  }
}
