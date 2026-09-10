import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Draft from '@/models/Draft'

// ─── GET /api/drafts/count ───────────────────────────────────────────────────
// Returns the total number of drafts for the authenticated user.
// Used by the sidebar badge.

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const count = await Draft.countDocuments({ userId })
    return NextResponse.json({ count })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[drafts count GET]', error)
    return NextResponse.json({ error: 'Failed to fetch draft count' }, { status: 500 })
  }
}
