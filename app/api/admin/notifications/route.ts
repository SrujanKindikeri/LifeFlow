/**
 * GET  /api/admin/notifications  — paginated notification log query
 * POST /api/admin/notifications  — retry a failed notification job
 *
 * GET query params:
 *   status  - pending | processing | sent_to_smtp | failed | skipped | all
 *   type    - notification type filter
 *   userId  - filter by user MongoDB ObjectId
 *   page    - 1-indexed (default: 1)
 *   limit   - 1–100    (default: 25)
 *
 * POST body: { action: 'retry', logId: '<NotificationLog ObjectId>' }
 * Retry resets a failed log entry to 'pending' so the worker picks it up.
 * Idempotent: if already pending/processing, returns 409.
 */
import { NextRequest, NextResponse }                  from 'next/server'
import mongoose                                        from 'mongoose'
import { requireAdmin, handleAdminAuthError,
         writeAuditLog, hasRole }                      from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import NotificationLog                                 from '@/models/NotificationLog'
import logger                                          from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const { searchParams } = req.nextUrl
    const status  = searchParams.get('status') ?? 'all'
    const type    = searchParams.get('type')   ?? ''
    const userId  = searchParams.get('userId') ?? ''
    const page    = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10))
    const limit   = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)))
    const skip    = (page - 1) * limit

    const filter: Record<string, unknown> = {}
    if (status !== 'all') filter.status = status
    if (type)   filter.type   = type
    if (userId && mongoose.Types.ObjectId.isValid(userId)) filter.userId = new mongoose.Types.ObjectId(userId)

    const [logs, total] = await Promise.all([
      NotificationLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // errorMessage intentionally included for admin — not exposed to regular users
        .select('key type forDate scheduledAt sentAt status contentPreview emailSubject errorMessage skipReason createdAt updatedAt userId')
        .lean(),
      NotificationLog.countDocuments(filter),
    ])

    // Status summary for the filter context
    const summary = await NotificationLog.aggregate<{ _id: string; count: number }>([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const counts: Record<string, number> = {}
    for (const row of summary) counts[row._id] = row.count

    return NextResponse.json({
      logs,
      total,
      page,
      limit,
      hasMore: skip + logs.length < total,
      summary: counts,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireAdmin()

    if (!hasRole(admin.role, 'admin')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions to retry notifications.' } },
        { status: 403 }
      )
    }

    const body   = await req.json().catch(() => ({}))
    const action = body.action as string
    const logId  = body.logId  as string

    if (action !== 'retry') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid action. Use: retry' } },
        { status: 400 }
      )
    }

    if (!logId || !mongoose.Types.ObjectId.isValid(logId)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid logId.' } },
        { status: 400 }
      )
    }

    await connectDB()
    const log = await NotificationLog.findById(logId)

    if (!log) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Notification log entry not found.' } }, { status: 404 })
    }

    if (log.status === 'pending' || log.status === 'processing') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: `Job is already ${log.status}. No action needed.` } },
        { status: 409 }
      )
    }

    if (log.status === 'sent_to_smtp') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'Notification was already sent successfully. Retrying would send a duplicate.' } },
        { status: 409 }
      )
    }

    // Reset to pending so the worker picks it up
    log.status       = 'pending'
    log.errorMessage = null
    await log.save()

    await writeAuditLog({
      actor:  admin,
      action: 'notification_retry',
      result: 'success',
      target: { type: 'notification_log', id: logId },
      metadata: { type: log.type, forDate: log.forDate },
    })

    logger.info('[admin/notifications] Retry scheduled', { logId, adminId: admin.adminId, type: log.type })

    return NextResponse.json({ ok: true, message: 'Notification reset to pending. Worker will process on next cycle.', logId })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
