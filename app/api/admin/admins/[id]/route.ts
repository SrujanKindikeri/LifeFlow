/**
 * PATCH  /api/admin/admins/[id]  — update admin (role, isActive)
 * DELETE /api/admin/admins/[id]  — deactivate admin (soft — just sets isActive=false)
 *
 * Requires super_admin. Enforces final-super-admin safeguard.
 */
import { NextRequest, NextResponse }                  from 'next/server'
import mongoose                                        from 'mongoose'
import { requireRole, handleAdminAuthError,
         writeAuditLog }                               from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import AdminUser                                       from '@/models/AdminUser'
import { z }                                           from 'zod'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  role:     z.enum(['admin', 'support', 'auditor']).optional(),
  isActive: z.boolean().optional(),
})

async function countActiveSuperAdmins(): Promise<number> {
  return AdminUser.countDocuments({ role: 'super_admin', isActive: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const actor = await requireRole('super_admin')
    const { id } = await params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Administrator not found.' } }, { status: 404 })
    }

    const body   = await req.json().catch(() => ({}))
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } },
        { status: 400 }
      )
    }

    await connectDB()
    const admin = await AdminUser.findById(id)
    if (!admin) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Administrator not found.' } }, { status: 404 })
    }

    // Final super_admin safeguard
    if (admin.role === 'super_admin') {
      const activeSupers = await countActiveSuperAdmins()
      const wouldDowngrade = parsed.data.role && (parsed.data.role as string) !== 'super_admin'
      const wouldDeactivate = parsed.data.isActive === false

      if ((wouldDowngrade || wouldDeactivate) && activeSupers <= 1) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'Cannot demote or deactivate the last active super_admin.' } },
          { status: 409 }
        )
      }
    }

    const updates: Record<string, unknown> = {}
    if (parsed.data.role     !== undefined) updates.role     = parsed.data.role
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive

    Object.assign(admin, updates)
    await admin.save()

    await writeAuditLog({
      actor,
      action: parsed.data.role ? 'admin_role_changed' : (parsed.data.isActive ? 'admin_activated' : 'admin_deactivated'),
      result: 'success',
      target: { type: 'admin', id },
      metadata: updates,
    })

    return NextResponse.json({
      ok: true,
      admin: { adminId: id, name: admin.name, email: admin.email, role: admin.role, isActive: admin.isActive },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const actor = await requireRole('super_admin')
    const { id } = await params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Administrator not found.' } }, { status: 404 })
    }

    // Cannot deactivate yourself
    if (id === actor.adminId) {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'You cannot deactivate your own account.' } },
        { status: 409 }
      )
    }

    await connectDB()
    const admin = await AdminUser.findById(id)
    if (!admin) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Administrator not found.' } }, { status: 404 })
    }

    // Final super_admin safeguard
    if (admin.role === 'super_admin') {
      const activeSupers = await countActiveSuperAdmins()
      if (activeSupers <= 1) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'Cannot deactivate the last active super_admin.' } },
          { status: 409 }
        )
      }
    }

    admin.isActive = false
    await admin.save()

    await writeAuditLog({
      actor,
      action: 'admin_deactivated',
      result: 'success',
      target: { type: 'admin', id },
      metadata: { email: admin.email, role: admin.role },
    })

    return NextResponse.json({ ok: true, message: 'Administrator deactivated.' })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
