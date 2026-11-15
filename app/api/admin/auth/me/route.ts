/**
 * GET /api/admin/auth/me
 * Returns the currently authenticated admin's safe profile.
 * Used by the admin shell header to display name and role.
 */
import { NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const admin = await requireAdmin()
    return NextResponse.json({
      admin: {
        adminId: admin.adminId,
        name:    admin.name,
        email:   admin.email,
        role:    admin.role,
      },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
