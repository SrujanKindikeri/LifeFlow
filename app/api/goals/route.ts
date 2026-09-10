import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Goal from '@/models/Goal'
import Activity from '@/models/Activity'
import { z } from 'zod'
import mongoose from 'mongoose'

const goalSchema = z.object({
  title:          z.string().min(1, 'Title is required').max(200),
  description:    z.string().max(1000).optional(),
  category:       z.enum(['health','finance','education','career','personal','fitness','creative','other']).default('personal'),
  targetValue:    z.number().min(0, 'Target must be non-negative'),
  currentValue:   z.number().min(0).default(0),
  unit:           z.string().max(50).default('units'),
  startDate:      z.string().min(1, 'Start date is required'),
  targetDate:     z.string().optional(),
  projectId:      z.string().optional(),
  linkedTaskIds:  z.array(z.string()).default([]),
  linkedHabitIds: z.array(z.string()).default([]),
})

function serialize(g: InstanceType<typeof Goal>) {
  return {
    _id:            g._id.toString(),
    userId:         g.userId.toString(),
    projectId:      g.projectId ? g.projectId.toString() : null,
    title:          g.title,
    description:    g.description,
    category:       g.category,
    targetValue:    g.targetValue,
    currentValue:   g.currentValue,
    unit:           g.unit,
    startDate:      g.startDate,
    targetDate:     g.targetDate,
    status:         g.status,
    linkedTaskIds:  g.linkedTaskIds.map((id) => id.toString()),
    linkedHabitIds: g.linkedHabitIds.map((id) => id.toString()),
    createdAt:      g.createdAt.toISOString(),
    updatedAt:      g.updatedAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const status    = searchParams.get('status')
    const projectId = searchParams.get('projectId')

    const query: Record<string, unknown> = { userId }
    if (status && ['active', 'completed', 'archived'].includes(status)) {
      query.status = status
    }
    // 'none' means explicitly standalone (no project); any other value filters by that projectId
    if (projectId === 'none') {
      query.projectId = null
    } else if (projectId) {
      query.projectId = projectId
    }

    const goals = await Goal.find(query).sort({ createdAt: -1 }).lean()
    return NextResponse.json({ goals: goals.map(serialize as (g: unknown) => ReturnType<typeof serialize>) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[goals GET]', error)
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = goalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { linkedTaskIds, linkedHabitIds, projectId, ...rest } = parsed.data

    await connectDB()

    const goal = await Goal.create({
      userId,
      ...rest,
      ...(projectId ? { projectId: new mongoose.Types.ObjectId(projectId) } : {}),
      linkedTaskIds:  linkedTaskIds.map((id) => new mongoose.Types.ObjectId(id)),
      linkedHabitIds: linkedHabitIds.map((id) => new mongoose.Types.ObjectId(id)),
      status: 'active',
    })

    // Activity
    await Activity.create({
      userId,
      type: 'goal_created',
      referenceId: goal._id,
      title: `Created goal: ${goal.title}`,
    })

    return NextResponse.json({ goal: serialize(goal) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[goals POST]', error)
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 })
  }
}
