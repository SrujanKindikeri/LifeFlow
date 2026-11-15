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

    const note = await Note.create({ ...parsed.data, userId, lifeFlowId })

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
