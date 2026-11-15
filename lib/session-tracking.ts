/**
 * lib/session-tracking.ts — Shared helpers for the session monitoring system.
 *
 * Centralizes the logic for:
 *   • Creating / updating UserSession records from heartbeats
 *   • Computing presence states (active / idle / expired)
 *   • Revoking sessions (secure server-side action)
 *   • Marking sessions as logged out
 *
 * All functions are non-fatal — telemetry failures never block normal
 * LifeFlow features.  They are called fire-and-forget from route handlers.
 */

import type { NextRequest } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { resolveClientIp, isValidIp } from '@/lib/ip'
import { parseUserAgent } from '@/lib/useragent'
import UserSession, { computePresenceStatus } from '@/models/UserSession'
import type { ModuleName } from '@/models/ModuleEvent'

/** Ensure DB is connected, skipping env validation if already connected. */
async function ensureConnected(): Promise<void> {
  if (mongoose.connection.readyState === 1) return
  await connectDB()
}

// ── Upsert a UserSession from a heartbeat ────────────────────────────────────

/**
 * Create or update a UserSession record from an incoming heartbeat.
 *
 * Called by the heartbeat route after the session is authenticated.
 * This captures the IP and device info from the request and upserts
 * the UserSession document alongside the ActivityHeartbeat.
 *
 * Non-fatal: errors are caught and logged, never propagated.
 *
 * @returns The updated UserSession document (or null on failure), and
 *          whether the session is currently revoked.
 */
export async function upsertSessionFromHeartbeat(params: {
  userId:     string
  publicId:   string
  sessionId:  string
  module:     ModuleName
  req:        NextRequest
}): Promise<{ revoked: boolean }> {
  try {
    await ensureConnected()

    const now = new Date()

    // ── Resolve IP (trusted-proxy-aware) ────────────────────────────────────
    const ipResult = resolveClientIp(params.req)
    const ip = isValidIp(ipResult.ip) ? ipResult.ip : null
    const ipSource = ipResult.source

    // ── Parse User-Agent (safe, non-fatal) ──────────────────────────────────
    const rawUa = params.req.headers.get('user-agent')
    const parsed = parseUserAgent(rawUa)

    // ── Check if session is already revoked ─────────────────────────────────
    const existing = await UserSession.findOne(
      {
        userId: new mongoose.Types.ObjectId(params.userId),
        sessionId: params.sessionId,
      },
      { status: 1 },
    ).lean<{ status: string } | null>()

    if (existing?.status === 'revoked') {
      // Session is revoked — don't update it, signal revocation
      return { revoked: true }
    }

    // ── Upsert UserSession ─────────────────────────────────────────────────
    await UserSession.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(params.userId), sessionId: params.sessionId },
      {
        $set: {
          ip,
          ipSource,
          browser:        parsed.browser,
          browserVersion:  parsed.browserVersion,
          os:             parsed.os,
          osVersion:      parsed.osVersion,
          deviceCategory:  parsed.deviceCategory,
          lastModule:      params.module,
          lastSeenAt:     now,
          // Reset to 'active' — the time-based status will be recomputed
          // by the admin API at read time using computePresenceStatus.
          // Only override if it was previously 'idle' or 'expired' —
          // never override 'revoked' or 'logged_out' (those are terminal).
          status: 'active',
        },
        $setOnInsert: {
          publicId:         params.publicId,
          sessionStartedAt: now,
        },
      },
    { upsert: true, returnDocument: 'after' },
    )

    return { revoked: false }
  } catch (err) {
    // Non-fatal — telemetry failures must never surface to the user
    const logger = (await import('@/lib/logger')).default
    logger.warn('[session-tracking] Failed to upsert session', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return { revoked: false }
  }
}

// ── Revoke a session ─────────────────────────────────────────────────────────

/**
 * Revoke a specific user session by (userId, sessionId).
 *
 * This is a SECURE SERVER-SIDE ACTION — only called from admin API routes
 * after requireAdmin() has verified the caller is an authorized admin.
 *
 * What revocation does:
 *   1. Marks the UserSession as 'revoked' with the revoking admin's ID.
 *   2. Records a SecurityEvent for the audit trail.
 *   3. The heartbeat route will stop updating this session (it detects
 *      the 'revoked' status and returns 410 Gone).
 *   4. The actual cookie session expires naturally via the idle/absolute
 *      timeout mechanism — we do not weaken authentication to force it.
 *
 * @returns true if the session was found and revoked, false if not found.
 */
