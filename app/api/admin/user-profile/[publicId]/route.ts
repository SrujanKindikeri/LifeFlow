/**
 * GET /api/admin/user-profile/[publicId]
 *
 * Detailed administrator-only view of a single user's activity, sessions,
 * usage, reliability, and activity timeline.
 *
 * Response sections
 * ─────────────────
 * account:     { name, email, publicId, accountStatus, createdAt }
 * sessions:    recent and active sessions with device info
 * loginHistory: login/logout/revocation events from SecurityEvent
 * usage:       { mostUsedModule, moduleVisits, moduleActiveTime,
 *               recentNavigation, dailyActiveTime, lastSeenModule }
 * reliability: { failedOps, repeatedErrors, lastError }
 * timeline:    chronological events (ModuleEvent) with module, operation, outcome
 *
 * Privacy: administrators see activity METADATA, not private user content
 * (note text, task titles, expense amounts are never included).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError, writeAuditLog } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import UserSession, { HEARTBEAT_ACTIVE_MINUTES, HEARTBEAT_RECENT_MINUTES } from '@/models/UserSession'
import { resolveSessionStatus } from '@/lib/session-tracking'
import SecurityEvent from '@/models/SecurityEvent'
import ModuleEvent from '@/models/ModuleEvent'
import AnalyticsEvent from '@/models/AnalyticsEvent'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

const MODULE_LABELS: Record<string, string> = {
  notes: 'Notes', tasks: 'Tasks', habits: 'Habits',
  projects: 'Projects', expenses: 'Expenses', subscriptions: 'Subscriptions',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin()
    await connectDB()

    const { publicId } = await params

    // ── Find user ───────────────────────────────────────────────────────────
    const user = await User.findOne({ publicId })
      .select('name email publicId accountStatus createdAt')
      .lean<{ name: string; email: string; publicId: string; accountStatus?: string; createdAt: Date } | null>()

    if (!user) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'User not found.' } },
        { status: 404 },
      )
    }

    // Record audit log for user profile view
    void writeAuditLog({
      actor: admin,
      action: 'user_viewed',
      result: 'success',
      target: { type: 'user', id: publicId },
      metadata: { source: 'intelligence_profile' },
    })

    const now = new Date()
    const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // ── Find user's _id for queries ──────────────────────────────────────────
    const userDoc = await User.findOne({ publicId }).select('_id').lean<{ _id: mongoose.Types.ObjectId } | null>()
    const userObjectId = userDoc!._id

    // ── Run all queries in parallel ──────────────────────────────────────────
    const [
      // Sessions (last 24h window, TTL)
      sessions,
      // Login history (security events for this user, last 30 days)
      loginHistory,
      // Module usage: operations by module for this user
      moduleUsage,
      // Daily active time (heartbeat session durations per day)
      // (estimated from heartbeat timestamps — labeled as estimated)
      dailyActivity,
      // Recent events (timeline, last 100)
      recentEvents,
      // Reliability: failures for this user
      failureStats,
      // Last error
      lastError,
      // Section views by this user (AnalyticsEvent)
      sectionViews,
    ] = await Promise.all([

      // ── Sessions ──────────────────────────────────────────────────────────
      UserSession.find({ userId: userObjectId, lastSeenAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } })
        .sort({ lastSeenAt: -1 })
        .limit(50)
        .select('sessionId status lastSeenAt sessionStartedAt lastModule browser browserVersion os osVersion deviceCategory ip ipSource approximateLocation revokedAt loggedOutAt')
        .lean(),

      // ── Login history ─────────────────────────────────────────────────────
      SecurityEvent.find({
        $or: [
          { userId: userObjectId },
          { publicId },
        ],
        createdAt: { $gte: since30 },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('eventType outcome ip deviceCategory browser metadata createdAt')
        .lean(),

      // ── Module usage (operations by module) ────────────────────────────────
      ModuleEvent.aggregate<{
        _id: string; totalOps: number; successes: number; failures: number; lastActivity: Date
      }>([
        { $match: { userId: userObjectId, createdAt: { $gte: since30 } } },
        {
          $group: {
            _id:           '$module',
            totalOps:      { $sum: 1 },
            successes:     { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
            failures:      { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } },
            lastActivity:  { $max: '$createdAt' },
          },
        },
        { $sort: { totalOps: -1 } },
      ]),

      // ── Daily activity (estimated from heartbeat durations) ─────────────────
      // Using ModuleEvent daily trend as a proxy for activity
      ModuleEvent.aggregate<{
        _id: string; ops: number; failures: number
      }>([
        { $match: { userId: userObjectId, createdAt: { $gte: since30 } } },
        {
          $group: {
            _id:      { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            ops:      { $sum: 1 },
            failures: { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ]),

      // ── Recent events (timeline) ───────────────────────────────────────────
      ModuleEvent.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(100)
        .select('module operation outcome httpStatus errorCategory errorMessage source durationMs createdAt correlationId')
        .lean(),

      // ── Reliability: failure stats ─────────────────────────────────────────
      ModuleEvent.aggregate<{
        _id: string; count: number; lastOccurrence: Date
      }>([
        { $match: { userId: userObjectId, outcome: 'failure', createdAt: { $gte: since30 } } },
        {
          $group: {
            _id:            '$errorCategory',
            count:          { $sum: 1 },
            lastOccurrence: { $max: '$createdAt' },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // ── Last error ─────────────────────────────────────────────────────────
      ModuleEvent.findOne({ userId: userObjectId, outcome: 'failure' })
        .sort({ createdAt: -1 })
        .select('module errorCategory errorMessage createdAt')
        .lean<{ module: string; errorCategory: string; errorMessage: string; createdAt: Date } | null>(),

      // ── Section views by this user ──────────────────────────────────────────
      AnalyticsEvent.aggregate<{
        _id: string; views: number; lastView: Date
      }>([
        { $match: { userId: userObjectId, createdAt: { $gte: since30 } } },
        {
          $group: {
            _id:       '$section',
            views:     { $sum: 1 },
            lastView:  { $max: '$createdAt' },
          },
        },
        { $sort: { views: -1 } },
      ]),
    ])

    // ── Compute usage summary ────────────────────────────────────────────────
    const moduleVisits = moduleUsage.map((m) => ({
      module:        m._id,
      moduleLabel:   MODULE_LABELS[m._id] ?? m._id,
      totalOps:      m.totalOps,
      successes:     m.successes,
      failures:      m.failures,
      lastActivity:  m.lastActivity.toISOString(),
    }))

    const mostUsedModule = moduleVisits[0] ?? null
    const lastSeenModule = [...moduleVisits].sort((a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    )[0]?.module ?? null

    // ── Compute reliability ──────────────────────────────────────────────────
    const totalFailures = failureStats.reduce((s, r) => s + r.count, 0)
    const repeatedErrors = failureStats.filter((r) => r.count >= 3).map((r) => ({
      errorCategory:  r._id,
      count:          r.count,
      lastOccurrence: r.lastOccurrence.toISOString(),
    }))

    // ── Build timeline ────────────────────────────────────────────────────────
    const timeline = recentEvents.map((e) => ({
      module:        e.module,
      operation:     e.operation,
      outcome:       e.outcome,
      httpStatus:    e.httpStatus ?? null,
      errorCategory:  e.errorCategory ?? null,
      errorMessage:   e.errorMessage ?? null,
      source:        e.source,
      durationMs:     e.durationMs ?? null,
      correlationId:  e.correlationId ?? null,
      timestamp:     e.createdAt.toISOString(),
    }))

    // ── Build session display ───────────────────────────────────────────────
    const sessionDisplay = sessions.map((s) => {
      const display = resolveSessionStatus(s.status, s.lastSeenAt, now)
      return {
        sessionId:          s.sessionId,
        status:             display.status,
        estimated:          display.estimated,
        sessionStartedAt:   s.sessionStartedAt?.toISOString() ?? null,
        lastSeenAt:         s.lastSeenAt?.toISOString() ?? null,
        lastModule:         s.lastModule ?? null,
        browser:            s.browser,
        browserVersion:     s.browserVersion,
        os:                 s.os,
        osVersion:          s.osVersion,
        deviceCategory:     s.deviceCategory,
        ip:                 s.ip,
        ipSource:           s.ipSource,
        approximateLocation: s.approximateLocation,
        revokedAt:          s.revokedAt?.toISOString() ?? null,
        loggedOutAt:        s.loggedOutAt?.toISOString() ?? null,
      }
    })

    // ── Build login history ──────────────────────────────────────────────────
    const loginHistoryDisplay = loginHistory.map((e) => ({
      eventType:       e.eventType,
      outcome:         e.outcome,
      ip:               e.ip,
      deviceCategory:   e.deviceCategory,
      browser:          e.browser,
      metadata:         e.metadata,
      timestamp:        e.createdAt.toISOString(),
    }))

    // ── Build daily activity ─────────────────────────────────────────────────
    const dailyActivityDisplay = dailyActivity.map((d) => ({
      date:     d._id,
      ops:      d.ops,
      failures: d.failures,
    }))

    // ── Active sessions count ────────────────────────────────────────────────
    const activeSessionCount = sessionDisplay.filter((s) => s.status === 'active').length

    return NextResponse.json({
      generatedAt: now.toISOString(),
      thresholds: {
        activeMinutes: HEARTBEAT_ACTIVE_MINUTES,
        recentMinutes: HEARTBEAT_RECENT_MINUTES,
      },
      account: {
        name:           user.name,
        email:          user.email,
        publicId:        user.publicId,
        accountStatus:   user.accountStatus ?? 'active',
        createdAt:       user.createdAt.toISOString(),
      },
      sessions: sessionDisplay,
      activeSessionCount,
      loginHistory: loginHistoryDisplay,
      usage: {
        mostUsedModule:  mostUsedModule?.module ?? null,
        mostUsedModuleLabel: mostUsedModule?.moduleLabel ?? null,
        moduleVisits,
        lastSeenModule,
        sectionViews: sectionViews.map((s) => ({
          section:    s._id,
          views:      s.views,
          lastView:   s.lastView.toISOString(),
        })),
        dailyActivity: dailyActivityDisplay,
      },
      reliability: {
        totalFailures,
        repeatedErrors,
        lastError: lastError ? {
          module:        lastError.module,
          errorCategory:  lastError.errorCategory,
          errorMessage:   lastError.errorMessage,
          timestamp:     lastError.createdAt.toISOString(),
        } : null,
      },
      timeline,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
