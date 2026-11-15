/**
 * GET /api/admin/ip-history
 *
 * Shows IP addresses observed by the server, with associated sessions,
 * devices, and security events.
 *
 * Query params
 * ────────────
 * ip      — filter by specific IP (exact match)
 * days    — lookback window (7 | 14 | 30 | 90, default 30)
 * page    — pagination
 * limit   — page size
 *
 * Response
 * ─────────
 * {
 *   entries: [
 *     { ip, ipSource, firstSeen, lastSeen, sessionCount, uniqueUsers,
 *       deviceCategories, browsers, securityEvents }
 *   ],
 *   total, page, limit, hasMore
 * }
 *
 * Privacy note: IP addresses are NEVER proof of identity.  Multiple users
 * can share an IP (NAT, VPN).  Mobile IPs change frequently.  The UI must
 * not label a user or login as malicious solely because an IP changes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import UserSession from '@/models/UserSession'
import SecurityEvent from '@/models/SecurityEvent'
import { parsePagination, parseDateRange, escapeRegex } from '@/lib/admin-query'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const pagination = parsePagination(req)
    const { since } = parseDateRange(req)
    const sp = req.nextUrl.searchParams

    const ipFilter = sp.get('ip')?.trim()

    // ── Build match ─────────────────────────────────────────────────────────
    const match: Record<string, unknown> = {
      lastSeenAt: { $gte: since },
      ip: { $ne: null },
    }
    if (ipFilter) {
      match.ip = { $regex: escapeRegex(ipFilter), $options: 'i' }
    }

    // ── Aggregate sessions by IP ─────────────────────────────────────────────
    const ipAggregation = await UserSession.aggregate<{
      _id: string | null
      firstSeen: Date
      lastSeen: Date
      sessionCount: number
      uniqueUsers: number
      deviceCategories: string[]
      browsers: string[]
    }>([
      { $match: match },
      {
        $group: {
          _id:              '$ip',
          firstSeen:        { $min: '$sessionStartedAt' },
          lastSeen:         { $max: '$lastSeenAt' },
          sessionCount:     { $sum: 1 },
          uniqueUsers:      { $addToSet: '$publicId' },
          deviceCategories: { $addToSet: '$deviceCategory' },
          browsers:         { $addToSet: '$browser' },
        },
      },
      {
        $project: {
          _id:               1,
          firstSeen:         1,
          lastSeen:          1,
          sessionCount:      1,
          uniqueUsers:       { $size: '$uniqueUsers' },
          deviceCategories:  1,
          browsers:          1,
        },
      },
      { $sort: { lastSeen: -1 } },
      { $skip: pagination.skip },
      { $limit: pagination.limit },
    ])

    // Total count for pagination
    const totalResult = await UserSession.aggregate<{ count: number }>([
      { $match: match },
      { $group: { _id: '$ip' } },
      { $count: 'count' },
    ])
    const total = totalResult[0]?.count ?? 0

    // ── Enrich with security events per IP ──────────────────────────────────
    const ips = ipAggregation.map((r) => r._id).filter(Boolean) as string[]

    const securityByIp = await SecurityEvent.aggregate<{
      _id: string
      events: number
      failures: number
      lastEvent: Date
    }>([
      {
        $match: {
          ip: { $in: ips, $ne: null },
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id:       '$ip',
          events:    { $sum: 1 },
          failures:  { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } },
          lastEvent: { $max: '$createdAt' },
        },
      },
    ])

    const securityMap = new Map(securityByIp.map((r) => [r._id, r]))

    const entries = ipAggregation.map((r) => {
      const sec = securityMap.get(r._id ?? '')
      return {
        ip:               r._id,
        firstSeen:        r.firstSeen?.toISOString() ?? null,
        lastSeen:         r.lastSeen?.toISOString() ?? null,
        sessionCount:     r.sessionCount,
        uniqueUsers:       r.uniqueUsers,
        deviceCategories:  r.deviceCategories,
        browsers:          r.browsers,
        securityEvents:    sec?.events ?? 0,
        securityFailures:  sec?.failures ?? 0,
        lastSecurityEvent: sec?.lastEvent?.toISOString() ?? null,
      }
    })

    return NextResponse.json({
      entries,
      total,
      page: pagination.page,
      limit: pagination.limit,
      hasMore: pagination.skip + entries.length < total,
      note: 'IP addresses are never proof of identity. Multiple users can share an IP.',
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
