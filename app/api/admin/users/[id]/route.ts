/**
 * GET  /api/admin/users/[id]  — view user details
 * POST /api/admin/users/[id]  — perform an action on the user
 *
 * POST body: { action: 'suspend' | 'activate' | 'delete' | 'restore' }
 *
 * SECURITY
 * ────────
 * • Never returns passwordHash, token hashes, OTPs, or encrypted TOTP secret.
 * • Destructive actions (delete) require super_admin or admin role.
 * • Every action is written to AuditLog.
 * • restore is blocked if the recovery window has expired.
 */
import { NextRequest, NextResponse }                  from 'next/server'
import mongoose                                        from 'mongoose'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog, hasRole }                      from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import User                                            from '@/models/User'

export const dynamic = 'force-dynamic'

const SAFE_PROJECTION = {
  publicId: 1, name: 1, email: 1, avatar: 1,
  currency: 1, timezone: 1, accountStatus: 1,
  emailVerified: 1, notificationsTested: 1, notificationsTestedAt: 1,
  twoFactorEnabled: 1, emailOtpEnabled: 1, twoFactorEnabledAt: 1,
  deletedAt: 1, scheduledPermanentDeletionAt: 1,
  upiId: 1, createdAt: 1, updatedAt: 1,
  'emailNotifications': 1,
  'notificationPreferences': 1,
  'appearancePreferences.theme': 1,
} as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin()
    const { id } = await params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404 })
    }

    await connectDB()
    const user = await User.findById(id).select(SAFE_PROJECTION).lean()

    if (!user) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404 })
    }

    // Normalize accountStatus for the same reason as the list route.
    const doc = user as unknown as Record<string, unknown>
    if (doc.accountStatus == null) {
      doc.accountStatus = doc.deletedAt ? 'deleted' : 'active'
    }

    await writeAuditLog({
      actor:  admin,
      action: 'user_viewed',
      result: 'success',
      target: { type: 'user', id: (user as { publicId?: string }).publicId ?? id },
    })

    return NextResponse.json({ user })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin()
    const { id } = await params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404 })
    }

    const body   = await req.json().catch(() => ({}))
    const action = body.action as string

    if (!['suspend', 'activate', 'delete', 'restore'].includes(action)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid action. Use: suspend | activate | delete | restore' } },
        { status: 400 }
      )
    }

    // Support role can only view — not modify
    if (!hasRole(admin.role, 'admin')) {
      await writeAuditLog({ actor: admin, action: 'user_suspended', result: 'denied', target: { type: 'user', id } })
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions to modify users.' } },
        { status: 403 }
      )
    }

    await connectDB()
    const user = await User.findById(id).select('publicId name email accountStatus deletedAt scheduledPermanentDeletionAt')

    if (!user) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'User not found.' } }, { status: 404 })
    }

    const targetRef = { type: 'user', id: user.publicId ?? id }
    const now = new Date()

    if (action === 'suspend') {
      if (user.accountStatus === 'deleted') {
        return NextResponse.json({ error: { code: 'CONFLICT', message: 'Account is already deleted/suspended.' } }, { status: 409 })
      }
      user.accountStatus = 'deleted'
      user.deletedAt = now
      user.scheduledPermanentDeletionAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      await user.save()
      await writeAuditLog({ actor: admin, action: 'user_suspended', result: 'success', target: targetRef,
        metadata: { userEmail: user.email, userName: user.name } })
    }

    else if (action === 'activate') {
      user.accountStatus = 'active'
      user.deletedAt = null
      user.scheduledPermanentDeletionAt = null
      await user.save()
      await writeAuditLog({ actor: admin, action: 'user_activated', result: 'success', target: targetRef,
        metadata: { userEmail: user.email } })
    }

    else if (action === 'delete') {
      // Soft-delete — same as suspend but triggered as "delete" action
      if (user.accountStatus === 'deleted') {
        return NextResponse.json({ error: { code: 'CONFLICT', message: 'Account is already soft-deleted.' } }, { status: 409 })
      }
      user.accountStatus = 'deleted'
      user.deletedAt = now
      user.scheduledPermanentDeletionAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      await user.save()
      await writeAuditLog({ actor: admin, action: 'user_deleted', result: 'success', target: targetRef,
        metadata: { userEmail: user.email, recoveryWindowDays: 30 } })
    }

    else if (action === 'restore') {
      if (user.accountStatus !== 'deleted') {
        return NextResponse.json({ error: { code: 'CONFLICT', message: 'Account is not in a deleted state.' } }, { status: 409 })
      }
      if (user.scheduledPermanentDeletionAt && now >= user.scheduledPermanentDeletionAt) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: 'Recovery window has expired. Account cannot be restored.' } },
          { status: 409 }
        )
      }
      user.accountStatus = 'active'
      user.deletedAt = null
      user.scheduledPermanentDeletionAt = null
      await user.save()
      await writeAuditLog({ actor: admin, action: 'user_restored', result: 'success', target: targetRef,
        metadata: { userEmail: user.email } })
    }

    return NextResponse.json({ ok: true, action, userId: id })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
