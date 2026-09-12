import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import DashboardPreference, { DEFAULT_SECTIONS, type DashboardSectionId } from '@/models/DashboardPreference'

// ─── GET /api/dashboard/preferences ──────────────────────────────────────────
// Returns the current user's dashboard section preferences.
// Falls back to DEFAULT_SECTIONS if no preference doc exists yet.

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const pref = await DashboardPreference.findOne({ userId }).lean()
    const sections = pref ? pref.sections : DEFAULT_SECTIONS

    return NextResponse.json({ sections })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[dashboard/preferences GET]', error)
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 })
  }
}

// ─── PUT /api/dashboard/preferences ──────────────────────────────────────────
// Upserts the user's dashboard section preferences.
// Body: { sections: [{ id, visible, order }] }

export async function PUT(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()
    await connectDB()

    const { sections } = body as {
      sections: { id: DashboardSectionId; visible: boolean; order: number }[]
    }

    if (!Array.isArray(sections) || sections.length === 0) {
      return NextResponse.json({ error: 'sections array is required' }, { status: 400 })
    }

    // Validate each section entry
    const validIds = new Set(DEFAULT_SECTIONS.map((s) => s.id))
    for (const s of sections) {
      if (!validIds.has(s.id)) {
        return NextResponse.json({ error: `Invalid section id: ${s.id}` }, { status: 400 })
      }
      if (typeof s.visible !== 'boolean' || typeof s.order !== 'number') {
        return NextResponse.json({ error: 'Each section must have visible (boolean) and order (number)' }, { status: 400 })
      }
    }

    const pref = await DashboardPreference.findOneAndUpdate(
      { userId },
      {
        $set: { sections },
        $setOnInsert: { lifeFlowId },
      },
      { upsert: true, new: true }
    ).lean()

    return NextResponse.json({ sections: pref!.sections })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[dashboard/preferences PUT]', error)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }
}
