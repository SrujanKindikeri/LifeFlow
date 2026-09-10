import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Budget from '@/models/Budget'
import Expense from '@/models/Expense'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const budgetSchema = z.object({
  category:  z.enum(['food','transport','shopping','bills','entertainment','education','health','subscriptions','other']),
  /** Budget limit in rupees; stored as paise */
  amount:    z.number().positive('Amount must be positive').max(100_000_000),
  currency:  z.string().max(5).default('INR'),
  /** YYYY-MM — defaults to current month */
  month:     z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM').optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const month = searchParams.get('month') ?? new Date().toISOString().slice(0, 7)

    // Budgets for the requested month
    const budgets = await Budget.find({ userId, month }).sort({ category: 1 }).lean()

    if (budgets.length === 0) {
      return NextResponse.json({ budgets: [], month })
    }

    // Actual personal spending per category for this month
    const [monthStart, monthEnd] = getMonthRange(month)
    const expenses = await Expense.find({
      userId,
      source: 'personal',
      date: { $gte: monthStart, $lte: monthEnd },
    }).lean()

    const spendMap: Record<string, number> = {}
    for (const e of expenses) {
      spendMap[e.category] = (spendMap[e.category] ?? 0) + Math.round(e.amount * 100)
    }

    const serialized = budgets.map((b) => {
      const spentMinor = spendMap[b.category] ?? 0
      const remainingMinor = b.amountMinor - spentMinor
      const pct = Math.round((spentMinor / b.amountMinor) * 100)
      return {
        _id:            b._id.toString(),
        category:       b.category,
        amountMinor:    b.amountMinor,
        amount:         paiseToRupees(b.amountMinor),
        currency:       b.currency,
        month:          b.month,
        status:         b.status,
        spentMinor,
        spent:          paiseToRupees(spentMinor),
        remainingMinor,
        remaining:      paiseToRupees(remainingMinor),
        pct:            Math.min(pct, 100),
        overBudget:     remainingMinor < 0,
        overAmount:     remainingMinor < 0 ? paiseToRupees(-remainingMinor) : 0,
        createdAt:      b.createdAt.toISOString(),
        updatedAt:      b.updatedAt.toISOString(),
      }
    })

    return NextResponse.json({ budgets: serialized, month })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[budgets GET]', error)
    return NextResponse.json({ error: 'Failed to fetch budgets' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = budgetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { amount, month, ...rest } = parsed.data
    const amountMinor = rupeesToPaise(amount)
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)

    await connectDB()

    // Upsert — one budget per category per month per user
    const budget = await Budget.findOneAndUpdate(
      { userId, category: rest.category, month: targetMonth },
      {
        $set: {
          amountMinor,
          currency: rest.currency ?? 'INR',
          status: 'active',
        },
        $setOnInsert: { userId, category: rest.category, month: targetMonth },
      },
      { upsert: true, new: true }
    )

    return NextResponse.json({
      budget: {
        _id:         budget._id.toString(),
        category:    budget.category,
        amountMinor: budget.amountMinor,
        amount:      paiseToRupees(budget.amountMinor),
        currency:    budget.currency,
        month:       budget.month,
        status:      budget.status,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[budgets POST]', error)
    return NextResponse.json({ error: 'Failed to create budget' }, { status: 500 })
  }
}

function getMonthRange(month: string): [string, string] {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return [start, end]
}
