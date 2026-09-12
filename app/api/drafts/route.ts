import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Draft from '@/models/Draft'
import type { DraftType } from '@/models/Draft'

// ─── Serialiser ───────────────────────────────────────────────────────────────

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

// ─── GET /api/drafts ──────────────────────────────────────────────────────────
//
// Query params:
//   type   — filter by DraftType
//   q      — search title (case-insensitive substring)
//   sort   — 'updatedAt' | 'createdAt' | 'oldest' (default: updatedAt desc)
//   limit  — max results (default 50, max 200)
//   page   — 1-based page number (default 1)

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') as DraftType | null
    const q = searchParams.get('q')?.trim()
    const sort = searchParams.get('sort') ?? 'updatedAt'
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const skip = (page - 1) * limit

    // Build query — always scope to authenticated user
    const query: Record<string, unknown> = { userId }
    if (type) query.type = type
    if (q) query.title = { $regex: q, $options: 'i' }

    // Sort direction
    let sortField: Record<string, 1 | -1> = { updatedAt: -1 }
    if (sort === 'createdAt') sortField = { createdAt: -1 }
    else if (sort === 'oldest') sortField = { createdAt: 1 }

    const [drafts, total] = await Promise.all([
      Draft.find(query).sort(sortField).skip(skip).limit(limit).lean(),
      Draft.countDocuments(query),
    ])

    return NextResponse.json({
      drafts: drafts.map(serializeDraft),
      total,
      page,
      limit,
      hasMore: skip + drafts.length < total,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[drafts GET]', error)
    return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 })
  }
}

// ─── POST /api/drafts ─────────────────────────────────────────────────────────
//
// Body: { type, title?, data }
// Returns the created draft.
// If a draftId is provided in body, updates that draft instead (upsert pattern
// for preventing duplicates from concurrent autosave calls).

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()

    const { type, title, data, draftId } = body as {
      type: DraftType
      title?: string
      data?: Record<string, unknown>
      draftId?: string
    }

    if (!type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 })
    }

    await connectDB()

    // If caller provides a draftId, verify ownership and update in-place
    // This prevents duplicates when the same form autosaves multiple times.
    if (draftId) {
      const existing = await Draft.findOne({ _id: draftId, userId }).lean()
      if (!existing) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
      }
      const updated = await Draft.findByIdAndUpdate(
        draftId,
        {
          $set: {
            type,
            title: title ?? existing.title,
            data: data ?? existing.data,
          },
        },
        { new: true }
      ).lean()
      return NextResponse.json({ draft: serializeDraft(updated!) })
    }

    // Create new draft
    const draft = await Draft.create({
      userId,
      lifeFlowId,
      type,
      title: title ?? 'Untitled Draft',
      data: data ?? {},
    })

    return NextResponse.json({ draft: serializeDraft(draft) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[drafts POST]', error)
    return NextResponse.json({ error: 'Failed to create draft' }, { status: 500 })
  }
}
