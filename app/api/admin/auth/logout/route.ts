/**
 * POST /api/admin/auth/logout
 * Destroys the admin session cookie and writes an audit log entry.
 */
import { NextResponse } from 'next/server'
import { getAdminSession, writeAuditLog } from '@/lib/admin-auth'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  try {
    const session = await getAdminSession()

    if (session.isAdminLoggedIn && session.adminId) {
      const actor = {
        adminId: session.adminId,
        name:    session.adminName   ?? 'Unknown',
        email:   session.adminEmail  ?? '',
        role:    session.adminRole   ?? 'admin' as const,
      }
      await writeAuditLog({ actor, action: 'admin_logout', result: 'success' })
      logger.info('[admin/logout] Admin logged out', { adminId: session.adminId })
    }

    await session.destroy()

    return NextResponse.json({ ok: true, message: 'Logged out successfully.' })
  } catch (err) {
    logger.error('[admin/logout] Error', { errorMessage: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ ok: true, message: 'Logged out.' })
  }
}
