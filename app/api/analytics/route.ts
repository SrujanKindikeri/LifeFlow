import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Expense from '@/models/Expense'
import GroupBill from '@/models/GroupBill'
import { EXPENSE_CATEGORIES } from '@/lib/utils'

// ─── GET /api/analytics ───────────────────────────────────────────────────────
//
// Query params:
//   year    — number (default: current year)
//   month   — number 1-12 (default: current month)
//   section — 'personal' (default) | 'group'
//
// Personal analytics ONLY use Expense documents (source = personal | group_bill).
// Group analytics ONLY use GroupBill documents.
// The two are NEVER mixed.

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const now = new Date()
    const year  = parseInt(searchParams.get('year')  ?? String(now.getFullYear()), 10)
    const month = parseInt(searchParams.get('month') ?? String(now.getMonth() + 1), 10)
    const section = searchParams.get('section') ?? 'personal'

    // ── GROUP ANALYTICS ──────────────────────────────────────────────────────
    if (section === 'group') {
      const bills = await GroupBill.find({ userId }).lean()

      const totalBills       = bills.length
      const totalGroupSpend  = bills.reduce((s, b) => s + b.total, 0)

      // "Your share" across all bills — approximate as total / people count
      // (exact per-person share requires recalculation; this is a summary stat)
      const totalYourShare   = bills.reduce((s, b) => {
        const n = b.people.length || 1
        return s + b.total / n
      }, 0)

      // "You paid" — sum of first person's paidAmount across all bills
      // In practice, the user is always the first person ("You") by convention
      const totalYouPaid = bills.reduce((s, b) => {
        const you = b.people[0]
        return s + (you?.paidAmount ?? 0)
      }, 0)

      // Settlement amounts
      let othersOweYou   = 0
      let youOweOthers   = 0
      let settledAmount  = 0
      let unsettledAmount = 0

      for (const b of bills) {
        for (const settlement of b.settlements) {
          if (settlement.settled) {
            settledAmount += settlement.amount
          } else {
            unsettledAmount += settlement.amount
            // If toPerson is "You" (first person), others owe you
            const you = b.people[0]
            if (you && settlement.toPerson === you.id) {
              othersOweYou += settlement.amount
            } else if (you && settlement.fromPerson === you.id) {
              youOweOthers += settlement.amount
            }
          }
        }
      }

      return NextResponse.json({
        section: 'group',
        stats: {
          totalBills,
          totalGroupSpend:   Math.round(totalGroupSpend   * 100) / 100,
          totalYourShare:    Math.round(totalYourShare    * 100) / 100,
          totalYouPaid:      Math.round(totalYouPaid      * 100) / 100,
          othersOweYou:      Math.round(othersOweYou      * 100) / 100,
          youOweOthers:      Math.round(youOweOthers      * 100) / 100,
          settledAmount:     Math.round(settledAmount      * 100) / 100,
          unsettledAmount:   Math.round(unsettledAmount    * 100) / 100,
        },
      })
    }

    // ── PERSONAL ANALYTICS (default) ─────────────────────────────────────────
    //
    // RULE: only query Expense documents that belong to this user.
    // This includes BOTH source='personal' AND source='group_bill' because
    // the user explicitly opted those group-bill shares into personal spending.
    // Group bill totals (GroupBill.total) are NEVER included here.

    const monthStr    = `${year}-${String(month).padStart(2, '0')}`
    const prevMonth   = month === 1 ? 12 : month - 1
    const prevYear    = month === 1 ? year - 1 : year
    const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`

    const daysInMonth = new Date(year, month, 0).getDate()

    const sixMonthsAgo    = new Date(year, month - 7, 1)
    const sixMonthsAgoStr = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`

    const [currentMonthExpenses, prevMonthExpenses, last6Expenses] = await Promise.all([
      Expense.find({ userId, date: { $regex: `^${monthStr}` } }).lean(),
      Expense.find({ userId, date: { $regex: `^${prevMonthStr}` } }).lean(),
      Expense.find({ userId, date: { $gte: sixMonthsAgoStr } }).lean(),
    ])

    // ── Summary ──
    const totalThisMonth = currentMonthExpenses.reduce((s, e) => s + e.amount, 0)
    const totalPrevMonth = prevMonthExpenses.reduce((s, e) => s + e.amount, 0)
    const avgPerDay      = daysInMonth > 0 ? totalThisMonth / daysInMonth : 0

    const monthlyChange =
      totalPrevMonth > 0
        ? Math.round(((totalThisMonth - totalPrevMonth) / totalPrevMonth) * 100)
        : null

    // ── Category breakdown ──
    const categoryTotals: Record<string, number> = {}
    for (const e of currentMonthExpenses) {
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount
    }
    const topCategory =
      Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const categoryBreakdown = EXPENSE_CATEGORIES
      .map((cat) => ({
        category: cat.value,
        label:    cat.label,
        emoji:    cat.emoji,
        color:    cat.color,
        amount:   Math.round((categoryTotals[cat.value] ?? 0) * 100) / 100,
      }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)

    // ── Daily chart ──
    const dailyChart: { day: number; amount: number }[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`
      const amount = currentMonthExpenses
        .filter((e) => e.date === dayStr)
        .reduce((s, e) => s + e.amount, 0)
      dailyChart.push({ day: d, amount: Math.round(amount * 100) / 100 })
    }

    // ── Weekly chart ──
    const weeklyChart: { week: number; amount: number; label: string }[] = [
      { week: 1, amount: 0, label: 'Week 1' },
      { week: 2, amount: 0, label: 'Week 2' },
      { week: 3, amount: 0, label: 'Week 3' },
      { week: 4, amount: 0, label: 'Week 4' },
    ]
    for (const e of currentMonthExpenses) {
      const day     = parseInt(e.date.split('-')[2], 10)
      const weekIdx = Math.min(Math.floor((day - 1) / 7), 3)
      weeklyChart[weekIdx].amount += e.amount
    }
    weeklyChart.forEach((w) => { w.amount = Math.round(w.amount * 100) / 100 })

    // ── Monthly trend (last 6 months) ──
    const monthlyChart: { month: string; label: string; amount: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d    = new Date(year, month - 1 - i, 1)
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label  = d.toLocaleString('en-US', { month: 'short' })
      const amount = last6Expenses
        .filter((e) => e.date.startsWith(mStr))
        .reduce((s, e) => s + e.amount, 0)
      monthlyChart.push({ month: mStr, label, amount: Math.round(amount * 100) / 100 })
    }

    // ── Insights ──
    const insights: { text: string; icon: string }[] = []

    if (topCategory && totalThisMonth > 0) {
      const catLabel =
        EXPENSE_CATEGORIES.find((c) => c.value === topCategory)?.label ?? topCategory
      insights.push({
        text: `${catLabel} is your highest personal spending category this month.`,
        icon: EXPENSE_CATEGORIES.find((c) => c.value === topCategory)?.emoji ?? '📦',
      })
    }

    if (monthlyChange !== null) {
      if (monthlyChange > 0) {
        insights.push({
          text: `You spent ${monthlyChange}% more this month than last month.`,
          icon: '📈',
        })
      } else if (monthlyChange < 0) {
        insights.push({
          text: `You spent ${Math.abs(monthlyChange)}% less this month than last month. Great job!`,
          icon: '📉',
        })
      }
    }

    if (avgPerDay > 0) {
      insights.push({
        text: `Your daily average personal spend this month is ₹${Math.round(avgPerDay).toLocaleString('en-IN')}.`,
        icon: '📊',
      })
    }

    return NextResponse.json({
      section: 'personal',
      summary: {
        totalThisMonth: Math.round(totalThisMonth * 100) / 100,
        totalPrevMonth: Math.round(totalPrevMonth * 100) / 100,
        avgPerDay:      Math.round(avgPerDay      * 100) / 100,
        topCategory,
        monthlyChange,
        transactionCount: currentMonthExpenses.length,
      },
      categoryBreakdown,
      dailyChart,
      weeklyChart,
      monthlyChart,
      insights,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[analytics GET]', error)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
