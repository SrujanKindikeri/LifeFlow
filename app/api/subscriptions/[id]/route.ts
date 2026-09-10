import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Subscription from '@/models/Subscription'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { z } from 'zod'

const updateSchema = z.object({
  serviceName:        z.string().min(1).max(100).optional(),
  amount:             z.number().positive().max(10_000_000).optional(),
  currency:           z.string().max(5).optional(),
  billingCycle:       z.enum(['weekly','monthly','quarterly','yearly','custom']).optional(),
  customIntervalDays: z.number().int().min(1).optional(),
  nextBillingDate:    z.string().optional(),
  category:           z.enum(['streaming','music','software','cloud','fitness','news','gaming','education','utilities','other']).optional(),
  paymentMethod:      z.string().max(100).optional(),
  status:             z.enum(['active','paused','cancelled']).optional(),
  autoCreateExpense:  z.boolean().optional(),
  notes:              z.string().max(500).optional(),
})

function serialize(s: InstanceType<typeof Subscription>) {
  return {
    _id:                s._id.toString(),
    serviceName:        s.serviceName,
    amountMinor:        s.amountMinor,
    amount:             paiseToRupees(s.amountMinor),
    currency:           s.currency,
    billingCycle:       s.billingCycle,
    customIntervalDays: s.customIntervalDays,
    nextBillingDate:    s.nextBillingDate,
    lastBillingDate:    s.lastBillingDate ?? null,
    category:           s.category,
    paymentMethod:      s.paymentMethod,
    status:             s.status,
    autoCreateExpense:  s.autoCreateExpense,
    notes:              s.notes,
    updatedAt:          s.updatedAt.toISOString(),
  }
}

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

    const sub = await Subscription.findOneAndUpdate(
      { _id: id, userId },
      { $set: update },
      { new: true }
    )

    if (!sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    return NextResponse.json({ subscription: serialize(sub) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[subscription PATCH]', error)
    return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 })
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

    const sub = await Subscription.findOneAndDelete({ _id: id, userId })
    if (!sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Subscription deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[subscription DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete subscription' }, { status: 500 })
  }
}
