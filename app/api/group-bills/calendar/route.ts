import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import GroupBill from '@/models/GroupBill'

/**
 * GET /api/group-bills/calendar?month=YYYY-MM
 *
 * Returns lightweight per-day summaries for group bills in a calendar month.
 * Used by the Liquid Glass calendar popover in ExpensesClient (Group Bills tab).
 *
 * Response shape:
 *   { days: { date: string; bills: { name: string; total: number; currency: string }[] }[] }
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
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    const bills = await GroupBill.find({
      userId,
      date: { $gte: startDate, $lte: endDate },
    })
      .select('name date total currency')
      .sort({ date: 1, createdAt: 1 })
      .lean()

    // Group by date
    const byDate: Record<string, { name: string; total: number; currency: string }[]> = {}
    for (const b of bills) {
      const bill = b as { name: string; date: string; total: number; currency: string }
      if (!byDate[bill.date]) byDate[bill.date] = []
      byDate[bill.date].push({
        name: bill.name,
        total: bill.total,
        currency: bill.currency,
      })
    }

    const days = Object.entries(byDate).map(([date, bills]) => ({ date, bills }))

    return NextResponse.json({ days })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills/calendar GET]', error)
    return NextResponse.json({ error: 'Failed to fetch calendar data' }, { status: 500 })
  }
}
