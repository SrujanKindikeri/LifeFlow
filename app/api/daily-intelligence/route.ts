/**
 * GET  /api/daily-intelligence
 * POST /api/daily-intelligence
 *
 * GET  — Return the most recent persisted morning briefing for today.
 *         If none exists yet, generates one on demand.
 *         Query param: ?type=morning|evening (default: morning)
 *
 * POST — Manually regenerate the briefing (user-triggered refresh).
 *         Rate-limited: minimum 5 minutes between user-triggered regenerations.
 *         Body: { type?: 'morning' | 'evening' }
 *
 * AUTHENTICATION
 * ──────────────
 * Every request requires a valid session (requireAuth).
 * User isolation enforced by userId in all queries.
 *
 * RATE LIMITING
 * ─────────────
 * Tracked in the DailyBriefing document itself via generatedAt.
 * If the most recent briefing for today was generated less than 5 minutes ago,
 * the POST returns 429. The scheduler (MORNING_INTELLIGENCE / EVENING_INTELLIGENCE)
 * bypasses this check.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import User from '@/models/User'
import DailyBriefingModel from '@/models/DailyBriefing'
import { generateBriefing } from '@/lib/dailyIntelligence/briefingEngine'
import { getLocalDateAndHour } from '@/lib/dailyIntelligence/overdueDetector'
import type { BriefingType } from '@/models/DailyBriefing'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MIN_REFRESH_SECONDS = 5 * 60  // 5 minutes between user-triggered refreshes

// ─── GET — fetch latest briefing ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    await connectDB()

    const type = (req.nextUrl.searchParams.get('type') ?? 'morning') as BriefingType
    if (type !== 'morning' && type !== 'evening') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    // Fetch user timezone and dailyIntelligence settings
    const userDoc = await User.findById(userId)
      .select('timezone dailyIntelligence')
      .lean()
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const timezone = userDoc.timezone ?? 'Asia/Kolkata'
    const { today } = getLocalDateAndHour(new Date(), timezone)

    // Try to find an existing briefing for today
    const existing = await DailyBriefingModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      forDate: today,
      type,
    }).sort({ generatedAt: -1 }).lean()

    if (existing) {
      return NextResponse.json({ briefing: existing, cached: true })
    }

    // No briefing for today yet — generate one on-demand
    const includeFinancial = userDoc.dailyIntelligence?.includeFinancial ?? true
    const { briefing } = await generateBriefing({
      userId,
      lifeFlowId,
      timezone,
      type,
      includeFinancial,
    })

    return NextResponse.json({ briefing, cached: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    logger.error('[daily-intelligence GET]', { errorMessage: msg })
    return NextResponse.json({ error: 'Failed to fetch briefing' }, { status: 500 })
  }
}

// ─── POST — manual refresh ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    await connectDB()

    const body = await req.json().catch(() => ({})) as { type?: string }
    const type = (body.type ?? 'morning') as BriefingType
    if (type !== 'morning' && type !== 'evening') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    // Fetch user settings
    const userDoc = await User.findById(userId)
      .select('timezone dailyIntelligence')
      .lean()
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const timezone = userDoc.timezone ?? 'Asia/Kolkata'
    const { today } = getLocalDateAndHour(new Date(), timezone)

    // ── Rate limiting ──────────────────────────────────────────────────────
    const recent = await DailyBriefingModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      forDate: today,
      type,
    }).sort({ generatedAt: -1 }).select('generatedAt').lean()

    if (recent?.generatedAt) {
      const secondsAgo = (Date.now() - new Date(recent.generatedAt).getTime()) / 1000
      if (secondsAgo < MIN_REFRESH_SECONDS) {
        const retryAfter = Math.ceil(MIN_REFRESH_SECONDS - secondsAgo)
        return NextResponse.json(
          { error: 'Too many refresh requests', retryAfterSeconds: retryAfter },
          {
            status: 429,
            headers: { 'Retry-After': String(retryAfter) },
          }
        )
      }
    }

    // ── Generate ───────────────────────────────────────────────────────────
    const includeFinancial = userDoc.dailyIntelligence?.includeFinancial ?? true
    const { briefing } = await generateBriefing({
      userId,
      lifeFlowId,
      timezone,
      type,
      includeFinancial,
    })

    return NextResponse.json({ briefing, cached: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    logger.error('[daily-intelligence POST]', { errorMessage: msg })
    return NextResponse.json({ error: 'Failed to regenerate briefing' }, { status: 500 })
  }
}
