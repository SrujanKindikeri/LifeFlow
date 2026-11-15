/**
 * GET /api/admin/audit-logs
 * Paginated audit log query. Restricted to admin and above (not support/auditor).
 *
 * Query params:
 *   actorId  - filter by admin ID
 *   action   - filter by action type
 *   result   - filter by result (success | failure | denied)
 *   from     - ISO date start
 *   to       - ISO date end
 *   page     - 1-indexed (default: 1)
 *   limit    - 1–100    (default: 25)
 */
import { NextRequest, NextResponse }                  from 'next/server'
import { requireAdmin, handleAdminAuthError }         from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import AuditLog                                        from '@/models/AuditLog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Support and auditor roles can read audit logs
    await requireAdmin()
    await connectDB()

    const { searchParams } = req.nextUrl
    const actorId = searchParams.get('actorId') ?? ''
    const action  = searchParams.get('action')  ?? ''
    const result  = searchParams.get('result')  ?? ''
    const from    = searchParams.get('from')    ?? ''
    const to      = searchParams.get('to')      ?? ''
    const page    = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10))
    const limit   = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)))
    const skip    = (page - 1) * limit

    const filter: Record<string, unknown> = {}
    if (actorId) filter.actorId = actorId
    if (action)  filter.action  = action
    if (result)  filter.result  = result
    if (from || to) {
      const dateFilter: Record<string, Date> = {}
      if (from) dateFilter.$gte = new Date(from)
      if (to)   dateFilter.$lte = new Date(to)
      filter.createdAt = dateFilter
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ])

    return NextResponse.json({ logs, total, page, limit, hasMore: skip + logs.length < total })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
