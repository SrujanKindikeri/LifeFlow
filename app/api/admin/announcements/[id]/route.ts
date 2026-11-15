/**
 * PATCH  /api/admin/announcements/[id]  — update announcement
 * DELETE /api/admin/announcements/[id]  — delete announcement
 */
import { NextRequest, NextResponse }                  from 'next/server'
import mongoose                                        from 'mongoose'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog, hasRole }                      from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import Announcement                                    from '@/models/Announcement'
import { z }                                           from 'zod'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  title:       z.string().min(1).max(200).trim().optional(),
  body:        z.string().min(1).max(2000).trim().optional(),
  type:        z.enum(['info', 'warning', 'success', 'maintenance']).optional(),
  status:      z.enum(['draft', 'published', 'scheduled', 'expired']).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  expiresAt:   z.string().datetime().optional().nullable(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const actor = await requireAdmin()
    if (!hasRole(actor.role, 'admin')) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, { status: 403 })
    }

    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Announcement not found.' } }, { status: 404 })
    }

    const body   = await req.json().catch(() => ({}))
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } },
        { status: 400 }
      )
    }

    await connectDB()
    const announcement = await Announcement.findById(id)
    if (!announcement) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Announcement not found.' } }, { status: 404 })
    }

    if (parsed.data.title       !== undefined) announcement.title       = parsed.data.title
    if (parsed.data.body        !== undefined) announcement.body        = parsed.data.body
    if (parsed.data.type        !== undefined) announcement.type        = parsed.data.type
    if (parsed.data.status      !== undefined) announcement.status      = parsed.data.status
    if ('scheduledAt' in parsed.data) announcement.scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null
    if ('expiresAt'   in parsed.data) announcement.expiresAt   = parsed.data.expiresAt   ? new Date(parsed.data.expiresAt)   : null

    await announcement.save()

    const action = parsed.data.status === 'published' ? 'announcement_published' : 'announcement_updated'
    await writeAuditLog({ actor, action, result: 'success', target: { type: 'announcement', id }, metadata: parsed.data })

    return NextResponse.json({ ok: true, announcement })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const actor = await requireAdmin()
    if (!hasRole(actor.role, 'admin')) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, { status: 403 })
    }

    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Announcement not found.' } }, { status: 404 })
    }

    await connectDB()
    const deleted = await Announcement.findByIdAndDelete(id)
    if (!deleted) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Announcement not found.' } }, { status: 404 })
    }

    await writeAuditLog({ actor, action: 'announcement_deleted', result: 'success', target: { type: 'announcement', id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
