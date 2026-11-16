/**
 * POST /api/module-heartbeat
 *
 * Receives a heartbeat from an authenticated user who is actively viewing
 * a LifeFlow module page. Upserts an ActivityHeartbeat document so that
 * admins can see who is active now, recently active, or inactive.
 *
 * SECURITY
 * ────────
 * • Requires a valid USER session (requireAuth). Admin sessions are rejected.
 * • userId and publicId are derived from the server-verified session —
 *   never from client-supplied values.
 * • Only the module label is accepted from the client; no content or PII.
 *
 * THROTTLING
 * ──────────
 * The client should send heartbeats at a configurable interval
 * (default 60 s, controlled by HEARTBEAT_INTERVAL_SECONDS on the client).
 * The server upsert is idempotent — multiple rapid heartbeats for the same
 * (userId, sessionId) simply update lastSeenAt.
 *
 * MULTI-TAB HANDLING
 * ──────────────────
 * Each browser tab generates its own sessionId (UUID). The unique index on
 * (userId, sessionId) means multiple tabs produce multiple documents, which
 * are distinguishable in the admin dashboard as separate sessions.
 *
 * REQUEST BODY
 * ────────────
 * {
 *   "module":    "notes" | "tasks" | "habits" | "projects" | "expenses" | "subscriptions",
 *   "sessionId": "<uuid>"          // client-generated per tab
 * }
 *
 * RESPONSE
 * ─────────
 * 204 No Content on success — fire-and-forget friendly.
 * 204 on auth failure too — avoids leaking auth state to fire-and-forget callers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth }               from '@/lib/session'
import { connectDB }                 from '@/lib/db'
import ActivityHeartbeat             from '@/models/ActivityHeartbeat'
import type { ModuleName }           from '@/models/ModuleEvent'
import { MODULE_NAMES }              from '@/models/ModuleEvent'
import { upsertSessionFromHeartbeat } from '@/lib/session-tracking'
import mongoose                      from 'mongoose'

export const dynamic = 'force-dynamic'

// ── UUID validation (RFC 4122 v4 format, relaxed) ─────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  let user: { userId: string; lifeFlowId: string }
  try {
    user = await requireAuth()
  } catch {
    // Return 204 even on auth failure to avoid leaking auth state
    return new NextResponse(null, { status: 204 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let moduleRecord: string
  let sessionId: string
  try {
    const body = await req.json()
    moduleRecord = typeof body?.module === 'string' ? body.module.trim() : ''
    sessionId    = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!MODULE_NAMES.includes(moduleRecord as ModuleName)) {
    return new NextResponse(null, { status: 204 })
  }
  if (!UUID_RE.test(sessionId)) {
    return new NextResponse(null, { status: 204 })
  }

  // ── Upsert heartbeat & session telemetry ──────────────────────────────────
  try {
    await connectDB()

    const now = new Date()

    await ActivityHeartbeat.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(user.userId), sessionId },
      {
        $set: {
          module: moduleRecord,
          lastSeenAt: now,
        },
        $setOnInsert: {
          publicId:       user.lifeFlowId,
          sessionStartedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    const sessionResult = await upsertSessionFromHeartbeat({
      userId:   user.userId,
      publicId: user.lifeFlowId,
      sessionId,
      module:   moduleRecord as ModuleName,
      req,
    })

    if (sessionResult.revoked) {
      return new NextResponse(null, { status: 410 })
    }
  } catch (err) {
    // Non-fatal — heartbeat failures must never surface to the user
    const { default: logger } = await import('@/lib/logger')
    logger.warn('[module-heartbeat] Failed to upsert heartbeat', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }

  return new NextResponse(null, { status: 204 })
}
