/**
 * POST /api/projects/[id]/invitations/[invitationId]/resend
 *
 * Owner resends the email for a pending invitation.
 * Rotates the token to prevent replay of the old link.
 * Rate-limited via the invitation send limiter.
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import ProjectInvitation from '@/models/ProjectInvitation'
import User from '@/models/User'
import { resolveProjectAccess, isOwner } from '@/lib/projectPermissions'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { buildProjectInvitationEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import { checkInvitationSendLimit, getClientIp } from '@/lib/auth/rate-limit'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import logger from '@/lib/logger'

const INVITATION_EXPIRY_DAYS = 7

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  try {
    const { userId, name: inviterName } = await requireAuth()
    const { id, invitationId } = await params
    const ip = getClientIp(req)

    if (!mongoose.Types.ObjectId.isValid(invitationId)) return badRequest('Invalid invitationId')

    const rl = checkInvitationSendLimit(ip, userId)
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many resends. Please wait.' } }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      })
    }

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isOwner(role)) return forbidden('Only the project owner can resend invitations')

    const invitation = await ProjectInvitation.findOne({ _id: invitationId, projectId: id })
    if (!invitation) return notFound('Invitation not found')
    if (invitation.status !== 'pending') {
      return badRequest(`Cannot resend an invitation with status "${invitation.status}"`)
    }

    // Rotate token and extend expiry
    const { token, tokenHash } = generateVerificationToken()
    const newExpiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    invitation.tokenHash = tokenHash
    invitation.expiresAt = newExpiresAt
    await invitation.save()

    // Fetch invitee
    const invitee = await User.findById(invitation.inviteeId)
      .select('name email accountStatus')
      .lean<{ name: string; email: string; accountStatus?: string } | null>()

    if (!invitee || (invitee.accountStatus ?? 'active') !== 'active') {
      return notFound('Invitee account not found')
    }

    const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const acceptUrl  = `${appUrl}/app/invitations?token=${token}&action=accept`
    const declineUrl = `${appUrl}/app/invitations?token=${token}&action=decline`

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

    const result = await notifier.send({ to: invitee.email, subject, html, text })

    if (!result.ok) {
      logger.warn('[invitation-resend POST] Email delivery failed', {
        invitationId, error: result.error,
      })
      return apiSuccess({ emailSent: false, message: 'Email delivery failed. You can retry.' })
    }

    return apiSuccess({ emailSent: true, message: 'Invitation email resent' })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[invitation-resend POST]')
  }
}
