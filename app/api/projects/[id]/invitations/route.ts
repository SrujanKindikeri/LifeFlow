/**
 * GET  /api/projects/[id]/invitations  — list all invitations for a project (owner only)
 * POST /api/projects/[id]/invitations  — send a new invitation
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import ProjectInvitation from '@/models/ProjectInvitation'
import ProjectMembership from '@/models/ProjectMembership'
import Activity from '@/models/Activity'
import User from '@/models/User'
import { resolveProjectAccess, isOwner } from '@/lib/projectPermissions'
import { createNotificationForUser } from '@/lib/createNotification'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { buildProjectInvitationEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import { checkInvitationSendLimit, getClientIp } from '@/lib/auth/rate-limit'
import {
  unauthorized, forbidden, notFound, badRequest, conflict,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import { z } from 'zod'
import logger from '@/lib/logger'

const INVITATION_EXPIRY_DAYS = 7

const sendSchema = z.object({
  inviteeId: z.string().min(1, 'inviteeId is required'),
})

function serializeInvitation(inv: {
  _id: mongoose.Types.ObjectId | { toString(): string }
  projectId: { toString(): string }
  inviterId: { toString(): string }
  inviteeId: { toString(): string }
  status: string
  expiresAt: Date
  respondedAt: Date | null
  createdAt: Date
}) {
  return {
    _id:         inv._id.toString(),
    projectId:   inv.projectId.toString(),
    inviterId:   inv.inviterId.toString(),
    inviteeId:   inv.inviteeId.toString(),
    status:      inv.status,
    expiresAt:   inv.expiresAt.toISOString(),
    respondedAt: inv.respondedAt?.toISOString() ?? null,
    createdAt:   inv.createdAt.toISOString(),
  }
}

// ─── GET — list invitations ───────────────────────────────────────────────────

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
    if (!isOwner(role)) return forbidden('Only the project owner can view invitations')

    const invitations = await ProjectInvitation.find({ projectId: id })
      .sort({ createdAt: -1 })
      .lean()

    // Populate invitee info (name only — minimal PII)
    const inviteeIds = invitations.map((inv) => inv.inviteeId)
    const invitees = await User.find({ _id: { $in: inviteeIds } })
      .select('_id publicId name avatar')
      .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string; avatar?: string }[]>()
    const inviteeMap = new Map(invitees.map((u) => [u._id.toString(), u]))

    const result = invitations.map((inv) => {
      const u = inviteeMap.get(inv.inviteeId.toString())
      return {
        ...serializeInvitation(inv),
        inviteeName:   u?.name ?? 'Unknown',
        inviteeAvatar: u?.avatar ?? null,
        inviteePublicId: u?.publicId ?? null,
      }
    })

    return apiSuccess({ invitations: result })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[invitations GET]')
  }
}

// ─── POST — send invitation ───────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, lifeFlowId, name: inviterName } = await requireAuth()
    const { id } = await params
    const ip = getClientIp(req)

    // Rate limit
    const rl = checkInvitationSendLimit(ip, userId)
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many invitations. Please wait.' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const parsed = sendSchema.safeParse(body)
    if (!parsed.success) return badRequest(parsed.error.issues[0].message)

    const { inviteeId } = parsed.data

    if (!mongoose.Types.ObjectId.isValid(inviteeId)) return badRequest('Invalid inviteeId')

    // Prevent self-invitation
    if (inviteeId === userId) return badRequest('You cannot invite yourself')

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isOwner(role)) return forbidden('Only the project owner can invite members')
    if (!project.collaborationEnabled) {
      return badRequest('Collaboration is not enabled for this project. Enable it in project settings first.')
    }

    // Verify invitee exists
    const invitee = await User.findById(inviteeId)
      .select('_id publicId name email accountStatus')
      .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string; email: string; accountStatus?: string } | null>()

    if (!invitee || (invitee.accountStatus ?? 'active') !== 'active') {
      return notFound('User not found')
    }

    // Check already a member
    const existingMembership = await ProjectMembership.findOne({
      projectId: id, userId: inviteeId,
    }).lean()
    if (existingMembership) return conflict('User is already a member of this project')

    // Expire any stale expired pending invitations (clean state)
    await ProjectInvitation.updateMany(
      {
        projectId: id,
        inviteeId,
        status:    'pending',
        expiresAt: { $lt: new Date() },
      },
      { $set: { status: 'expired' } },
    )

    // Check for live pending invitation
    const existingPending = await ProjectInvitation.findOne({
      projectId: id, inviteeId, status: 'pending',
    }).lean()
    if (existingPending) return conflict('A pending invitation already exists for this user')

    // Generate secure invitation token
    const { token, tokenHash } = generateVerificationToken()
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

    const invitation = await ProjectInvitation.create({
      projectId: new mongoose.Types.ObjectId(id),
      inviterId: new mongoose.Types.ObjectId(userId),
      inviteeId: new mongoose.Types.ObjectId(inviteeId),
      status:    'pending',
      tokenHash,
      expiresAt,
    })

    // Build accept / decline URLs (sign-in required first)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const acceptUrl  = `${appUrl}/app/invitations?token=${token}&action=accept`
    const declineUrl = `${appUrl}/app/invitations?token=${token}&action=decline`

    // Send invitation email (non-fatal)
    let emailSent = false
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildProjectInvitationEmail({
        toName:             invitee.name,
        inviterName,
        projectName:        project.title,
        projectDescription: project.description,
        acceptUrl,
        declineUrl,
        appUrl,
        expiresInLabel:     `${INVITATION_EXPIRY_DAYS} days`,
      })
      const result = await notifier.send({
        to:      invitee.email,
        subject,
        html,
        text,
      })
      emailSent = result.ok
      if (!result.ok) {
        logger.warn('[invitations POST] Email delivery failed', {
          invitationId: invitation._id.toString(),
          error: result.error,
        })
      }
    } catch (emailErr) {
      logger.error('[invitations POST] Email sending threw', {
        invitationId: invitation._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    // Create in-app notification for invitee
    await createNotificationForUser({
      userId:  inviteeId,
      title:   'Project invitation',
      message: `${inviterName} invited you to collaborate on "${project.title}".`,
      type:    'project',
    })

    // Record in owner's activity
    await Activity.create({
      userId,
      lifeFlowId,
      type:        'project_invitation_sent',
      referenceId: new mongoose.Types.ObjectId(id),
      title:       `Invited ${invitee.name} to: ${project.title}`,
    })

    return apiSuccess({
      invitation: serializeInvitation(invitation),
      emailSent,
    }, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[invitations POST]')
  }
}
