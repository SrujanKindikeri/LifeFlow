/**
 * GET  /api/admin/admins  — list all administrators
 * POST /api/admin/admins  — create a new administrator
 *
 * Both require super_admin role.
 * Never returns passwordHash.
 */
import { NextRequest, NextResponse }                  from 'next/server'
import bcrypt from 'bcryptjs'
import { requireRole, handleAdminAuthError,
         writeAuditLog }                               from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import AdminUser                                       from '@/models/AdminUser'
import type { AdminRole }                              from '@/models/AdminUser'
import { z }                                           from 'zod'

export const dynamic = 'force-dynamic'

const createAdminSchema = z.object({
  name:     z.string().min(2).max(100).trim(),
  email:    z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(12).max(128),
  role:     z.enum(['admin', 'support', 'auditor']),  // cannot create super_admin via API
})

export async function GET(): Promise<NextResponse> {
  try {
    await requireRole('super_admin')
    await connectDB()

    const admins = await AdminUser.find()
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .lean()

    return NextResponse.json({ admins })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireRole('super_admin')
    await connectDB()

    const body   = await req.json().catch(() => ({}))
    const parsed = createAdminSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } },
        { status: 400 }
      )
    }

    const { name, email, password, role } = parsed.data

    const existing = await AdminUser.findOne({ email })
    if (existing) {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'An administrator with this email already exists.' } },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const newAdmin = await AdminUser.create({
      name,
      email,
      passwordHash,
      role: role as AdminRole,
      isActive:  true,
      createdBy: actor.adminId,
    })

    await writeAuditLog({
      actor,
      action: 'admin_created',
      result: 'success',
      target: { type: 'admin', id: String(newAdmin._id) },
      metadata: { email, role },
    })

    return NextResponse.json({
      ok: true,
      admin: {
        adminId: String(newAdmin._id),
        name:    newAdmin.name,
        email:   newAdmin.email,
        role:    newAdmin.role,
      },
    }, { status: 201 })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
