import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Goal from '@/models/Goal'
import Activity from '@/models/Activity'
import { z } from 'zod'
import mongoose from 'mongoose'

const updateSchema = z.object({
  title:          z.string().min(1).max(200).optional(),
  description:    z.string().max(1000).optional(),
  category:       z.enum(['health','finance','education','career','personal','fitness','creative','other']).optional(),
  targetValue:    z.number().min(0).optional(),
  currentValue:   z.number().min(0).optional(),
  unit:           z.string().max(50).optional(),
  startDate:      z.string().optional(),
  targetDate:     z.string().optional(),
  status:         z.enum(['active','completed','archived']).optional(),
  // null = remove from project (make standalone); string = move to that project
  projectId:      z.string().nullable().optional(),
  linkedTaskIds:  z.array(z.string()).optional(),
  linkedHabitIds: z.array(z.string()).optional(),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const update: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.linkedTaskIds) {
      update.linkedTaskIds = parsed.data.linkedTaskIds.map((i) => new mongoose.Types.ObjectId(i))
    }
    if (parsed.data.linkedHabitIds) {
      update.linkedHabitIds = parsed.data.linkedHabitIds.map((i) => new mongoose.Types.ObjectId(i))
    }
    // Handle projectId: null = unlink, string = link to project
    if ('projectId' in parsed.data) {
      update.projectId = parsed.data.projectId
        ? new mongoose.Types.ObjectId(parsed.data.projectId)
        : null
    }

    const goal = await Goal.findOneAndUpdate(
      { _id: id, userId },
      { $set: update },
      { new: true }
    )

    if (!goal) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    }

    // Activity for status changes
    if (parsed.data.status === 'completed') {
      await Activity.create({
        userId,
        type: 'goal_completed',
        referenceId: goal._id,
        title: `Completed goal: ${goal.title}`,
      })
    } else if (parsed.data.currentValue !== undefined) {
      await Activity.create({
        userId,
        type: 'goal_updated',
        referenceId: goal._id,
        title: `Updated progress on: ${goal.title}`,
        metadata: { currentValue: parsed.data.currentValue, targetValue: goal.targetValue },
      })
    }

    return NextResponse.json({ goal: serialize(goal) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[goal PATCH]', error)
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    await connectDB()
    const goal = await Goal.findOneAndDelete({ _id: id, userId })
    if (!goal) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Goal deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[goal DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 })
  }
}
