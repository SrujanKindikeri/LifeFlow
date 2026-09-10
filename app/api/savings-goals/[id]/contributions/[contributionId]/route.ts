import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import SavingsContribution from '@/models/SavingsContribution'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const updateSchema = z.object({
  amount: z.number().positive().max(100_000_000).optional(),
  date:   z.string().optional(),
  note:   z.string().max(500).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contributionId: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { contributionId } = await params
    const body = await req.json()

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { amount, ...rest } = parsed.data
    const update: Record<string, unknown> = { ...rest }
    if (amount !== undefined) update.amountMinor = rupeesToPaise(amount)

    await connectDB()

    const contribution = await SavingsContribution.findOneAndUpdate(
      { _id: contributionId, userId },
      { $set: update },
      { new: true }
    )

    if (!contribution) {
      return NextResponse.json({ error: 'Contribution not found' }, { status: 404 })
    }

    return NextResponse.json({
      contribution: {
        _id:         contribution._id.toString(),
        amountMinor: contribution.amountMinor,
        amount:      paiseToRupees(contribution.amountMinor),
        date:        contribution.date,
        note:        contribution.note,
        updatedAt:   contribution.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings contribution PATCH]', error)
    return NextResponse.json({ error: 'Failed to update contribution' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contributionId: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { contributionId } = await params

    await connectDB()

    const contribution = await SavingsContribution.findOneAndDelete({
      _id: contributionId,
      userId,
    })

    if (!contribution) {
      return NextResponse.json({ error: 'Contribution not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Contribution deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[savings contribution DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete contribution' }, { status: 500 })
  }
}
