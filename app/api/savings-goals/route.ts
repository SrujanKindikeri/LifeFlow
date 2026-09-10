import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import SavingsGoal from '@/models/SavingsGoal'
import SavingsContribution from '@/models/SavingsContribution'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const savingsGoalSchema = z.object({
  title:              z.string().min(1, 'Title is required').max(200),
  /** Target in rupees; stored as paise */
  targetAmount:       z.number().positive('Target must be positive').max(100_000_000),
  currency:           z.string().max(5).default('INR'),
  icon:               z.string().max(10).default('🎯'),
  color:              z.string().max(7).default('#3b82f6'),
  targetDate:         z.string().optional(),
  notes:              z.string().max(500).optional(),
})

function serializeGoal(
  g: InstanceType<typeof SavingsGoal>,
  savedMinor: number
) {
  const progressPct = g.targetAmountMinor > 0
    ? Math.min(100, Math.round((savedMinor / g.targetAmountMinor) * 100))
    : 0
  return {
    _id:               g._id.toString(),
    userId:            g.userId.toString(),
    title:             g.title,
    targetAmountMinor: g.targetAmountMinor,
    targetAmount:      paiseToRupees(g.targetAmountMinor),
    savedMinor,
    saved:             paiseToRupees(savedMinor),
    remainingMinor:    Math.max(0, g.targetAmountMinor - savedMinor),
    remaining:         paiseToRupees(Math.max(0, g.targetAmountMinor - savedMinor)),
    progressPct,
    currency:          g.currency,
    icon:              g.icon,
    color:             g.color,
    targetDate:        g.targetDate,
    notes:             g.notes,
    createdAt:         g.createdAt.toISOString(),
    updatedAt:         g.updatedAt.toISOString(),
  }
}

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const goals = await SavingsGoal.find({ userId }).sort({ createdAt: -1 }).lean()

    if (goals.length === 0) {
      return NextResponse.json({ goals: [], totalSavedMinor: 0 })
    }

    const goalIds = goals.map((g) => g._id)
    const contributions = await SavingsContribution.find({
      userId,
      savingsGoalId: { $in: goalIds },
    }).lean()

    const savedMap = new Map<string, number>()
    for (const c of contributions) {
      const key = c.savingsGoalId.toString()
      savedMap.set(key, (savedMap.get(key) ?? 0) + c.amountMinor)
    }

    const totalSavedMinor = Array.from(savedMap.values()).reduce((s, v) => s + v, 0)

    const serialized = goals.map((g) =>
      serializeGoal(
        g as unknown as InstanceType<typeof SavingsGoal>,
        savedMap.get(g._id.toString()) ?? 0
      )
    )

    return NextResponse.json({ goals: serialized, totalSavedMinor })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings-goals GET]', error)
    return NextResponse.json({ error: 'Failed to fetch savings goals' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = savingsGoalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { targetAmount, ...rest } = parsed.data
    const targetAmountMinor = rupeesToPaise(targetAmount)

    await connectDB()

    const goal = await SavingsGoal.create({ userId, targetAmountMinor, ...rest })

    return NextResponse.json({ goal: serializeGoal(goal, 0) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings-goals POST]', error)
    return NextResponse.json({ error: 'Failed to create savings goal' }, { status: 500 })
  }
}

