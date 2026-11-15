/**
 * GET /api/daily-intelligence/history
 *
 * Returns paginated briefing history for the authenticated user.
 * Supports filtering by type (morning | evening | all).
 *
 * Query params:
 *   type    = 'morning' | 'evening' | 'all'  (default: 'all')
 *   page    = positive integer               (default: 1)
 *   limit   = 1–30                           (default: 14)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import mongoose from 'mongoose'
import DailyBriefingModel from '@/models/DailyBriefing'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const typeParam = searchParams.get('type') ?? 'all'
    const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit     = Math.min(30, Math.max(1, parseInt(searchParams.get('limit') ?? '14', 10)))
    const skip      = (page - 1) * limit

    // Build query filter
    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    }
    if (typeParam === 'morning' || typeParam === 'evening') {
      filter.type = typeParam
    }

    const [total, briefings] = await Promise.all([
      DailyBriefingModel.countDocuments(filter),
      DailyBriefingModel.find(filter)
        .sort({ generatedAt: -1 })
        .skip(skip)
        .limit(limit)
        // Only return metadata + summary fields — not the full content
        // to keep the history list payload small.
        .select('type forDate generatedAt hasContent dataSources generationMs')
        .lean(),
    ])

    return NextResponse.json({
      briefings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: skip + briefings.length < total,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    logger.error('[daily-intelligence/history GET]', { errorMessage: msg })
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
