import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Project from '@/models/Project'
import Task from '@/models/Task'
import Note from '@/models/Note'
import Goal from '@/models/Goal'
import Activity from '@/models/Activity'
import { z } from 'zod'

const updateSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status:      z.enum(['active','on_hold','completed','archived']).optional(),
  dueDate:     z.string().optional(),
  color:       z.string().max(7).optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const project = await Project.findOne({ _id: id, userId }).lean()
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const [tasks, notes, goals] = await Promise.all([
      Task.find({ userId, projectId: id }).sort({ createdAt: -1 }).lean(),
      Note.find({ userId, projectId: id }).sort({ updatedAt: -1 }).lean(),
      Goal.find({ userId, projectId: id }).sort({ createdAt: -1 }).lean(),
    ])

    return NextResponse.json({
      project: {
        _id:         project._id.toString(),
        userId:      project.userId.toString(),
        title:       project.title,
        description: project.description,
        status:      project.status,
        dueDate:     project.dueDate,
        color:       project.color,
        createdAt:   project.createdAt.toISOString(),
        updatedAt:   project.updatedAt.toISOString(),
      },
      tasks: tasks.map((t) => ({
        _id:         t._id.toString(),
        title:       t.title,
        completed:   t.completed,
        priority:    t.priority,
        dueDate:     t.dueDate,
      })),
      notes: notes.map((n) => ({
        _id:       n._id.toString(),
        title:     n.title,
        content:   n.content.slice(0, 200),
        updatedAt: n.updatedAt.toISOString(),
      })),
      goals: goals.map((g) => ({
        _id:          g._id.toString(),
        title:        g.title,
        description:  g.description,
        category:     g.category,
        targetValue:  g.targetValue,
        currentValue: g.currentValue,
        unit:         g.unit,
        startDate:    g.startDate,
        targetDate:   g.targetDate,
        status:       g.status,
        projectId:    id,
        linkedTaskIds:  (g.linkedTaskIds ?? []).map((i: { toString(): string }) => i.toString()),
        linkedHabitIds: (g.linkedHabitIds ?? []).map((i: { toString(): string }) => i.toString()),
        createdAt:    g.createdAt.toISOString(),
        updatedAt:    g.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[project GET]', error)
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
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

    const project = await Project.findOneAndUpdate(
      { _id: id, userId },
      { $set: parsed.data },
      { new: true }
    )

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (parsed.data.status === 'completed') {
      await Activity.create({
        userId,
        type: 'project_completed',
        referenceId: project._id,
        title: `Completed project: ${project.title}`,
      })
    }

    return NextResponse.json({
      project: {
        _id:         project._id.toString(),
        title:       project.title,
        description: project.description,
        status:      project.status,
        dueDate:     project.dueDate,
        color:       project.color,
        updatedAt:   project.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[project PATCH]', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
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

    const project = await Project.findOneAndDelete({ _id: id, userId })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Unlink tasks, notes, and goals (don't delete them)
    await Promise.all([
      Task.updateMany({ userId, projectId: id }, { $unset: { projectId: '' } }),
      Note.updateMany({ userId, projectId: id }, { $unset: { projectId: '' } }),
      Goal.updateMany({ userId, projectId: id }, { $set: { projectId: null } }),
    ])

    return NextResponse.json({ message: 'Project deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[project DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
