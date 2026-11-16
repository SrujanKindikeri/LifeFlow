/**
 * GET /api/admin/intelligence/overview
 *
 * User Intelligence & Monitoring Center overview dashboard.
 *
 * Returns real data from MongoDB aggregations across all tracking models.
 * Nothing is fabricated.  Each metric is defined with its time window.
 *
 * Response sections
 * ─────────────────
 * users:         { total, active, deleted, newInWindow, newToday }
 * sessions:      { activeNow, recentlyActive, totalInWindow, uniqueUsersNow }
 * engagement:    { dau, wau, mau, dailyTrend, topModules, moduleRanking }
 * reliability:   { usersWithRepeatedErrors, totalFailures, loginFailures }
 * security:      { recentEvents, loginFailures, unusualSessionPatterns }
 * devices:       { browserDistribution, osDistribution, deviceCategoryDistribution }
 *
 * Privacy: never exposes IP addresses in summary stats (only in detailed
 * views behind admin auth).  Never labels a user as malicious based on
 * IP or device changes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import UserSession, { HEARTBEAT_ACTIVE_MINUTES, HEARTBEAT_RECENT_MINUTES } from '@/models/UserSession'
import SecurityEvent from '@/models/SecurityEvent'
import ModuleEvent from '@/models/ModuleEvent'
import AnalyticsEvent from '@/models/AnalyticsEvent'
import { parseDateRange } from '@/lib/admin-query'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const { since } = parseDateRange(req)
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const sevenDaysAgoStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const activeThreshold = new Date(now.getTime() - HEARTBEAT_ACTIVE_MINUTES * 60 * 1000)
    const recentThreshold = new Date(now.getTime() - HEARTBEAT_RECENT_MINUTES * 60 * 1000)

    // ── Build date strings for daily trend ───────────────────────────────────
    const days = Math.round((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000))
    const dateStrings: string[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      dateStrings.push(d.toISOString().slice(0, 10))
    }

    // ── Run all aggregations in parallel ─────────────────────────────────────
    const [
      // User stats
      userStats,
      newTodayCount,
      newInWindowCount,
      // Session stats
      activeSessions,
      recentSessions,
      totalSessionsInWindow,
      uniqueUsersNow,
      // Engagement (AnalyticsEvent)
      dauResult,
      wauResult,
      mauResult,
      dailyTrendRaw,
      topSectionsRaw,
      // Module ranking (ModuleEvent)
      moduleRankingRaw,
      // Reliability
      usersWithErrorsRaw,
      totalFailuresRaw,
      // Security
      loginFailuresRaw,
      recentSecurityEventsRaw,
      // Device distribution
      browserDistRaw,
      osDistRaw,
      deviceCatDistRaw,
      // Unusual patterns: users with IP changes
      ipChangeRaw,
    ] = await Promise.all([

      // ── User stats ──────────────────────────────────────────────────────────
      User.aggregate<{
        total: number; active: number; deleted: number; emailVerified: number
      }>([{
        $group: {
          _id:           null,
          total:         { $sum: 1 },
          active:        { $sum: { $cond: [{ $eq: ['$accountStatus', 'active'] }, 1, 0] } },
          deleted:       { $sum: { $cond: [{ $eq: ['$accountStatus', 'deleted'] }, 1, 0] } },
          emailVerified: { $sum: { $cond: [{ $eq: ['$emailVerified', true] }, 1, 0] } },
        },
      }]),
      User.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }),
      User.countDocuments({ createdAt: { $gte: since } }),

      // ── Session stats ───────────────────────────────────────────────────────
      UserSession.countDocuments({
        lastSeenAt: { $gte: activeThreshold },
        status: { $ne: 'revoked' },
      }),
      UserSession.countDocuments({
        lastSeenAt: { $gte: recentThreshold },
        status: { $ne: 'revoked' },
      }),
      UserSession.countDocuments({ lastSeenAt: { $gte: since } }),
      UserSession.distinct('userId', {
        lastSeenAt: { $gte: new Date(now.getTime() - HEARTBEAT_RECENT_MINUTES * 60 * 1000) },
        status: { $ne: 'revoked' },
      }),

      // ── Engagement (AnalyticsEvent — section views) ─────────────────────────
      // DAU — distinct users today
      AnalyticsEvent.aggregate<{ dau: number }>([
        { $match: { dateString: todayStr } },
        { $group: { _id: '$userId' } },
        { $count: 'dau' },
      ]),
      // WAU — distinct users last 7 days
      AnalyticsEvent.aggregate<{ wau: number }>([
        { $match: { dateString: { $gte: sevenDaysAgoStr } } },
        { $group: { _id: '$userId' } },
        { $count: 'wau' },
      ]),
      // MAU — distinct users in window
      AnalyticsEvent.aggregate<{ mau: number }>([
        { $match: { dateString: { $gte: since.toISOString().slice(0, 10) } } },
        { $group: { _id: '$userId' } },
        { $count: 'mau' },
      ]),
      // Daily trend
      AnalyticsEvent.aggregate<{ _id: string; views: number; uniqueUsers: number }>([
        { $match: { dateString: { $in: dateStrings } } },
        {
          $group: {
            _id:         '$dateString',
            views:       { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' },
          },
        },
        { $project: { _id: 1, views: 1, uniqueUsers: { $size: '$uniqueUsers' } } },
        { $sort: { _id: 1 } },
      ]),
      // Top sections
      AnalyticsEvent.aggregate<{ _id: string; views: number; uniqueUsers: number }>([
        { $match: { dateString: { $in: dateStrings } } },
        {
          $group: {
            _id:         '$section',
            views:       { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' },
          },
        },
        { $project: { _id: 1, views: 1, uniqueUsers: { $size: '$uniqueUsers' } } },
        { $sort: { views: -1 } },
        { $limit: 10 },
      ]),

      // ── Module ranking (ModuleEvent) ────────────────────────────────────────
      ModuleEvent.aggregate<{
        _id: string; totalOps: number; uniqueUsers: number; failures: number
      }>([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id:         '$module',
            totalOps:    { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' },
            failures:    { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } },
          },
        },
        {
          $project: {
            _id: 1, totalOps: 1, failures: 1,
            uniqueUsers: { $size: '$uniqueUsers' },
          },
        },
        { $sort: { totalOps: -1 } },
      ]),

      // ── Reliability: users with repeated errors (≥3 failures) ──────────────
      ModuleEvent.aggregate<{
        _id: string; failureCount: number; modules: string[]
      }>([
        { $match: { createdAt: { $gte: since }, outcome: 'failure' } },
        {
          $group: {
            _id:          '$publicId',
            failureCount: { $sum: 1 },
            modules:      { $addToSet: '$module' },
          },
        },
        { $match: { failureCount: { $gte: 3 } } },
        { $sort: { failureCount: -1 } },
        { $limit: 20 },
      ]),

      // Total failures
      ModuleEvent.countDocuments({ createdAt: { $gte: since }, outcome: 'failure' }),

      // ── Security: login failures ─────────────────────────────────────────────
      SecurityEvent.aggregate<{
        _id: string; count: number; uniqueIps: number; lastOccurrence: Date
      }>([
        { $match: { eventType: 'login_failure', createdAt: { $gte: since } } },
        {
          $group: {
            _id:             '$outcome',
            count:           { $sum: 1 },
            uniqueIps:       { $addToSet: '$ip' },
            lastOccurrence:  { $max: '$createdAt' },
          },
        },
        {
          $project: {
            _id: 1, count: 1, lastOccurrence: 1,
            uniqueIps: { $size: '$uniqueIps' },
          },
        },
      ]),

      // Recent security events
      SecurityEvent.find({ createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('eventType outcome publicId ip deviceCategory browser metadata createdAt')
        .lean(),

      // ── Device distribution ─────────────────────────────────────────────────
      UserSession.aggregate<{ _id: string; count: number }>([
        { $match: { lastSeenAt: { $gte: since } } },
        { $group: { _id: '$browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      UserSession.aggregate<{ _id: string; count: number }>([
        { $match: { lastSeenAt: { $gte: since } } },
        { $group: { _id: '$os', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      UserSession.aggregate<{ _id: string; count: number }>([
        { $match: { lastSeenAt: { $gte: since } } },
        { $group: { _id: '$deviceCategory', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // ── Unusual patterns: users with multiple distinct IPs ──────────────────
      // (IP changes are normal for mobile users — this is just for review,
      //  NOT an indicator of malicious activity)
      UserSession.aggregate<{
        _id: string; ipCount: number; ipList: string[]
      }>([
        { $match: { lastSeenAt: { $gte: since }, ip: { $ne: null } } },
        {
          $group: {
            _id:     '$publicId',
            ipCount: { $addToSet: '$ip' },
          },
        },
        { $project: { _id: 1, ipCount: { $size: '$ipCount' }, ipList: '$ipCount' } },
        { $match: { ipCount: { $gte: 3 } } },
        { $sort: { ipCount: -1 } },
        { $limit: 20 },
      ]),
    ])

    // ── Process results ──────────────────────────────────────────────────────
    const u = userStats[0] ?? { total: 0, active: 0, deleted: 0, emailVerified: 0 }

    const trendMap = new Map(dailyTrendRaw.map((r) => [r._id, r]))
    const dailyTrend = dateStrings.map((date) => {
      const r = trendMap.get(date)
      return { date, views: r?.views ?? 0, uniqueUsers: r?.uniqueUsers ?? 0 }
    })

    return NextResponse.json({
      generatedAt: now.toISOString(),
      days,
      thresholds: {
        activeMinutes: HEARTBEAT_ACTIVE_MINUTES,
        recentMinutes: HEARTBEAT_RECENT_MINUTES,
      },
      users: {
        total:          u.total,
        active:         u.active,
        deleted:        u.deleted,
        emailVerified:  u.emailVerified,
        newToday:       newTodayCount,
        newInWindow:    newInWindowCount,
      },
      sessions: {
        activeNow:       activeSessions,
        recentlyActive:   recentSessions,
        totalInWindow:    totalSessionsInWindow,
        uniqueUsersNow:   Array.isArray(uniqueUsersNow) ? uniqueUsersNow.length : 0,
      },
      engagement: {
        dau:      dauResult[0]?.dau  ?? 0,
        wau:      wauResult[0]?.wau  ?? 0,
        mau:      mauResult[0]?.mau  ?? 0,
        dailyTrend,
        topSections: topSectionsRaw.map((r) => ({
          section:     r._id,
          views:       r.views,
          uniqueUsers:  r.uniqueUsers,
        })),
        moduleRanking: moduleRankingRaw.map((r) => ({
          module:      r._id,
          totalOps:    r.totalOps,
          uniqueUsers:  r.uniqueUsers,
          failures:    r.failures,
          errorRate:   r.totalOps > 0
            ? Math.round((r.failures / r.totalOps) * 10000) / 100
            : 0,
        })),
      },
      reliability: {
        usersWithRepeatedErrors: usersWithErrorsRaw.map((r) => ({
          publicId:     r._id,
          failureCount:  r.failureCount,
          modules:      r.modules,
        })),
        totalFailures: totalFailuresRaw,
      },
      security: {
        loginFailures: loginFailuresRaw.map((r) => ({
          outcome:       r._id,
          count:          r.count,
          uniqueIps:      r.uniqueIps,
          lastOccurrence: r.lastOccurrence?.toISOString() ?? null,
        })),
        recentEvents: recentSecurityEventsRaw.map((e) => ({
          eventType:       e.eventType,
          outcome:         e.outcome,
          publicId:        e.publicId,
          ip:              e.ip,
          deviceCategory:   e.deviceCategory,
          browser:          e.browser,
          metadata:         e.metadata,
          timestamp:        e.createdAt.toISOString(),
        })),
        note: 'IP or device changes do NOT indicate malicious activity. Mobile IPs change frequently.',
      },
      devices: {
        browserDistribution:       browserDistRaw.map((r) => ({ name: r._id, count: r.count })),
        osDistribution:             osDistRaw.map((r) => ({ name: r._id, count: r.count })),
        deviceCategoryDistribution: deviceCatDistRaw.map((r) => ({ name: r._id, count: r.count })),
      },
      review: {
        usersWithMultipleIps: ipChangeRaw.map((r) => ({
          publicId:  r._id,
          ipCount:  r.ipCount,
          ipList:   r.ipList,
        })),
        note: 'Multiple IPs per user is normal (mobile networks, VPNs). For review only, not an indicator of compromise.',
      },
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
