import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Subscription from '@/models/Subscription'
import Activity from '@/models/Activity'
import { rupeesToPaise, paiseToRupees } from '@/lib/moneyCalculator'
import { runSubscriptionScheduler } from '@/lib/subscriptionScheduler'
import logger from '@/lib/logger'
import { z } from 'zod'

const subSchema = z.object({
  serviceName:        z.string().min(1, 'Service name is required').max(100),
  /** Amount in rupees from client; stored as paise */
  amount:             z.number().positive('Amount must be positive').max(10_000_000),
  currency:           z.string().max(5).default('INR'),
  billingCycle:       z.enum(['weekly','monthly','quarterly','yearly','custom']).default('monthly'),
  customIntervalDays: z.number().int().min(1).optional(),
  nextBillingDate:    z.string().min(1, 'Next billing date is required'),
  category:           z.enum(['streaming','music','software','cloud','fitness','news','gaming','education','utilities','other']).default('other'),
  paymentMethod:      z.string().max(100).optional(),
  status:             z.enum(['active','paused','cancelled']).default('active'),
  autoCreateExpense:  z.boolean().default(true),
  notes:              z.string().max(500).optional(),
})

function serialize(s: InstanceType<typeof Subscription>) {
  return {
    _id:                s._id.toString(),
    userId:             s.userId.toString(),
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
    createdAt:          s.createdAt.toISOString(),
    updatedAt:          s.updatedAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const status = searchParams.get('status')

    const query: Record<string, unknown> = { userId }
    if (status && ['active','paused','cancelled'].includes(status)) query.status = status

    const subscriptions = await Subscription.find(query).sort({ nextBillingDate: 1 }).lean()

    // Compute monthly/yearly totals for active subs
    const active = subscriptions.filter((s) => s.status === 'active')
    let monthlyTotal = 0
    for (const s of active) {
      const amt = s.amountMinor
      switch (s.billingCycle) {
        case 'weekly':    monthlyTotal += Math.round(amt * 4.33); break
        case 'monthly':   monthlyTotal += amt; break
        case 'quarterly': monthlyTotal += Math.round(amt / 3); break
        case 'yearly':    monthlyTotal += Math.round(amt / 12); break
        case 'custom':
          if (s.customIntervalDays) {
            monthlyTotal += Math.round((amt / s.customIntervalDays) * 30)
          }
          break
      }
    }

    // Piggyback: run the scheduler in the background so subscriptions are
    // processed whenever a user opens the Subscriptions page.
    // Fire-and-forget — errors are logged but never surfaced to the caller.
    void runSubscriptionScheduler().catch((err: unknown) =>
      logger.error('[subscriptions GET] background scheduler error', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    )

    return NextResponse.json({
      subscriptions: subscriptions.map(serialize as (s: unknown) => ReturnType<typeof serialize>),
      summary: {
        monthlyTotalMinor: monthlyTotal,
        yearlyTotalMinor:  monthlyTotal * 12,
        activeCount:       active.length,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[subscriptions GET]', { errorMessage: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = subSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { amount, ...rest } = parsed.data
    const amountMinor = rupeesToPaise(amount)

    await connectDB()

    const sub = await Subscription.create({ userId, amountMinor, ...rest })
    await Activity.create({
      userId,
      type: 'subscription_added',
      referenceId: sub._id,
      title: `Added subscription: ${sub.serviceName}`,
      metadata: { amountMinor, billingCycle: sub.billingCycle },
    })

    return NextResponse.json({ subscription: serialize(sub) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[subscriptions POST]', { errorMessage: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 })
  }
}
