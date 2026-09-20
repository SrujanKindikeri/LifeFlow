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
    // ── Step 1: Authentication ────────────────────────────────────────────
    console.log('[GROUP BILL] save started')
    const { userId, lifeFlowId } = await requireAuth()
    console.log('[GROUP BILL] authenticated — user OK')

    // ── Step 2: Parse request body ────────────────────────────────────────
    let body: unknown
    try {
      body = await req.json()
    } catch {
      console.error('[GROUP BILL] failed to parse request body as JSON')
      return NextResponse.json(
        { error: 'Invalid request body — expected JSON' },
        { status: 400 }
      )
    }

    // ── Step 3: Zod validation ────────────────────────────────────────────
    const parsed = groupBillSchema.safeParse(body)
    if (!parsed.success) {
      // Collect all validation issues for the server log (never sent to client)
      const allIssues = parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      )
      console.error('[GROUP BILL] validation failed', allIssues)
      // Return only the first human-readable message to the client
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const data = parsed.data
    console.log('[GROUP BILL] validation passed —', {
      name: data.name,
      date: data.date,
      currency: data.currency,
      peopleCount: data.people.length,
      itemCount: data.items.length,
      splitMode: data.splitMode,
    })

    // ── Step 4: Server-side recalculation ─────────────────────────────────
    let result: ReturnType<typeof calculateBill>
    try {
      result = calculateBill(
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
    } catch (calcError) {
      console.error('[GROUP BILL] calculateBill threw', calcError)
      return NextResponse.json(
        { error: 'Failed to calculate bill totals. Check item and people data.' },
        { status: 422 }
      )
    }
    console.log('[GROUP BILL] calculation OK — grandTotal:', result.totals.grandTotal)

    // ── Step 5: Database save ─────────────────────────────────────────────
    await connectDB()
    console.log('[GROUP BILL] DB connected')

    const bill = await GroupBill.create({
      ...data,
      userId,
      lifeFlowId,
      subtotal: result.totals.subtotal,
      discountAmount: result.totals.discountAmount,
      taxAmount: result.totals.taxAmount,
      serviceChargeAmount: result.totals.serviceChargeAmount,
      tipAmount: result.totals.tipAmount,
      total: result.totals.grandTotal,
      settlements: result.settlements.map((s) => ({ ...s, settled: false })),
    })

    console.log('[GROUP BILL] saved successfully — id:', bill._id.toString())

    return NextResponse.json(
      { groupBill: serializeBill(bill.toObject()) },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.message === 'UserNotFound') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Log the real error server-side (never exposed to client)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyErr = error as any
    const validationErrors = anyErr?.errors
      ? Object.entries(anyErr.errors as Record<string, { message: string }>).map(
          ([field, e]) => `${field}: ${e.message}`
        )
      : undefined
    console.error('[GROUP BILL] save failed —', {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      // Mongoose validation errors carry an 'errors' object with per-field details
      validationErrors,
    })
    return NextResponse.json({ error: 'Failed to create group bill' }, { status: 500 })
  }
}
