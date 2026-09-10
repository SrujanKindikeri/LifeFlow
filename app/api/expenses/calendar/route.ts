import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Expense from '@/models/Expense'

/**
 * GET /api/expenses/calendar?month=YYYY-MM
 *
 * Returns lightweight per-day summaries for a calendar month.
 * Used by the Liquid Glass calendar popover in PersonalExpensesClient.
 * Only returns personal expenses (source=personal or legacy docs with no source).
 *
 * Response shape:
 *   { days: { date: string; count: number; total: number }[] }
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const month = searchParams.get('month') // e.g. "2026-09"
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
    }

    const [year, mon] = month.split('-').map(Number)
    const startDate = `${month}-01`
    // Last day of the month
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    // Aggregate: group by date, sum amount, count docs
    // Only personal expenses — same $or pattern used everywhere for backward compat
    const pipeline = [
      {
        $match: {
          userId,
          date: { $gte: startDate, $lte: endDate },
          $or: [{ source: 'personal' }, { source: { $exists: false } }, { source: null }],
        },
      },
      {
        $group: {
          _id: '$date',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ] as Parameters<typeof Expense.aggregate>[0]

    const rows = await Expense.aggregate(pipeline)

    const days = rows.map((r: { _id: string; total: number; count: number }) => ({
      date: r._id,
      total: Math.round(r.total * 100) / 100,
      count: r.count,
    }))

    return NextResponse.json({ days })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[expenses/calendar GET]', error)
    return NextResponse.json({ error: 'Failed to fetch calendar data' }, { status: 500 })
  }
}
