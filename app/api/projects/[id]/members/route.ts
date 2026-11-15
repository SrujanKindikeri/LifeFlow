/**
 * GET  /api/projects/[id]/members     — list all members (owner + accepted)
 * DELETE /api/projects/[id]/members?memberId=<userId>  — owner removes a member
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import ProjectMembership from '@/models/ProjectMembership'
import ProjectInvitation from '@/models/ProjectInvitation'
import User from '@/models/User'
import Activity from '@/models/Activity'
import { resolveProjectAccess, isOwner, isMember } from '@/lib/projectPermissions'
import { createNotificationForUser } from '@/lib/createNotification'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import mongoose from 'mongoose'

// ─── GET — list members ───────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isMember(role)) return forbidden('Access denied')

    const memberships = await ProjectMembership.find({ projectId: id })
      .sort({ joinedAt: 1 })
      .lean()

    // Populate user info
    const userIds = memberships.map((m) => m.userId)
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id publicId name avatar')
      .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string; avatar?: string }[]>()

    const userMap = new Map(users.map((u) => [u._id.toString(), u]))

    const members = memberships.map((m) => {
      const u = userMap.get(m.userId.toString())
      return {
        _id:          m._id.toString(),
        userId:       m.userId.toString(),
        lifeFlowId:   m.lifeFlowId,
        name:         u?.name ?? 'Unknown',
        avatar:       u?.avatar ?? null,
        role:         m.role,
        joinedAt:     m.joinedAt.toISOString(),
      }
    })

    return apiSuccess({ members })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[members GET]')
  }
}

// ─── DELETE — remove a member ─────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, lifeFlowId, name } = await requireAuth()
    const { id } = await params
    const memberId = req.nextUrl.searchParams.get('memberId')

    if (!memberId) return badRequest('memberId query parameter is required')
    if (!mongoose.Types.ObjectId.isValid(memberId)) return badRequest('Invalid memberId')

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isOwner(role)) return forbidden('Only the project owner can remove members')

    // Prevent owner from removing themselves via this endpoint
    if (memberId === userId) return badRequest('The project owner cannot be removed')

    const removed = await ProjectMembership.findOneAndDelete({
      projectId: id,
      userId:    memberId,
      role:      'member', // can only remove regular members, not owners
    })

    if (!removed) return notFound('Member not found')

    // Cancel any pending invitations for this user on this project
    await ProjectInvitation.updateMany(
      { projectId: id, inviteeId: memberId, status: 'pending' },
      { $set: { status: 'cancelled' } },
    )

    // Notify the removed user
    await createNotificationForUser({
      userId:  memberId,
      title:   'Removed from project',
      message: `You have been removed from "${project.title}" by ${name}.`,
      type:    'project',
    })

    // Record in owner's activity
    await Activity.create({
      userId,
      lifeFlowId,
      type:        'project_member_removed',
      referenceId: new mongoose.Types.ObjectId(id),
      title:       `Removed a member from: ${project.title}`,
    })

    return apiSuccess({ message: 'Member removed' })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[members DELETE]')
  }
}
