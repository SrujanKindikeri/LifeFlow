/**
 * POST /api/admin/sessions/revoke
 *
 * Securely revoke a user session.  Requires admin authorization and
 * explicit confirmation (the client UI must show a confirmation dialog
 * before calling this endpoint).
 *
 * Request body
 * ────────────
 * {
 *   publicId:    string  — the user's LF-XXXXXXXX identifier
 *   sessionId:   string  — the session UUID to revoke
 *   reason?:     string  — optional reason (max 500 chars, sanitized)
 *   allSessions?: boolean — if true, revoke ALL sessions for the user
 * }
 *
 * What revocation does
 * ────────────────────
 *   1. Marks the UserSession as 'revoked' with the admin's ID and reason.
 *   2. Records a SecurityEvent for the audit trail.
 *   3. The heartbeat route detects the 'revoked' status and returns 410,
 *      signaling the client to stop heartbeating.
 *   4. The actual cookie session expires naturally via the idle/absolute
 *      timeout — we do NOT weaken authentication to force immediate logout.
 *
 * Security
 * ────────
 *   • requireRole('admin') — only admins and super_admins can revoke.
 *   • Writes an AuditLog entry recording the admin action.
 *   • Never exposes or modifies session cookies, tokens, or passwords.
 *   • Input is validated and sanitized.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole, handleAdminAuthError, writeAuditLog } from '@/lib/admin-auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { revokeSession, revokeAllUserSessions } from '@/lib/session-tracking'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const admin = await requireRole('admin')
    await connectDB()

    const body = await req.json().catch(() => ({}))
    const publicId = typeof body?.publicId === 'string' ? body.publicId.trim() : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    const allSessions = body?.allSessions === true

    if (!publicId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'publicId is required.' } },
        { status: 400 },
      )
    }

    if (!allSessions && !sessionId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'sessionId is required unless allSessions is true.' } },
        { status: 400 },
      )
    }

    // ── Find user by publicId ──────────────────────────────────────────────
    const user = await User.findOne({ publicId })
      .select('_id publicId name')
      .lean<{ _id: mongoose.Types.ObjectId; publicId: string; name: string } | null>()

    if (!user) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'User not found.' } },
        { status: 404 },
      )
    }

    const userId = user._id.toString()

    // ── Perform revocation ──────────────────────────────────────────────────
    let revokedCount: number

    if (allSessions) {
      revokedCount = await revokeAllUserSessions({
        userId,
        revokedBy: admin.adminId,
        revokeReason: reason,
        adminName: admin.name,
      })
    } else {
      const success = await revokeSession({
        userId,
        sessionId,
        revokedBy: admin.adminId,
        revokeReason: reason,
        adminName: admin.name,
      })
      revokedCount = success ? 1 : 0
    }

    // ── Write audit log ─────────────────────────────────────────────────────
    await writeAuditLog({
      actor: admin,
      action: 'user_session_revoked',
      result: 'success',
      target: { type: 'user', id: publicId },
      metadata: {
        sessionId:   allSessions ? null : sessionId,
        allSessions,
        reason,
        revokedCount,
      },
    })

    return NextResponse.json({
      ok: true,
      revokedCount,
      message: allSessions
        ? `Revoked ${revokedCount} session(s) for ${user.name}.`
        : revokedCount > 0
          ? `Session revoked for ${user.name}.`
          : 'Session not found or already revoked.',
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
