import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Activity from '@/models/Activity'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const type = searchParams.get('type')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const skip = (page - 1) * limit

    const query: Record<string, unknown> = { userId }
    if (type) query.type = type

    const [activities, total] = await Promise.all([
      Activity.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Activity.countDocuments(query),
    ])

    return NextResponse.json({
      activities: activities.map((a) => ({
        _id:         a._id.toString(),
        type:        a.type,
        referenceId: a.referenceId?.toString(),
        title:       a.title,
        metadata:    a.metadata,
        createdAt:   a.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      hasMore: skip + activities.length < total,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[activity GET]', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}
