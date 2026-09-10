import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { groupBillSchema } from '@/lib/validations'
import GroupBill from '@/models/GroupBill'
import { calculateBill } from '@/lib/billCalculator'

// ─── Serialiser ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeBill(bill: any) {
  return {
    _id: bill._id.toString(),
    userId: bill.userId.toString(),
    name: bill.name,
    date: bill.date,
    currency: bill.currency,
    people: bill.people,
    items: bill.items,
    splitMode: bill.splitMode,
    customSplits: bill.customSplits,
    discountType: bill.discountType,
    discountValue: bill.discountValue,
    taxType: bill.taxType,
    taxValue: bill.taxValue,
    serviceChargeType: bill.serviceChargeType,
    serviceChargeValue: bill.serviceChargeValue,
    tipType: bill.tipType,
    tipValue: bill.tipValue,
    subtotal: bill.subtotal,
    discountAmount: bill.discountAmount,
    taxAmount: bill.taxAmount,
    serviceChargeAmount: bill.serviceChargeAmount,
    tipAmount: bill.tipAmount,
    total: bill.total,
    settlements: bill.settlements,
    savedAsExpense: bill.savedAsExpense,
    expenseId: bill.expenseId ? bill.expenseId.toString() : undefined,
    createdAt: bill.createdAt instanceof Date ? bill.createdAt.toISOString() : bill.createdAt,
    updatedAt: bill.updatedAt instanceof Date ? bill.updatedAt.toISOString() : bill.updatedAt,
  }
}

// ─── GET /api/group-bills ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
    const skip = parseInt(searchParams.get('skip') ?? '0', 10)

    const bills = await GroupBill.find({ userId })
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()

    return NextResponse.json({
      groupBills: bills.map((b) => serializeBill(b as unknown as Record<string, unknown>)),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills GET]', error)
    return NextResponse.json({ error: 'Failed to fetch group bills' }, { status: 500 })
  }
}

// ─── POST /api/group-bills ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = groupBillSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const data = parsed.data

    // Always recalculate server-side to prevent tampering
    const result = calculateBill(
      data.people,
      data.items,
      {
        discountType: data.discountType,
        discountValue: data.discountValue,
        taxType: data.taxType,
        taxValue: data.taxValue,
        serviceChargeType: data.serviceChargeType,
        serviceChargeValue: data.serviceChargeValue,
        tipType: data.tipType,
        tipValue: data.tipValue,
      },
      data.splitMode,
      data.customSplits
    )

    await connectDB()

    const bill = await GroupBill.create({
      ...data,
      userId,
      subtotal: result.totals.subtotal,
      discountAmount: result.totals.discountAmount,
      taxAmount: result.totals.taxAmount,
      serviceChargeAmount: result.totals.serviceChargeAmount,
      tipAmount: result.totals.tipAmount,
      total: result.totals.grandTotal,
      settlements: result.settlements.map((s) => ({ ...s, settled: false })),
    })

    return NextResponse.json(
      { groupBill: serializeBill(bill.toObject()) },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills POST]', error)
    return NextResponse.json({ error: 'Failed to create group bill' }, { status: 500 })
  }
}
