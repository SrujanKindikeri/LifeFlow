import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Task from '@/models/Task'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    await connectDB()

    // Only allow updating fields that make sense for a PATCH
    const allowedFields = ['completed', 'title', 'description', 'priority', 'dueDate', 'dueTime', 'recurring']
    const update: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) update[key] = body[key]
    }

    // Always filter by userId to prevent unauthorized access
    const task = await Task.findOneAndUpdate(
      { _id: id, userId },
      { $set: update },
      { new: true }
    )

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({
      task: {
        _id: task._id.toString(),
        userId: task.userId.toString(),
        title: task.title,
        description: task.description,
        completed: task.completed,
        priority: task.priority,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        recurring: task.recurring,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[task PATCH]', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
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

    const task = await Task.findOneAndDelete({ _id: id, userId })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Task deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[task DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
