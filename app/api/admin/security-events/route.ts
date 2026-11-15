/**
 * GET /api/admin/security-events
 *
 * Returns security-relevant events: login successes/failures, logouts,
 * session revocations, 2FA changes, password changes, permission denials.
 *
 * Query params
 * ────────────
 * page    — pagination
 * limit   — page size
 * type    — filter by event type (whitelisted)
 * outcome — filter by outcome: 'success' | 'failure' | 'denied'
 * user    — search by publicId (regex-escaped)
 * days    — lookback window (7 | 14 | 30 | 90, default 30)
 *
 * Response: { events, total, page, limit, hasMore, summary }
 *
 * Privacy: never exposes passwords, tokens, session cookies, or raw
 * request bodies.  IP addresses are included (admin-only) but metadata
 * is strictly controlled.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import SecurityEvent, { SECURITY_EVENT_TYPES } from '@/models/SecurityEvent'
import {
  parsePagination,
  parseDateRange,
  escapeRegex,
  whitelisted,
  buildPaginatedResponse,
} from '@/lib/admin-query'

export const dynamic = 'force-dynamic'

const OUTCOMES = ['success', 'failure', 'denied'] as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const pagination = parsePagination(req)
    const { since } = parseDateRange(req)
    const sp = req.nextUrl.searchParams

    // ── Build filter ────────────────────────────────────────────────────────
    const filter: Record<string, unknown> = {
      createdAt: { $gte: since },
    }

    // Event type filter (whitelisted)
    const typeFilter = whitelisted(req, 'type', SECURITY_EVENT_TYPES)
    if (typeFilter) {
      filter.eventType = typeFilter
    }

    // Outcome filter (whitelisted)
    const outcomeFilter = whitelisted(req, 'outcome', OUTCOMES)
    if (outcomeFilter) {
      filter.outcome = outcomeFilter
    }

    // User filter (search by publicId)
    const userSearch = sp.get('user')?.trim()
    if (userSearch) {
      filter.publicId = { $regex: escapeRegex(userSearch), $options: 'i' }
    }

    // ── Query with pagination ──────────────────────────────────────────────
    const [events, total] = await Promise.all([
      SecurityEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      SecurityEvent.countDocuments(filter),
    ])

    // ── Summary stats for the window ────────────────────────────────────────
    const summaryRaw = await SecurityEvent.aggregate<{
      _id: string
      count: number
    }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
    ])
    const summary: Record<string, number> = {}
    for (const r of summaryRaw) {
      summary[r._id] = r.count
    }

    const items = events.map((e) => ({
      id:               e._id.toString(),
      eventType:        e.eventType,
      outcome:          e.outcome,
      publicId:         e.publicId,
      ip:               e.ip,
      deviceCategory:   e.deviceCategory,
      browser:          e.browser,
      correlationId:    e.correlationId,
      metadata:         e.metadata,
      createdAt:        e.createdAt.toISOString(),
    }))

    return NextResponse.json({
      ...buildPaginatedResponse(items, total, pagination),
      summary,
      eventTypes: SECURITY_EVENT_TYPES,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
