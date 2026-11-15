/**
 * GET /api/admin/system-health
 * Returns real server-side health metrics. Never exposes secrets.
 */
import { NextResponse }                               from 'next/server'
import { requireAdmin, handleAdminAuthError }         from '@/lib/admin-auth'
import { connectDB, pingDB, getConnectionStatus }     from '@/lib/db'
import NotificationLog                                from '@/models/NotificationLog'
import User                                           from '@/models/User'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin()

    const t0 = Date.now()
    const dbPing = await pingDB(5000)
    const dbLatencyMs = Date.now() - t0
    const dbStatus = getConnectionStatus()

    await connectDB()

    const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000)

    const [
      totalUsers,
      activeUsers,
      lastLog,
      stuckCount,
      failedLast24h,
      pendingCount,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ accountStatus: 'active' }),
      NotificationLog.findOne().sort({ createdAt: -1 }).select('createdAt status').lean<{ createdAt: Date; status: string } | null>(),
      NotificationLog.countDocuments({ status: 'processing', updatedAt: { $lt: stuckThreshold } }),
      NotificationLog.countDocuments({ status: 'failed', createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      NotificationLog.countDocuments({ status: 'pending' }),
    ])

    let workerStatus = 'NO_ACTIVITY_YET'
    if (lastLog?.createdAt) {
      const ageMin = (Date.now() - lastLog.createdAt.getTime()) / 60_000
      workerStatus = ageMin < 10 ? 'RUNNING' : `POSSIBLY_STOPPED (${Math.round(ageMin)}m)`
    }

    // Process metrics (Node.js built-ins — always available)
    const memMB = process.memoryUsage()
    const uptimeSec = process.uptime()

    // Config flags (booleans only — no secret values)
    const config = {
      emailProvider:       process.env.EMAIL_PROVIDER ?? 'none',
      smtpConfigured:      !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
      vapidConfigured:     !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      schedulerSecretSet:  !!(process.env.SCHEDULER_SECRET || process.env.CRON_SECRET),
      totpKeySet:          !!process.env.TOTP_ENCRYPTION_KEY,
      storageProvider:     process.env.STORAGE_PROVIDER ?? 'mongodb',
      appUrl:              process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      nodeEnv:             process.env.NODE_ENV ?? 'development',
      mongoDbName:         process.env.MONGODB_DB_NAME ?? 'test',
      version:             process.env.npm_package_version ?? '0.1.0',
    }

    return NextResponse.json({
      checkedAt:    new Date().toISOString(),
      overall:      dbPing ? 'ok' : 'degraded',
      database: {
        status:     dbStatus,
        ping:       dbPing,
        latencyMs:  dbLatencyMs,
        name:       config.mongoDbName,
      },
      application: {
        version:    config.version,
        nodeEnv:    config.nodeEnv,
        appUrl:     config.appUrl,
        nodeVersion: process.version,
      },
      process: {
        uptimeSeconds:    Math.floor(uptimeSec),
        memoryRssKb:      Math.round(memMB.rss       / 1024),
        memoryHeapUsedKb: Math.round(memMB.heapUsed  / 1024),
        memoryHeapTotalKb:Math.round(memMB.heapTotal / 1024),
      },
      worker: {
        status:    workerStatus,
        lastActivityAt: lastLog?.createdAt?.toISOString() ?? null,
        stuckJobs:      stuckCount,
        pendingJobs:    pendingCount,
        failedLast24h,
      },
      users: { total: totalUsers, active: activeUsers },
      configuration: config,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
