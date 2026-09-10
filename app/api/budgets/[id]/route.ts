import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Budget from '@/models/Budget'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const updateSchema = z.object({
  amount:   z.number().positive().max(100_000_000).optional(),
  currency: z.string().max(5).optional(),
  status:   z.enum(['active','paused']).optional(),
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

    const { amount, ...rest } = parsed.data
    const update: Record<string, unknown> = { ...rest }
    if (amount !== undefined) update.amountMinor = rupeesToPaise(amount)

    await connectDB()

    const budget = await Budget.findOneAndUpdate(
      { _id: id, userId },
      { $set: update },
      { new: true }
    )

    if (!budget) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
    }

    return NextResponse.json({
      budget: {
        _id:         budget._id.toString(),
        category:    budget.category,
        amountMinor: budget.amountMinor,
        amount:      paiseToRupees(budget.amountMinor),
        currency:    budget.currency,
        month:       budget.month,
        status:      budget.status,
        updatedAt:   budget.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[budget PATCH]', error)
    return NextResponse.json({ error: 'Failed to update budget' }, { status: 500 })
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

    const budget = await Budget.findOneAndDelete({ _id: id, userId })
    if (!budget) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Budget deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[budget DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete budget' }, { status: 500 })
  }
}
