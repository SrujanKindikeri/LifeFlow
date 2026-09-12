import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Project from '@/models/Project'
import Task from '@/models/Task'
import Note from '@/models/Note'
import Activity from '@/models/Activity'
import { z } from 'zod'

const projectSchema = z.object({
  title:       z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  status:      z.enum(['active','on_hold','completed','archived']).default('active'),
  dueDate:     z.string().optional(),
  color:       z.string().max(7).default('#3b82f6'),
})

function serialize(p: InstanceType<typeof Project>, taskCount = 0, completedTaskCount = 0, noteCount = 0) {
  return {
    _id:                  p._id.toString(),
    userId:               p.userId.toString(),
    title:                p.title,
    description:          p.description,
    status:               p.status,
    dueDate:              p.dueDate,
    color:                p.color,
    taskCount,
    completedTaskCount,
    noteCount,
    createdAt:            p.createdAt.toISOString(),
    updatedAt:            p.updatedAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const status = searchParams.get('status')

    const query: Record<string, unknown> = { userId }
    if (status && ['active', 'on_hold', 'completed', 'archived'].includes(status)) {
      query.status = status
    }

    const projects = await Project.find(query).sort({ createdAt: -1 }).lean()

    if (projects.length === 0) {
      return NextResponse.json({ projects: [] })
    }

    const projectIds = projects.map((p) => p._id)

    // Fetch task/note counts in parallel
    const [taskCounts, completedTaskCounts, noteCounts] = await Promise.all([
      Task.aggregate([
        { $match: { userId: projects[0].userId, projectId: { $in: projectIds } } },
        { $group: { _id: '$projectId', count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: { userId: projects[0].userId, projectId: { $in: projectIds }, completed: true } },
        { $group: { _id: '$projectId', count: { $sum: 1 } } },
      ]),
      Note.aggregate([
        { $match: { userId: projects[0].userId, projectId: { $in: projectIds } } },
        { $group: { _id: '$projectId', count: { $sum: 1 } } },
      ]),
    ])

    const taskMap = new Map(taskCounts.map((r: { _id: unknown; count: number }) => [r._id?.toString(), r.count]))
    const completedMap = new Map(completedTaskCounts.map((r: { _id: unknown; count: number }) => [r._id?.toString(), r.count]))
    const noteMap = new Map(noteCounts.map((r: { _id: unknown; count: number }) => [r._id?.toString(), r.count]))

    const serialized = projects.map((p) => {
      const pid = p._id.toString()
      return serialize(
        p as unknown as InstanceType<typeof Project>,
        taskMap.get(pid) ?? 0,
        completedMap.get(pid) ?? 0,
        noteMap.get(pid) ?? 0
      )
    })

    return NextResponse.json({ projects: serialized })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[projects GET]', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()

    const parsed = projectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const project = await Project.create({ userId, lifeFlowId, ...parsed.data })

    await Activity.create({
      userId,
      lifeFlowId,
      type: 'project_created',
      referenceId: project._id,
      title: `Created project: ${project.title}`,
    })

    return NextResponse.json({ project: serialize(project) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[projects POST]', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
