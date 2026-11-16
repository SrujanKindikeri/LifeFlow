import { NextRequest, NextResponse } from 'next/server'
// GET now accepts ?all=true (return everything) or ?archived=true (archived only)
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { noteSchema } from '@/lib/validations'
import Note from '@/models/Note'
import { trackSuccess, trackFailure } from '@/lib/moduleEvents'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const all = searchParams.get('all') === 'true'
    const archivedOnly = searchParams.get('archived') === 'true'

    const query: Record<string, unknown> = { userId }
    if (!all) {
      query.archived = archivedOnly ? true : false
    }

    const notes = await Note.find(query)
      .sort({ pinned: -1, updatedAt: -1 })
      .lean()

    return NextResponse.json({
      notes: notes.map((n) => ({
        _id: n._id.toString(),
        userId: n.userId.toString(),
        title: n.title,
        content: n.content,
        tags: n.tags,
        pinned: n.pinned,
        archived: n.archived,
        projectId: n.projectId ? n.projectId.toString() : null,
        reminderAt: n.reminderAt ? (n.reminderAt instanceof Date ? n.reminderAt.toISOString() : new Date(String(n.reminderAt)).toISOString()) : null,
        reminderSent: n.reminderSent ?? false,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[notes GET]', error)
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  let userId = '', lifeFlowId = ''
  try {
    ;({ userId, lifeFlowId } = await requireAuth())
    const body = await req.json()

    const parsed = noteSchema.safeParse(body)
    if (!parsed.success) {
      trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'validation_failed', httpStatus: 400 },
        new Error(parsed.error.issues[0].message), 400)
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const noteData: Record<string, unknown> = { ...parsed.data, userId, lifeFlowId }
    if (parsed.data.reminderAt) {
      noteData.reminderAt = new Date(parsed.data.reminderAt)
      noteData.reminderSent = false
    } else if (parsed.data.reminderAt === null) {
      noteData.reminderAt = null
      noteData.reminderSent = false
    }

    const note = await Note.create(noteData)

    trackSuccess({ userId, publicId: lifeFlowId, module: 'notes', operation: 'create', httpStatus: 201, durationMs: Date.now() - t0 })

    return NextResponse.json(
      {
        note: {
          _id: note._id.toString(),
          userId: note.userId.toString(),
          title: note.title,
          content: note.content,
          tags: note.tags,
          pinned: note.pinned,
          archived: note.archived,
          projectId: note.projectId ? note.projectId.toString() : null,
          reminderAt: note.reminderAt ? (note.reminderAt instanceof Date ? note.reminderAt.toISOString() : new Date(String(note.reminderAt)).toISOString()) : null,
          reminderSent: note.reminderSent ?? false,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (userId) trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'save_failed', httpStatus: 500 }, error, 500)
    console.error('[notes POST]', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}
