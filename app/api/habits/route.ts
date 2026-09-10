import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { habitSchema } from '@/lib/validations'
import Habit from '@/models/Habit'

function serializeHabit(h: {
  _id: { toString(): string }
  userId: { toString(): string }
  name: string
  icon: string
  description?: string
  frequency: string
  target: number
  createdAt: Date
  updatedAt: Date
}) {
  return {
    _id: h._id.toString(),
    userId: h.userId.toString(),
    name: h.name,
    icon: h.icon,
    description: h.description,
    frequency: h.frequency,
    target: h.target,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  }
}

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const habits = await Habit.find({ userId }).sort({ createdAt: 1 }).lean()

    return NextResponse.json({ habits: habits.map(serializeHabit) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[habits GET]', error)
    return NextResponse.json({ error: 'Failed to fetch habits' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = habitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const habit = await Habit.create({ ...parsed.data, userId })

    return NextResponse.json({ habit: serializeHabit(habit) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[habits POST]', error)
    return NextResponse.json({ error: 'Failed to create habit' }, { status: 500 })
  }
}