export async function revokeSession(params: {
  userId:       string
  sessionId:    string
  revokedBy:    string  // adminId
  revokeReason?: string
  adminName?:    string  // for SecurityEvent metadata
}): Promise<boolean> {
  await ensureConnected()

  const result = await UserSession.findOneAndUpdate(
    {
      userId: new mongoose.Types.ObjectId(params.userId),
      sessionId: params.sessionId,
    },
    {
      $set: {
        status:       'revoked',
        revokedAt:    new Date(),
        revokedBy:    params.revokedBy,
        revokeReason: (params.revokeReason ?? '').slice(0, 500) || null,
      },
    },
    { returnDocument: 'after' },
  ).lean<{ publicId: string | null } | null>()

  if (!result) return false

  // Record security event (non-fatal)
  const { recordSecurityEvent } = await import('@/models/SecurityEvent')
  void recordSecurityEvent({
    userId:    params.userId,
    publicId:  result.publicId ?? null,
    eventType:  'session_revoked',
    outcome:    'success',
    metadata: {
      sessionId:    params.sessionId,
      revokedBy:    params.revokedBy,
      adminName:     params.adminName ?? null,
      revokeReason: params.revokeReason ?? null,
    },
  })

  return true
}

// ── Revoke all sessions for a user ───────────────────────────────────────────

/**
 * Revoke ALL active/idle sessions for a user (force logout all devices).
 *
 * @returns number of sessions revoked.
 */
export async function revokeAllUserSessions(params: {
  userId:       string
  revokedBy:    string
  revokeReason?: string
  adminName?:    string
}): Promise<number> {
  await ensureConnected()

  const now = new Date()

  const result = await UserSession.updateMany(
    {
      userId: new mongoose.Types.ObjectId(params.userId),
      status: { $in: ['active', 'idle', 'expired'] },
    },
    {
      $set: {
        status:       'revoked',
        revokedAt:    now,
        revokedBy:    params.revokedBy,
        revokeReason: (params.revokeReason ?? '').slice(0, 500) || null,
      },
    },
  )

  if (result.modifiedCount > 0) {
    const { recordSecurityEvent } = await import('@/models/SecurityEvent')
    void recordSecurityEvent({
      userId:    params.userId,
      eventType:  'session_revoked',
      outcome:    'success',
      metadata: {
        allSessions:  true,
        count:        result.modifiedCount,
        revokedBy:    params.revokedBy,
        adminName:     params.adminName ?? null,
        revokeReason: params.revokeReason ?? null,
      },
    })
  }

  return result.modifiedCount
}

// ── Mark a session as logged out ─────────────────────────────────────────────

/**
 * Mark a specific session as 'logged_out' when the user explicitly logs out.
 * Called from the logout route (non-fatal).
 */
export async function markSessionLoggedOut(userId: string, sessionId?: string): Promise<void> {
  if (!sessionId) return
  try {
    await ensureConnected()
    await UserSession.updateOne(
      {
        userId: new mongoose.Types.ObjectId(userId),
        sessionId,
      },
      {
        $set: {
          status:     'logged_out',
          loggedOutAt: new Date(),
        },
      },
    )
  } catch {
    // Non-fatal
  }
}

// ── Resolve effective status for display ──────────────────────────────────────

export interface SessionDisplayStatus {
  status: 'active' | 'idle' | 'expired' | 'revoked' | 'logged_out'
  estimated: boolean
}

/**
 * Compute the display status of a session, accounting for both stored
 * terminal states (revoked, logged_out) and time-based estimation
 * (active, idle, expired).
 *
 * @param storedStatus  The status field stored in the document.
 * @param lastSeenAt     The lastSeenAt timestamp.
 * @param now            Current time (injectable for tests).
 */
export function resolveSessionStatus(
  storedStatus: string,
  lastSeenAt: Date | null,
  now: Date = new Date(),
): SessionDisplayStatus {
  // Terminal states take precedence — they are not time-based estimates
  if (storedStatus === 'revoked') return { status: 'revoked', estimated: false }
  if (storedStatus === 'logged_out') return { status: 'logged_out', estimated: false }

  // Time-based states are always estimates — the browser may have closed
  // without sending a logout signal.
  const computed = computePresenceStatus(lastSeenAt, now)
  return { status: computed, estimated: true }
}
