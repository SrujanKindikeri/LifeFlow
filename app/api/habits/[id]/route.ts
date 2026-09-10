import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { habitSchema } from '@/lib/validations'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const parsed = habitSchema.partial().safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const habit = await Habit.findOneAndUpdate(
      { _id: id, userId },
      { $set: parsed.data },
      { new: true }
    )

    if (!habit) {
      return NextResponse.json({ error: 'Habit not found' }, { status: 404 })
    }

    return NextResponse.json({
      habit: {
        _id: habit._id.toString(),
        userId: habit.userId.toString(),
        name: habit.name,
        icon: habit.icon,
        description: habit.description,
        frequency: habit.frequency,
        target: habit.target,
        createdAt: habit.createdAt.toISOString(),
        updatedAt: habit.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[habit PATCH]', error)
    return NextResponse.json({ error: 'Failed to update habit' }, { status: 500 })
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

    const habit = await Habit.findOneAndDelete({ _id: id, userId })
    if (!habit) {
      return NextResponse.json({ error: 'Habit not found' }, { status: 404 })
    }

    // Also remove all logs for this habit (cascading delete)
    await HabitLog.deleteMany({ habitId: id, userId })

    return NextResponse.json({ message: 'Habit deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[habit DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete habit' }, { status: 500 })
  }
}
