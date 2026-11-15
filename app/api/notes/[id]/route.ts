import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { noteSchema } from '@/lib/validations'
import Note from '@/models/Note'
import { trackSuccess, trackFailure } from '@/lib/moduleEvents'

function serializeNote(n: {
  _id: { toString(): string }
  userId: { toString(): string }
  title: string
  content: string
  tags: string[]
  pinned: boolean
  archived: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    _id: n._id.toString(),
    userId: n.userId.toString(),
    title: n.title,
    content: n.content,
    tags: n.tags,
    pinned: n.pinned,
    archived: n.archived,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const note = await Note.findOne({ _id: id, userId }).lean()
    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    return NextResponse.json({ note: serializeNote(note) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[note GET]', error)
    return NextResponse.json({ error: 'Failed to fetch note' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t0 = Date.now()
  let userId = '', lifeFlowId = ''
  try {
    ;({ userId, lifeFlowId } = await requireAuth())
    const { id } = await params
    const body = await req.json()

    const parsed = noteSchema.partial().safeParse(body)
    if (!parsed.success) {
      trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'validation_failed', httpStatus: 400 },
        new Error(parsed.error.issues[0].message), 400)
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const note = await Note.findOneAndUpdate(
      { _id: id, userId },
      { $set: parsed.data },
      { returnDocument: 'after' }
    )

    if (!note) {
      trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'save_failed', httpStatus: 404 },
        new Error('Note not found'), 404)
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    // Detect archive toggle vs regular update
    const operation = parsed.data.archived !== undefined ? 'archive' : 'update'
    trackSuccess({ userId, publicId: lifeFlowId, module: 'notes', operation, httpStatus: 200, durationMs: Date.now() - t0 })

    return NextResponse.json({ note: serializeNote(note) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (userId) trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'save_failed', httpStatus: 500 }, error, 500)
    console.error('[note PATCH]', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const t0 = Date.now()
  let userId = '', lifeFlowId = ''
  try {
    ;({ userId, lifeFlowId } = await requireAuth())
    const { id } = await params
    await connectDB()

    const note = await Note.findOneAndDelete({ _id: id, userId })
    if (!note) {
      trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'save_failed', httpStatus: 404 },
        new Error('Note not found'), 404)
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    trackSuccess({ userId, publicId: lifeFlowId, module: 'notes', operation: 'delete', httpStatus: 200, durationMs: Date.now() - t0 })
    return NextResponse.json({ message: 'Note deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (userId) trackFailure({ userId, publicId: lifeFlowId, module: 'notes', operation: 'save_failed', httpStatus: 500 }, error, 500)
    console.error('[note DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}
