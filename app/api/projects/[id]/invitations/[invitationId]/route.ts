/**
 * DELETE /api/projects/[id]/invitations/[invitationId]  — owner cancels invitation
 * POST   /api/projects/[id]/invitations/[invitationId]/resend is handled separately
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import ProjectInvitation from '@/models/ProjectInvitation'
import { resolveProjectAccess, isOwner } from '@/lib/projectPermissions'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  try {
    const { userId } = await requireAuth()
    const { id, invitationId } = await params

    if (!mongoose.Types.ObjectId.isValid(invitationId)) return badRequest('Invalid invitationId')

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isOwner(role)) return forbidden('Only the project owner can cancel invitations')

    const invitation = await ProjectInvitation.findOne({
      _id:       invitationId,
      projectId: id,
    })

    if (!invitation) return notFound('Invitation not found')
    if (invitation.status !== 'pending') {
      return badRequest(`Cannot cancel an invitation with status "${invitation.status}"`)
    }

    invitation.status    = 'cancelled'
    invitation.tokenHash = null       // invalidate the token immediately
    await invitation.save()

    return apiSuccess({ message: 'Invitation cancelled' })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[invitation DELETE]')
  }
}
