/**
 * GET  /api/admin/announcements  — list announcements
 * POST /api/admin/announcements  — create announcement
 */
import { NextRequest, NextResponse }                  from 'next/server'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog, hasRole }                      from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import Announcement                                    from '@/models/Announcement'
import { z }                                           from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  title:       z.string().min(1).max(200).trim(),
  body:        z.string().min(1).max(2000).trim(),
  type:        z.enum(['info', 'warning', 'success', 'maintenance']).default('info'),
  status:      z.enum(['draft', 'published', 'scheduled']).default('draft'),
  scheduledAt: z.string().datetime().optional().nullable(),
  expiresAt:   z.string().datetime().optional().nullable(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const status = req.nextUrl.searchParams.get('status') ?? 'all'
    const filter: Record<string, unknown> = {}
    if (status !== 'all') filter.status = status

    const announcements = await Announcement.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()

    return NextResponse.json({ announcements })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireAdmin()

    if (!hasRole(actor.role, 'admin')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions to create announcements.' } },
        { status: 403 }
      )
    }

    await connectDB()
    const body   = await req.json().catch(() => ({}))
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } },
        { status: 400 }
      )
    }

    const { title, body: announcementBody, type, status, scheduledAt, expiresAt } = parsed.data

    const announcement = await Announcement.create({
      title,
      body:          announcementBody,
      type,
      status,
      scheduledAt:   scheduledAt ? new Date(scheduledAt) : null,
      expiresAt:     expiresAt   ? new Date(expiresAt)   : null,
      createdBy:     actor.adminId,
      createdByName: actor.name,
    })

    await writeAuditLog({
      actor,
      action: 'announcement_created',
      result: 'success',
      target: { type: 'announcement', id: String(announcement._id) },
      metadata: { title, status, type },
    })

    return NextResponse.json({ ok: true, announcement }, { status: 201 })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
