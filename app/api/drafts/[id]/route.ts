import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Draft from '@/models/Draft'

function serializeDraft(d: {
  _id: { toString(): string }
  userId: { toString(): string }
  type: string
  title: string
  data: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}) {
  return {
    _id: d._id.toString(),
    userId: d.userId.toString(),
    type: d.type,
    title: d.title,
    data: d.data,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

// ─── GET /api/drafts/[id] ────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    // Always filter by userId — never expose another user's draft
    const draft = await Draft.findOne({ _id: id, userId }).lean()
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    return NextResponse.json({ draft: serializeDraft(draft) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[drafts GET id]', error)
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 })
  }
}

// ─── PATCH /api/drafts/[id] ──────────────────────────────────────────────────
//
// Body: { title?, data?, type? }
// Partial update — merges data with existing data.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    await connectDB()

    // Verify ownership before any mutation
    const existing = await Draft.findOne({ _id: id, userId }).lean()
    if (!existing) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    const updateFields: Record<string, unknown> = {}
    if (body.title !== undefined) updateFields.title = body.title
    if (body.type  !== undefined) updateFields.type  = body.type
    if (body.data  !== undefined) {
      // Merge new data on top of existing — preserves fields not sent in this request
      updateFields.data = { ...(existing.data as Record<string, unknown>), ...body.data }
    }

    const updated = await Draft.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    ).lean()

    return NextResponse.json({ draft: serializeDraft(updated!) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[drafts PATCH id]', error)
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 })
  }
}

// ─── DELETE /api/drafts/[id] ─────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    // Always include userId in the delete filter — ownership check + delete in one query
    const result = await Draft.deleteOne({ _id: id, userId })
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[drafts DELETE id]', error)
    return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 })
  }
}
