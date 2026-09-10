import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import SavingsGoal from '@/models/SavingsGoal'
import SavingsContribution from '@/models/SavingsContribution'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const updateSchema = z.object({
  title:        z.string().min(1).max(200).optional(),
  targetAmount: z.number().positive().max(100_000_000).optional(),
  currency:     z.string().max(5).optional(),
  icon:         z.string().max(10).optional(),
  color:        z.string().max(7).optional(),
  targetDate:   z.string().optional(),
  notes:        z.string().max(500).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { targetAmount, ...rest } = parsed.data
    const update: Record<string, unknown> = { ...rest }
    if (targetAmount !== undefined) update.targetAmountMinor = rupeesToPaise(targetAmount)

    await connectDB()

    const goal = await SavingsGoal.findOneAndUpdate(
      { _id: id, userId },
      { $set: update },
      { new: true }
    )

    if (!goal) {
      return NextResponse.json({ error: 'Savings goal not found' }, { status: 404 })
    }

    const contributions = await SavingsContribution.find({ userId, savingsGoalId: id }).lean()
    const savedMinor = contributions.reduce((s, c) => s + c.amountMinor, 0)

    return NextResponse.json({
      goal: {
        _id:               goal._id.toString(),
        title:             goal.title,
        targetAmountMinor: goal.targetAmountMinor,
        targetAmount:      paiseToRupees(goal.targetAmountMinor),
        savedMinor,
        saved:             paiseToRupees(savedMinor),
        remainingMinor:    Math.max(0, goal.targetAmountMinor - savedMinor),
        progressPct:       goal.targetAmountMinor > 0
          ? Math.min(100, Math.round((savedMinor / goal.targetAmountMinor) * 100))
          : 0,
        currency:   goal.currency,
        icon:       goal.icon,
        color:      goal.color,
        targetDate: goal.targetDate,
        notes:      goal.notes,
        updatedAt:  goal.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings-goal PATCH]', error)
    return NextResponse.json({ error: 'Failed to update savings goal' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    await connectDB()

    const goal = await SavingsGoal.findOneAndDelete({ _id: id, userId })
    if (!goal) {
      return NextResponse.json({ error: 'Savings goal not found' }, { status: 404 })
    }

    // Also delete all contributions for this goal
    await SavingsContribution.deleteMany({ userId, savingsGoalId: id })

    return NextResponse.json({ message: 'Savings goal deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings-goal DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete savings goal' }, { status: 500 })
  }
}
