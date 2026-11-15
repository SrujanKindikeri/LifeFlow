/**
 * GET /api/admin/sync
 * Reports server-side sync endpoint health and recent diagnostics.
 *
 * Note on scope: LifeFlow uses an offline-first client (Dexie/IndexedDB).
 * The "pending local changes" queue lives in the browser — the server cannot
 * know what is in each device's IndexedDB unless the client reports it.
 * This endpoint reports only what the SERVER can observe: sync endpoint
 * availability, recent server errors, and NotificationLog job health as a
 * proxy for background worker liveness.
 */
import { NextResponse }                               from 'next/server'
import { requireAdmin, handleAdminAuthError }         from '@/lib/admin-auth'
import { connectDB, pingDB }                          from '@/lib/db'
import NotificationLog                                from '@/models/NotificationLog'
import User                                           from '@/models/User'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const dbPing = await pingDB(3000)
    const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000)
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [
      totalUsers,
      stuckJobs,
      failedLast24h,
      pendingJobs,
      lastLog,
    ] = await Promise.all([
      User.countDocuments({ accountStatus: 'active' }),
      NotificationLog.countDocuments({ status: 'processing', updatedAt: { $lt: stuckThreshold } }),
      NotificationLog.countDocuments({ status: 'failed', createdAt: { $gte: last24h } }),
      NotificationLog.countDocuments({ status: 'pending' }),
      NotificationLog.findOne().sort({ createdAt: -1 }).select('createdAt status').lean<{ createdAt: Date; status: string } | null>(),
    ])

    let workerStatus: 'RUNNING' | 'POSSIBLY_STOPPED' | 'NO_ACTIVITY_YET' = 'NO_ACTIVITY_YET'
    let lastWorkerActivityAt: string | null = null
    let lastWorkerActivityAgeMin: number | null = null
    if (lastLog?.createdAt) {
      lastWorkerActivityAt = lastLog.createdAt.toISOString()
      lastWorkerActivityAgeMin = Math.round((Date.now() - lastLog.createdAt.getTime()) / 60_000)
      // Typed literal — never a free-form string.  Clients compare with ===.
      workerStatus = lastWorkerActivityAgeMin < 10 ? 'RUNNING' : 'POSSIBLY_STOPPED'
    }

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      database: {
        status: dbPing ? 'connected' : 'unreachable',
        ping:   dbPing,
      },
      syncEndpoints: {
        // These are the server-side sync API endpoints.
        // Their availability is inferred from DB connectivity.
        pushSync:  { path: '/api/sync',      available: dbPing },
        pullSync:  { path: '/api/sync/pull', available: dbPing },
        note: 'Client-side (IndexedDB) pending changes are not visible from the server.',
      },
      backgroundWorker: {
        // status is a strict typed literal — clients compare with ===.
        // lastActivityAgeMin is a separate integer field; never embedded in the status string.
        status:              workerStatus,
        lastActivityAt:      lastWorkerActivityAt,
        lastActivityAgeMin:  lastWorkerActivityAgeMin,
        stuckJobs,
        pendingJobs,
        failedLast24h,
        hint: stuckJobs > 0
          ? `${stuckJobs} job(s) stuck in 'processing' > 5 min — restart notification-worker container`
          : 'No stuck jobs detected',
      },
      users: { activeAccounts: totalUsers },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
