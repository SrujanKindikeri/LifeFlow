/**
 * GET /api/admin/overview
 * Returns real aggregate metrics for the admin overview dashboard.
 * All values come from MongoDB aggregations — nothing is fabricated.
 */
import { NextResponse }                     from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB, getConnectionStatus }    from '@/lib/db'
import User                                  from '@/models/User'
import NotificationLog                       from '@/models/NotificationLog'
import AuditLog                              from '@/models/AuditLog'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const now         = new Date()
    const last24h     = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const last7d      = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
    const last30d     = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [
      userStats,
      notifStats,
      recentAuditLogs,
      recentRegCount,
    ] = await Promise.all([
      // User aggregate
      User.aggregate<{
        total: number; active: number; deleted: number;
        emailVerified: number; notificationsTested: number
      }>([{
        $group: {
          _id: null,
          total:                { $sum: 1 },
          active:               { $sum: { $cond: [{ $eq: ['$accountStatus', 'active'] }, 1, 0] } },
          deleted:              { $sum: { $cond: [{ $eq: ['$accountStatus', 'deleted'] }, 1, 0] } },
          emailVerified:        { $sum: { $cond: [{ $eq: ['$emailVerified', true] }, 1, 0] } },
          notificationsTested:  { $sum: { $cond: [{ $eq: ['$notificationsTested', true] }, 1, 0] } },
        },
      }]),

      // Notification log aggregate (last 7 days)
      NotificationLog.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: last7d } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Recent audit log (last 10 entries)
      AuditLog.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('actorName actorRole action result target createdAt')
        .lean(),

      // New registrations in last 30 days
      User.countDocuments({ createdAt: { $gte: last30d } }),
    ])

    const u = userStats[0] ?? { total: 0, active: 0, deleted: 0, emailVerified: 0, notificationsTested: 0 }

    const notifCounts: Record<string, number> = {}
    for (const row of notifStats) notifCounts[row._id] = row.count

    // Worker liveness — last NotificationLog entry
    const lastLog = await NotificationLog.findOne().sort({ createdAt: -1 }).select('createdAt').lean<{ createdAt: Date } | null>()
    let workerStatus = 'NO_ACTIVITY_YET'
    if (lastLog?.createdAt) {
      const ageMin = (now.getTime() - lastLog.createdAt.getTime()) / 60_000
      workerStatus = ageMin < 10 ? 'RUNNING' : `POSSIBLY_STOPPED (${Math.round(ageMin)}m ago)`
    }

    // Registrations in last 24h
    const recentReg24h = await User.countDocuments({ createdAt: { $gte: last24h } })

    return NextResponse.json({
      generatedAt: now.toISOString(),
      database:    { status: getConnectionStatus(), name: process.env.MONGODB_DB_NAME ?? 'test' },
      users: {
        total:               u.total,
        active:              u.active,
        deleted:             u.deleted,
        emailVerified:       u.emailVerified,
        notificationsTested: u.notificationsTested,
        newLast24h:          recentReg24h,
        newLast30d:          recentRegCount,
      },
      notifications: {
        last7Days: {
          pending:    notifCounts['pending']      ?? 0,
          processing: notifCounts['processing']   ?? 0,
          sent:       notifCounts['sent_to_smtp'] ?? 0,
          failed:     notifCounts['failed']       ?? 0,
          skipped:    notifCounts['skipped']      ?? 0,
        },
        workerStatus,
        lastWorkerActivityAt: lastLog?.createdAt?.toISOString() ?? null,
      },
      recentAdminActions: recentAuditLogs.map((log) => ({
        actorName: (log as { actorName: string }).actorName,
        actorRole: (log as { actorRole: string }).actorRole,
        action:    (log as { action: string }).action,
        result:    (log as { result: string }).result,
        target:    (log as { target: unknown }).target,
        at:        (log as { createdAt: Date }).createdAt?.toISOString(),
      })),
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
