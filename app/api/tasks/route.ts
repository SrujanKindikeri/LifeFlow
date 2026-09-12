import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { taskSchema } from '@/lib/validations'
import Task from '@/models/Task'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const completed = searchParams.get('completed')

    const query: Record<string, unknown> = { userId }
    if (date) query.dueDate = date
    if (completed !== null) query.completed = completed === 'true'

    const tasks = await Task.find(query).sort({ priority: -1, createdAt: -1 }).lean()

    return NextResponse.json({
      tasks: tasks.map((t) => ({
        _id: t._id.toString(),
        userId: t.userId.toString(),
        title: t.title,
        description: t.description,
        completed: t.completed,
        priority: t.priority,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        recurring: t.recurring,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[tasks GET]', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()

    const parsed = taskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const task = await Task.create({ ...parsed.data, userId, lifeFlowId })

    return NextResponse.json(
      {
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
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[tasks POST]', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
