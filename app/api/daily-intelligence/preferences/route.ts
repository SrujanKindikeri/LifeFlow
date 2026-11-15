/**
 * GET  /api/daily-intelligence/preferences — return current dailyIntelligence prefs
 * PATCH /api/daily-intelligence/preferences — update dailyIntelligence prefs
 *
 * Validated server-side. The timezone used for scheduling is always
 * taken from User.timezone — it is not overridable here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ── HH:MM validation ─────────────────────────────────────────────────────────
function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(t)
}

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const user = await User.findById(userId).select('dailyIntelligence timezone').lean()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json({
      preferences: {
        ...(user.dailyIntelligence ?? {
          enabled: false,
          morningTime: '07:00',
          eveningTime: '19:00',
          emailMorning: false,
          emailEvening: false,
          includeFinancial: true,
        }),
      },
      timezone: user.timezone ?? 'Asia/Kolkata',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    logger.error('[di/preferences GET]', { errorMessage: msg })
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const body = await req.json() as Partial<{
      enabled: boolean
      morningTime: string
      eveningTime: string
      emailMorning: boolean
      emailEvening: boolean
      includeFinancial: boolean
    }>

    // Validate times if provided
    if (body.morningTime !== undefined && !isValidTime(body.morningTime)) {
      return NextResponse.json({ error: 'Invalid morningTime format (expected HH:MM)' }, { status: 400 })
    }
    if (body.eveningTime !== undefined && !isValidTime(body.eveningTime)) {
      return NextResponse.json({ error: 'Invalid eveningTime format (expected HH:MM)' }, { status: 400 })
    }
    if (
      body.morningTime !== undefined &&
      body.eveningTime !== undefined &&
      body.morningTime >= body.eveningTime
    ) {
      return NextResponse.json(
        { error: 'eveningTime must be after morningTime' },
        { status: 400 }
      )
    }

    // Build $set only for provided keys
    const setPayload: Record<string, unknown> = {}
    const allowed = ['enabled', 'morningTime', 'eveningTime', 'emailMorning', 'emailEvening', 'includeFinancial'] as const
    for (const key of allowed) {
      if (body[key] !== undefined) {
        setPayload[`dailyIntelligence.${key}`] = body[key]
      }
    }

    if (Object.keys(setPayload).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: setPayload },
      { returnDocument: 'after', runValidators: false }
    ).select('dailyIntelligence timezone').lean()

    if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json({
      preferences: updated.dailyIntelligence,
      timezone: updated.timezone,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    logger.error('[di/preferences PATCH]', { errorMessage: msg })
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
