/**
 * PATCH /api/projects/[id]/collaboration
 * Toggle collaborationEnabled for a project.
 * Only the project owner may call this.
 *
 * Body: { enabled: boolean }
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import Project from '@/models/Project'
import { resolveProjectAccess, isOwner } from '@/lib/projectPermissions'
import {
  unauthorized, forbidden, notFound, badRequest,
  apiSuccess, handleRouteError,
} from '@/lib/api-response'
import { z } from 'zod'

const schema = z.object({
  enabled: z.boolean(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return badRequest(parsed.error.issues[0].message)

    await connectDB()
    const { role, project } = await resolveProjectAccess(id, userId)

    if (!project) return notFound('Project not found')
    if (!isOwner(role)) return forbidden('Only the project owner can change collaboration settings')

    const updated = await Project.findByIdAndUpdate(
      id,
      { $set: { collaborationEnabled: parsed.data.enabled } },
      { returnDocument: 'after' },
    ).lean()

    if (!updated) return notFound('Project not found')

    return apiSuccess({
      collaborationEnabled: (updated as { collaborationEnabled: boolean }).collaborationEnabled,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return handleRouteError(err, '[collaboration PATCH]')
  }
}
