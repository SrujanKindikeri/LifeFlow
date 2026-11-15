/**
 * POST /api/analytics/track
 *
 * Server-side page-view event recorder.  Called by user-facing page components
 * via a fire-and-forget fetch to record which LifeFlow section a user visited.
 *
 * SECURITY
 * ────────
 * • Requires a valid USER session (requireAuth).  Admin sessions are NOT
 *   accepted here — admins navigating the control panel are not tracked.
 * • Only the section label is recorded — no URL path, query params, or content.
 * • Deduplication key prevents double-counting from React double-renders or
 *   multiple tab refreshes within the same hour bucket.
 * • Duplicate inserts (E11000) are silently ignored — not an error.
 * • Returns 204 No Content on success so callers need not parse the response.
 *
 * REQUEST BODY
 * ────────────
 * { "section": "notes" }     — must be a member of TRACKED_SECTIONS
 *
 * USAGE (in a user-facing page Server Component)
 * ──────────────────────────────────────────────
 * // Fire-and-forget — never await, never surface errors to the user
 * void fetch('/api/analytics/track', {
 *   method:  'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body:    JSON.stringify({ section: 'notes' }),
 * }).catch(() => {})
 *
 * Or from a Client Component using useEffect with a ref guard to fire once:
 * useEffect(() => {
 *   if (tracked.current) return
 *   tracked.current = true
 *   void fetch('/api/analytics/track', { ... })
 * }, [])
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth }               from '@/lib/session'
import { connectDB }                 from '@/lib/db'
import AnalyticsEvent, { TRACKED_SECTIONS } from '@/models/AnalyticsEvent'
import type { TrackedSection }       from '@/models/AnalyticsEvent'
import mongoose                      from 'mongoose'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  let user: { userId: string }
  try {
    user = await requireAuth()
  } catch {
    // Return 204 even on auth failure to avoid leaking auth state to
    // fire-and-forget callers that never check the response.
    return new NextResponse(null, { status: 204 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let section: string
  try {
    const body = await req.json()
    section = typeof body?.section === 'string' ? body.section.trim() : ''
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  // ── Validate section ──────────────────────────────────────────────────────
  if (!TRACKED_SECTIONS.includes(section as TrackedSection)) {
    // Unknown section — silently discard, do not error
    return new NextResponse(null, { status: 204 })
  }

  // ── Build deduplication key ───────────────────────────────────────────────
  const now        = new Date()
  const dateString = now.toISOString().slice(0, 10)   // "YYYY-MM-DD"
  const hour       = now.getUTCHours()
  const key        = `${user.userId}:${section}:${dateString}:${hour}`

  // ── Persist (duplicate silently ignored) ──────────────────────────────────
  try {
    await connectDB()
    await AnalyticsEvent.create({
      userId:     new mongoose.Types.ObjectId(user.userId),
      section:    section as TrackedSection,
      dateString,
      hour,
      key,
    })
  } catch (err) {
    // E11000 duplicate key — normal, ignore
    const mongoCode = (err as { code?: number }).code
    if (mongoCode !== 11000) {
      // Non-duplicate error — log but never surface to caller
      const { default: logger } = await import('@/lib/logger')
      logger.error('[analytics/track] Failed to record event', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return new NextResponse(null, { status: 204 })
}
