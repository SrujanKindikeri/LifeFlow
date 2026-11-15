/**
 * GET /api/invitations
 *
 * Returns all invitations for the authenticated user — pending, accepted,
 * declined — to populate the Invitations inbox UI.
 *
 * Automatically marks any pending-but-expired invitations as expired.
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import ProjectInvitation from '@/models/ProjectInvitation'
import Project from '@/models/Project'
import User from '@/models/User'
import {
  unauthorized, apiSuccess, handleRouteError,
} from '@/lib/api-response'

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    // Mark expired pending invitations
    await ProjectInvitation.updateMany(
      { inviteeId: userId, status: 'pending', expiresAt: { $lt: new Date() } },
      { $set: { status: 'expired' } },
    )

    const invitations = await ProjectInvitation.find({ inviteeId: userId })
      .sort({ createdAt: -1 })
      .lean()

    if (invitations.length === 0) return apiSuccess({ invitations: [] })

    const projectIds = [...new Set(invitations.map((i) => i.projectId.toString()))]
    const inviterIds = [...new Set(invitations.map((i) => i.inviterId.toString()))]

    const [projects, inviters] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .select('_id title description color status')
        .lean<{ _id: mongoose.Types.ObjectId; title: string; description?: string; color?: string; status: string }[]>(),
      User.find({ _id: { $in: inviterIds } })
        .select('_id publicId name avatar')
        .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string; avatar?: string }[]>(),
    ])

    const projectMap = new Map(projects.map((p) => [p._id.toString(), p]))
    const inviterMap = new Map(inviters.map((u) => [u._id.toString(), u]))

    const result = invitations.map((inv) => {
      const project = projectMap.get(inv.projectId.toString())
      const inviter = inviterMap.get(inv.inviterId.toString())
      return {
        _id:                inv._id.toString(),
        status:             inv.status,
        expiresAt:          inv.expiresAt.toISOString(),
        respondedAt:        inv.respondedAt?.toISOString() ?? null,
        createdAt:          inv.createdAt.toISOString(),
        project: project ? {
          _id:         project._id.toString(),
          title:       project.title,
          description: project.description ?? null,
          color:       project.color ?? '#3b82f6',
          status:      project.status,
        } : null,
        inviter: inviter ? {
          _id:       inviter._id.toString(),
          publicId:  inviter.publicId,
          name:      inviter.name,
          avatar:    inviter.avatar ?? null,
        } : null,
      }
    })

    return apiSuccess({ invitations: result })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[invitations GET]')
  }
}
