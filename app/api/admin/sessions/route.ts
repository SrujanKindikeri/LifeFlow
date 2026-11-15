/**
 * GET /api/admin/sessions
 *
 * Searchable, filterable, paginated session table with device intelligence.
 *
 * Query params
 * ────────────
 * page    — pagination (default 1)
 * limit   — page size (1-200, default 25)
 * user    — search by publicId, name, or email (regex-escaped)
 * ip      — filter by IP address (exact or prefix)
 * device  — filter by device category: 'desktop' | 'mobile' | 'tablet' | 'unknown'
 * browser — filter by browser name (e.g. 'Chrome')
 * status  — filter by status: 'active' | 'idle' | 'expired' | 'revoked' | 'logged_out'
 * days    — lookback window (7 | 14 | 30 | 90, default 30)
 *
 * Response: { sessions, total, page, limit, hasMore }
 *
 * Each session includes user display info, device details, IP, timestamps,
 * and computed presence status.  Never exposes session cookies, auth
 * tokens, or passwords.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import UserSession from '@/models/UserSession'
import { resolveSessionStatus } from '@/lib/session-tracking'
import User from '@/models/User'
import mongoose from 'mongoose'
import {
  parsePagination,
  parseDateRange,
  escapeRegex,
  whitelisted,
  buildPaginatedResponse,
} from '@/lib/admin-query'

export const dynamic = 'force-dynamic'

const DEVICE_CATEGORIES = ['desktop', 'mobile', 'tablet', 'unknown'] as const
const SESSION_STATUSES = ['active', 'idle', 'expired', 'revoked', 'logged_out'] as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()

    const pagination = parsePagination(req)
    const { since } = parseDateRange(req)

    const sp = req.nextUrl.searchParams

    // ── Build filter (all inputs sanitized) ────────────────────────────────
    const filter: Record<string, unknown> = {
      lastSeenAt: { $gte: since },
    }

    // User search (publicId, name, or email) — requires a join, so we look
    // up matching user IDs first and filter by userId $in
    const userSearch = sp.get('user')?.trim()
    if (userSearch) {
      const escaped = escapeRegex(userSearch)
      const matchingUsers = await User.find({
        $or: [
          { publicId: { $regex: escaped, $options: 'i' } },
          { name: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
        ],
      })
        .select('_id')
        .lean<{ _id: mongoose.Types.ObjectId }[]>()

      if (matchingUsers.length === 0) {
        // No matching users → empty result
        return NextResponse.json(buildPaginatedResponse([], 0, pagination))
      }

      filter.userId = {
        $in: matchingUsers.map((u) => u._id),
      }
    }

    // IP filter
    const ipFilter = sp.get('ip')?.trim()
    if (ipFilter) {
      filter.ip = { $regex: escapeRegex(ipFilter), $options: 'i' }
    }

    // Device category filter (whitelisted)
    const deviceFilter = whitelisted(req, 'device', DEVICE_CATEGORIES)
    if (deviceFilter) {
      filter.deviceCategory = deviceFilter
    }

    // Browser filter
    const browserFilter = sp.get('browser')?.trim()
    if (browserFilter) {
      filter.browser = { $regex: escapeRegex(browserFilter), $options: 'i' }
    }

    // Status filter — for stored terminal statuses
    const statusFilter = whitelisted(req, 'status', SESSION_STATUSES)
    if (statusFilter === 'revoked') {
      filter.status = 'revoked'
    } else if (statusFilter === 'logged_out') {
      filter.status = 'logged_out'
    }

    // ── Query with pagination ───────────────────────────────────────────────
    const [sessions, total] = await Promise.all([
      UserSession.find(filter)
        .sort({ lastSeenAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      UserSession.countDocuments(filter),
    ])

    // ── Enrich with user display info ──────────────────────────────────────
    const userIds = [...new Set(sessions.map((s) => s.userId.toString()))]
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .select('publicId name email accountStatus')
          .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string; email: string; accountStatus?: string }[]>()
      : []

    const userMap = new Map(users.map((u) => [u._id.toString(), u]))

    const now = new Date()
    const items = sessions.map((s) => {
      const userDoc = userMap.get(s.userId.toString())
      const display = resolveSessionStatus(s.status, s.lastSeenAt, now)

      // Apply time-based status filter
      if (statusFilter === 'active' && display.status !== 'active') return null
      if (statusFilter === 'idle' && display.status !== 'idle') return null
      if (statusFilter === 'expired' && display.status !== 'expired') return null

      return {
        sessionId:          s.sessionId,
        publicId:           s.publicId,
        name:               userDoc?.name ?? 'Unknown',
        email:              userDoc?.email ?? '',
        accountStatus:      userDoc?.accountStatus ?? 'active',
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
        revokedBy:          s.revokedBy ?? null,
        revokeReason:       s.revokeReason ?? null,
        loggedOutAt:        s.loggedOutAt?.toISOString() ?? null,
      }
    }).filter(Boolean)

    // Recount for time-based status filters (the stored status differs)
    if (statusFilter && ['active', 'idle', 'expired'].includes(statusFilter)) {
      return NextResponse.json({
        items,
        total: items.length,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: false,
      })
    }

    return NextResponse.json(buildPaginatedResponse(items, total, pagination))
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
