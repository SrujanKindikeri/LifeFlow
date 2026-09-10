import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import HabitLog from '@/models/HabitLog'
import Habit from '@/models/Habit'
import { getTodayString } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const rangeDays = parseInt(searchParams.get('range') || '30', 10)
    const habitId = searchParams.get('habitId')

    // Build date range
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - rangeDays)
    const startStr = startDate.toISOString().split('T')[0]

    const query: Record<string, unknown> = {
      userId,
      completed: true,
      date: { $gte: startStr },
    }
    if (habitId) query.habitId = habitId

    const logs = await HabitLog.find(query).sort({ date: -1 }).lean()

    return NextResponse.json({
      logs: logs.map((l) => ({
        _id: l._id.toString(),
        userId: l.userId.toString(),
        habitId: l.habitId.toString(),
        date: l.date,
        completed: l.completed,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[habit log GET]', error)
    return NextResponse.json({ error: 'Failed to fetch habit logs' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()
    const { habitId, completed = true, date } = body

    if (!habitId) {
      return NextResponse.json({ error: 'habitId is required' }, { status: 400 })
    }

    await connectDB()

    // Verify the habit belongs to the user
    const habit = await Habit.findOne({ _id: habitId, userId })
    if (!habit) {
      return NextResponse.json({ error: 'Habit not found' }, { status: 404 })
    }

    const logDate = date || getTodayString()

    if (!completed) {
      // Remove the log
      await HabitLog.findOneAndDelete({ userId, habitId, date: logDate })
      return NextResponse.json({ message: 'Habit log removed' })
    }

    // Upsert: create or update
    const log = await HabitLog.findOneAndUpdate(
      { userId, habitId, date: logDate },
      { $set: { completed: true } },
      { upsert: true, new: true }
    )

    return NextResponse.json({
      log: {
        _id: log._id.toString(),
        userId: log.userId.toString(),
        habitId: log.habitId.toString(),
        date: log.date,
        completed: log.completed,
        createdAt: log.createdAt.toISOString(),
        updatedAt: log.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[habit log POST]', error)
    return NextResponse.json({ error: 'Failed to log habit' }, { status: 500 })
  }
}
