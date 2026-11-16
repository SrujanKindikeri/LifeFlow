/**
 * POST /api/invitations/respond
 *
 * Accept or decline an invitation. Can be called:
 *   1. Via token (from email link): body { token, action }
 *   2. Via invitationId (from in-app UI): body { invitationId, action }
 *
 * In both cases the authenticated user MUST be the invitee.
 * Atomic: uses findOneAndUpdate + a separate membership create in a
 * try/catch with duplicate-key protection.
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import ProjectInvitation from '@/models/ProjectInvitation'
import ProjectMembership from '@/models/ProjectMembership'
import Project from '@/models/Project'
import Activity from '@/models/Activity'
import { hashToken } from '@/lib/auth/crypto'
import { createNotificationForUser } from '@/lib/createNotification'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import { z } from 'zod'
import logger from '@/lib/logger'

const respondSchema = z.union([
  z.object({ token: z.string().min(1), action: z.enum(['accept', 'decline']) }),
  z.object({ invitationId: z.string().min(1), action: z.enum(['accept', 'decline']) }),
])

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId, name: responderName } = await requireAuth()
    const body = await req.json()

    const parsed = respondSchema.safeParse(body)
    if (!parsed.success) return badRequest(parsed.error.issues[0].message)

    await connectDB()

    // Resolve invitation
    let invitation: Awaited<ReturnType<typeof ProjectInvitation.findOne>>

    if ('token' in parsed.data) {
      const tokenHash = hashToken(parsed.data.token)
      if (!tokenHash) return badRequest('Invalid token')
      invitation = await ProjectInvitation.findOne({ tokenHash })
    } else {
      if (!mongoose.Types.ObjectId.isValid(parsed.data.invitationId)) {
        return badRequest('Invalid invitationId')
      }
      invitation = await ProjectInvitation.findById(parsed.data.invitationId)
    }

    if (!invitation) return notFound('Invitation not found')

    // Security: authenticated user MUST be the invitee
    if (invitation.inviteeId.toString() !== userId) {
      return forbidden('This invitation is not for your account')
    }

    // Check status
    if (invitation.status !== 'pending') {
      return badRequest(`Invitation is already ${invitation.status}`)
    }

    // Check expiry
    if (invitation.expiresAt < new Date()) {
      invitation.status = 'expired'
      invitation.tokenHash = null
      await invitation.save()
      return badRequest('This invitation has expired')
    }

    const { action } = parsed.data

    if (action === 'decline') {
      invitation.status      = 'declined'
      invitation.tokenHash   = null
      invitation.respondedAt = new Date()
      await invitation.save()

      // Notify owner
      const project = await Project.findById(invitation.projectId).select('title userId lifeFlowId').lean<{
        title: string; userId: { toString(): string }; lifeFlowId: string
      } | null>()

      if (project) {
        await createNotificationForUser({
          userId:  project.userId.toString(),
          title:   'Invitation declined',
          message: `${responderName} declined your invitation to "${project.title}".`,
          type:    'project',
        })
        // Record in invitee's activity
        await Activity.create({
          userId,
          lifeFlowId,
          type:        'project_invitation_declined',
          referenceId: invitation.projectId,
          title:       `Declined invitation to: ${project.title}`,
        })
      }

      return apiSuccess({ message: 'Invitation declined' })
    }

    // ── Accept ─────────────────────────────────────────────────────────────
    // Check project still exists and collaboration is still enabled
    const project = await Project.findById(invitation.projectId)
      .select('title userId lifeFlowId collaborationEnabled')
      .lean<{
        _id: mongoose.Types.ObjectId
        title: string
        userId: { toString(): string }
        lifeFlowId: string
        collaborationEnabled: boolean
      } | null>()

    if (!project) return notFound('Project no longer exists')

    // Check not already a member (idempotency)
    const existingMembership = await ProjectMembership.findOne({
      projectId: invitation.projectId,
      userId,
    }).lean()

    if (existingMembership) {
      // Already a member — still mark invitation accepted (idempotent)
      if (invitation.status === 'pending') {
        invitation.status      = 'accepted'
        invitation.tokenHash   = null
        invitation.respondedAt = new Date()
        await invitation.save()
      }
      return apiSuccess({ message: 'Already a member', alreadyMember: true })
    }

    // Atomically update invitation status
    const updated = await ProjectInvitation.findOneAndUpdate(
      { _id: invitation._id, status: 'pending' },
      {
        $set: {
          status:      'accepted',
          tokenHash:   null,
          respondedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    )

    if (!updated) {
      // Concurrent acceptance — safe to return already-accepted
      return badRequest('Invitation was already responded to by another request')
    }

    // Create membership (unique index prevents duplicate)
    let membershipCreated = false
    try {
      await ProjectMembership.create({
        projectId:    invitation.projectId,
        userId,
        lifeFlowId,
        role:         'member',
        invitationId: invitation._id,
      })
      membershipCreated = true
    } catch (createErr) {
      // Duplicate key — membership already exists (race condition), safe to continue
      const code = (createErr as { code?: number })?.code
      if (code !== 11000) throw createErr
      logger.info('[invitations-respond] Duplicate membership on accept (race)', { userId, projectId: invitation.projectId.toString() })
    }

    // Notify project owner
    await createNotificationForUser({
      userId:  project.userId.toString(),
      title:   'Invitation accepted',
      message: `${responderName} accepted your invitation to "${project.title}".`,
      type:    'project',
    })

    // Record in both users' activities
    await Promise.all([
      Activity.create({
        userId,
        lifeFlowId,
        type:        'project_invitation_accepted',
        referenceId: invitation.projectId,
        title:       `Joined project: ${project.title}`,
      }),
      Activity.create({
        userId:      project.userId.toString(),
        lifeFlowId:  project.lifeFlowId,
        type:        'project_member_joined',
        referenceId: invitation.projectId,
        title:       `${responderName} joined: ${project.title}`,
      }),
    ])

    return apiSuccess({
      message: 'Invitation accepted',
      membershipCreated,
      projectId: invitation.projectId.toString(),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[invitations-respond POST]')
  }
}
