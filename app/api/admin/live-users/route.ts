/**
 * GET /api/admin/live-users
 *
 * Returns active and recent user sessions with full device intelligence.
 *
 * Query params
 * ────────────
 * status  — filter by presence status: 'active' | 'idle' | 'all'  (default: 'all')
 * limit   — max sessions to return (1-200, default 100)
 *
 * Response
 * ─────────
 * {
 *   generatedAt:  ISO timestamp,
 *   thresholds:   { activeMinutes, recentMinutes, ttlHours },
 *   sessions: [
 *     {
 *       publicId, name, email, sessionId, status, estimated,
 *       sessionStartedAt, lastSeenAt, lastModule,
 *       durationSeconds, browser, browserVersion, os, osVersion,
 *       deviceCategory, ip, approximateLocation, sessionCountForUser
 *     }
 *   ],
 *   summary: { totalSessions, activeCount, idleCount, expiredCount, uniqueUsers }
 * }
 *
 * All figures come from real UserSession records.  Presence states
 * (active/idle/expired) are ESTIMATES based on the last heartbeat —
 * the UI must show last-seen timestamps and label status as estimated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import UserSession, {
  HEARTBEAT_ACTIVE_MINUTES,
  HEARTBEAT_RECENT_MINUTES,
} from '@/models/UserSession'
import { resolveSessionStatus } from '@/lib/session-tracking'
import User from '@/models/User'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const sp = req.nextUrl.searchParams
    const statusFilter = sp.get('status') ?? 'all'
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '100', 10)))

    const now = new Date()

    // Query sessions within the TTL window (lastSeenAt > 24h ago)
    // Exclude terminal states (revoked, logged_out) when filtering for active
    const match: Record<string, unknown> = {
      lastSeenAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      status: { $ne: 'revoked' },
    }

    // Fetch sessions sorted by most recent activity
    const sessions = await UserSession.find(match)
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .lean()

    // Get unique userIds to look up display names
    const userIds = [...new Set(sessions.map((s) => s.userId.toString()))]
    const objectIdList = userIds.map((id) => new mongoose.Types.ObjectId(id))

    const users = await User.find({ _id: { $in: objectIdList } })
      .select('publicId name email accountStatus')
      .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string; email: string; accountStatus?: string }[]>()

    const userMap = new Map(users.map((u) => [u._id.toString(), u]))

    // Count sessions per user (for "number of active sessions for the user")
    const sessionCountMap = new Map<string, number>()
    for (const s of sessions) {
      const uid = s.userId.toString()
      sessionCountMap.set(uid, (sessionCountMap.get(uid) ?? 0) + 1)
    }

    // Build response with computed status
    let activeCount = 0
    let idleCount = 0
    let expiredCount = 0

    const result = sessions
      .map((s) => {
        const userDoc = userMap.get(s.userId.toString())
        if (!userDoc) return null // user deleted, skip

        const display = resolveSessionStatus(s.status, s.lastSeenAt, now)

        if (display.status === 'active') activeCount++
        else if (display.status === 'idle') idleCount++
        else if (display.status === 'expired') expiredCount++

        // Filter by status if requested
        if (statusFilter === 'active' && display.status !== 'active') return null
        if (statusFilter === 'idle' && display.status !== 'idle') return null

        const durationSeconds = s.sessionStartedAt
          ? Math.round((s.lastSeenAt.getTime() - s.sessionStartedAt.getTime()) / 1000)
          : 0

        return {
          publicId:           s.publicId,
          name:               userDoc.name,
          email:              userDoc.email,
          accountStatus:      userDoc.accountStatus ?? 'active',
          sessionId:          s.sessionId,
          status:             display.status,
          estimated:          display.estimated,
          sessionStartedAt:   s.sessionStartedAt?.toISOString() ?? null,
          lastSeenAt:         s.lastSeenAt?.toISOString() ?? null,
          lastModule:         s.lastModule ?? null,
          durationSeconds,
          browser:            s.browser,
          browserVersion:     s.browserVersion,
          os:                 s.os,
          osVersion:          s.osVersion,
          deviceCategory:     s.deviceCategory,
          ip:                 s.ip,
          ipSource:           s.ipSource,
          approximateLocation: s.approximateLocation,
          sessionCountForUser: sessionCountMap.get(s.userId.toString()) ?? 1,
        }
      })
      .filter(Boolean)

    return NextResponse.json({
      generatedAt: now.toISOString(),
      thresholds: {
        activeMinutes: HEARTBEAT_ACTIVE_MINUTES,
        recentMinutes: HEARTBEAT_RECENT_MINUTES,
        ttlHours: parseInt(process.env.USER_SESSION_TTL_HOURS ?? '24', 10) || 24,
      },
      sessions: result,
      summary: {
        totalSessions: sessions.length,
        activeCount,
        idleCount,
        expiredCount,
        uniqueUsers: userIds.length,
      },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
