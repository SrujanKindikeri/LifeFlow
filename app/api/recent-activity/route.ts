import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import RecentActivity, { type ActivityType, type ActivityAction } from '@/models/RecentActivity'
import mongoose from 'mongoose'

// ─── GET /api/recent-activity ─────────────────────────────────────────────────
// Returns the current user's recent activity for the "Continue" section.

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 20)

    const activities = await RecentActivity.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()

    return NextResponse.json({
      activities: activities.map((a) => ({
        _id: a._id.toString(),
        type: a.type,
        entityId: a.entityId.toString(),
        entityTitle: a.entityTitle,
        action: a.action,
        timestamp: a.timestamp.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[recent-activity GET]', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}

// ─── POST /api/recent-activity ────────────────────────────────────────────────
// Records a meaningful user action.
// Body: { type, entityId, entityTitle, action }
// Deduplication: if an identical (userId, entityId, action) was recorded within
// the last 60 seconds, skip insertion to avoid flooding.

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()
    await connectDB()

    const { type, entityId, entityTitle, action } = body as {
      type: ActivityType
      entityId: string
      entityTitle: string
      action: ActivityAction
    }

    const validTypes: ActivityType[] = ['note', 'task', 'habit', 'expense', 'groupBill']
    const validActions: ActivityAction[] = ['created', 'updated', 'opened', 'completed']

    if (!validTypes.includes(type) || !validActions.includes(action) || !entityId || !entityTitle) {
      return NextResponse.json({ error: 'Invalid activity data' }, { status: 400 })
    }

    // Dedup: skip if identical action on same entity in last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60_000)
    const existing = await RecentActivity.findOne({
      userId,
      entityId: new mongoose.Types.ObjectId(entityId),
      action,
      timestamp: { $gte: oneMinuteAgo },
    })

    if (!existing) {
      await RecentActivity.create({
        userId,
        type,
        entityId: new mongoose.Types.ObjectId(entityId),
        entityTitle: entityTitle.slice(0, 200),
        action,
        timestamp: new Date(),
      })
    }

    // Trim to 50 most recent per user (keep the collection lean)
    const count = await RecentActivity.countDocuments({ userId })
    if (count > 50) {
      const oldest = await RecentActivity.find({ userId })
        .sort({ timestamp: 1 })
        .limit(count - 50)
        .select('_id')
        .lean()
      await RecentActivity.deleteMany({ _id: { $in: oldest.map((a) => a._id) } })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[recent-activity POST]', error)
    return NextResponse.json({ error: 'Failed to record activity' }, { status: 500 })
  }
}
