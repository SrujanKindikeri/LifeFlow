import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import SavingsGoal from '@/models/SavingsGoal'
import SavingsContribution from '@/models/SavingsContribution'
import Activity from '@/models/Activity'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const contributionSchema = z.object({
  /** Amount in rupees from client; stored as paise */
  amount: z.number().positive('Amount must be positive').max(100_000_000),
  date:   z.string().min(1, 'Date is required'),
  note:   z.string().max(500).optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    // Verify ownership
    const goal = await SavingsGoal.findOne({ _id: id, userId }).lean()
    if (!goal) {
      return NextResponse.json({ error: 'Savings goal not found' }, { status: 404 })
    }

    const contributions = await SavingsContribution.find({ userId, savingsGoalId: id })
      .sort({ date: -1, createdAt: -1 })
      .lean()

    return NextResponse.json({
      contributions: contributions.map((c) => ({
        _id:           c._id.toString(),
        savingsGoalId: c.savingsGoalId.toString(),
        amountMinor:   c.amountMinor,
        amount:        paiseToRupees(c.amountMinor),
        date:          c.date,
        note:          c.note,
        createdAt:     c.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings contributions GET]', error)
    return NextResponse.json({ error: 'Failed to fetch contributions' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const parsed = contributionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    // Verify ownership
    const goal = await SavingsGoal.findOne({ _id: id, userId }).lean()
    if (!goal) {
      return NextResponse.json({ error: 'Savings goal not found' }, { status: 404 })
    }

    const amountMinor = rupeesToPaise(parsed.data.amount)

    const contribution = await SavingsContribution.create({
      userId,
      savingsGoalId: id,
      amountMinor,
      date: parsed.data.date,
      note: parsed.data.note,
    })

    await Activity.create({
      userId,
      type: 'savings_contributed',
      referenceId: goal._id,
      title: `Added ₹${parsed.data.amount.toLocaleString('en-IN')} to ${goal.title}`,
      metadata: { amountMinor, goalTitle: goal.title },
    })

    return NextResponse.json({
      contribution: {
        _id:           contribution._id.toString(),
        savingsGoalId: contribution.savingsGoalId.toString(),
        amountMinor:   contribution.amountMinor,
        amount:        paiseToRupees(contribution.amountMinor),
        date:          contribution.date,
        note:          contribution.note,
        createdAt:     contribution.createdAt.toISOString(),
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings contributions POST]', error)
    return NextResponse.json({ error: 'Failed to add contribution' }, { status: 500 })
  }
}
