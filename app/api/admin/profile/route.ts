/**
 * GET  /api/admin/profile  — return the authenticated admin's own profile data.
 * PATCH /api/admin/profile — update permitted profile fields (name, avatar).
 *
 * SECURITY
 * ────────
 * • Calls requireAdmin() on every request — full DB-backed session check.
 * • Only allows updating the requesting admin's own record.
 * • Never returns or accepts passwordHash.
 * • Validates all input with Zod before writing to the database.
 * • PATCH writes are audited.
 */
import { NextRequest, NextResponse }                  from 'next/server'
import { z }                                          from 'zod'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog }                              from '@/lib/admin-auth'
import { connectDB }                                  from '@/lib/db'
import AdminUser                                      from '@/models/AdminUser'

export const dynamic = 'force-dynamic'

// Safe projection — passwordHash is never returned
const SAFE_PROJECTION = {
  name: 1, email: 1, role: 1, isActive: 1,
  avatar: 1, createdAt: 1, updatedAt: 1,
  lastLoginAt: 1, createdBy: 1,
} as const

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin({ skipActivityUpdate: true })
    await connectDB()

    const doc = await AdminUser.findById(admin.adminId)
      .select(SAFE_PROJECTION)
      .lean<{
        name: string; email: string; role: string; isActive: boolean;
        avatar?: string; createdAt: Date; updatedAt: Date;
        lastLoginAt: Date | null; createdBy: string;
      } | null>()

    if (!doc) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Admin account not found.' } },
        { status: 404 }
      )
    }

    return NextResponse.json({
      profile: {
        adminId:     admin.adminId,
        name:        doc.name,
        email:       doc.email,
        role:        doc.role,
        isActive:    doc.isActive,
        avatar:      doc.avatar ?? null,
        createdAt:   doc.createdAt,
        updatedAt:   doc.updatedAt,
        lastLoginAt: doc.lastLoginAt ?? null,
        createdBy:   doc.createdBy,
      },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const patchSchema = z.object({
  name:   z.string().trim().min(1, 'Name is required').max(100, 'Name too long').optional(),
  avatar: z.string().trim().max(2048, 'Avatar URL too long').nullable().optional(),
})

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin()
    await connectDB()

    let body: unknown
    try { body = await req.json() } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } },
        { status: 400 }
      )
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } },
        { status: 400 }
      )
    }

    const updates = parsed.data
    // Nothing to update
    if (!updates.name && updates.avatar === undefined) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'No updateable fields provided.' } },
        { status: 400 }
      )
    }

    const updateDoc: Record<string, unknown> = {}
    if (updates.name   !== undefined) updateDoc.name   = updates.name
    if (updates.avatar !== undefined) updateDoc.avatar = updates.avatar

    const updated = await AdminUser.findByIdAndUpdate(
      admin.adminId,
      { $set: updateDoc },
      { returnDocument: 'after', runValidators: true }
    ).select(SAFE_PROJECTION).lean<{
      name: string; email: string; role: string; isActive: boolean;
      avatar?: string; createdAt: Date; updatedAt: Date;
      lastLoginAt: Date | null; createdBy: string;
    } | null>()

    if (!updated) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Admin account not found.' } },
        { status: 404 }
      )
    }

    await writeAuditLog({
      actor:    admin,
      action:   'admin_profile_updated',
      result:   'success',
      target:   { type: 'admin', id: admin.adminId },
      metadata: { updatedFields: Object.keys(updateDoc) },
    })

    return NextResponse.json({
      ok:      true,
      profile: {
        adminId:     admin.adminId,
        name:        updated.name,
        email:       updated.email,
        role:        updated.role,
        isActive:    updated.isActive,
        avatar:      updated.avatar ?? null,
        createdAt:   updated.createdAt,
        updatedAt:   updated.updatedAt,
        lastLoginAt: updated.lastLoginAt ?? null,
        createdBy:   updated.createdBy,
      },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
