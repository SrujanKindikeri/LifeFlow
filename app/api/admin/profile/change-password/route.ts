/**
 * POST /api/admin/profile/change-password
 *
 * Allows the authenticated admin to change their own password.
 *
 * SECURITY
 * ────────
 * • Requires a valid admin session (requireAdmin()).
 * • Current password must be verified with bcrypt before the new hash is written.
 * • New password must be ≥ 12 characters and differ from the current one.
 * • Uses bcryptjs with cost factor 12 — same as the bootstrap script.
 * • Audit log written on success and failure.
 * • Never returns or echoes passwords.
 */
import { NextRequest, NextResponse }            from 'next/server'
import bcrypt                                   from 'bcryptjs'
import { z }                                    from 'zod'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog }                        from '@/lib/admin-auth'
import { connectDB }                            from '@/lib/db'
import AdminUser                               from '@/models/AdminUser'

export const dynamic = 'force-dynamic'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword:     z.string().min(12, 'New password must be at least 12 characters.').max(128),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
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

    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } },
        { status: 400 }
      )
    }

    const { currentPassword, newPassword } = parsed.data

    // Fetch the passwordHash — it is select-excluded by default so we must
    // explicitly request it here.
    const doc = await AdminUser.findById(admin.adminId)
      .select('+passwordHash')
      .lean<{ passwordHash: string } | null>()

    if (!doc) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Admin account not found.' } },
        { status: 404 }
      )
    }

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, doc.passwordHash)
    if (!isCurrentValid) {
      await writeAuditLog({
        actor:  admin,
        action: 'admin_password_changed',
        result: 'failure',
        target: { type: 'admin', id: admin.adminId },
        metadata: { reason: 'incorrect_current_password' },
      })
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect.' } },
        { status: 401 }
      )
    }

    // Prevent re-using the same password
    const isSamePassword = await bcrypt.compare(newPassword, doc.passwordHash)
    if (isSamePassword) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'New password must differ from the current password.' } },
        { status: 400 }
      )
    }

    // Hash and persist
    const newHash = await bcrypt.hash(newPassword, 12)
    await AdminUser.findByIdAndUpdate(admin.adminId, { $set: { passwordHash: newHash } })

    await writeAuditLog({
      actor:  admin,
      action: 'admin_password_changed',
      result: 'success',
      target: { type: 'admin', id: admin.adminId },
    })

    return NextResponse.json({ ok: true, message: 'Password updated successfully.' })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
