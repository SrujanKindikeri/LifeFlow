import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { expenseSchema } from '@/lib/validations'
import Expense from '@/models/Expense'
import logger from '@/lib/logger'

// ─── Serialiser ───────────────────────────────────────────────────────────────

function serializeExpense(e: {
  _id: { toString(): string }
  userId: { toString(): string }
  amount: number
  category: string
  description?: string
  date: string
  paymentMethod?: string | null
  source?: string
  sourceGroupBillId?: { toString(): string } | null
  sourceSubscriptionId?: { toString(): string } | null
  subscriptionBillingDate?: string | null
  transactionCapture?: {
    amountMinor?: number
    currency?: string
    direction?: string
    status?: string
    paidTo?: string
    receivedFrom?: string
    upiId?: string
    phoneNumber?: string
    bank?: string
    provider?: string
    references?: Array<{ value: string; type: string }>
    transactionDate?: string
    transactionTime?: string
    extractedAt?: Date
    extractionMethod?: string
    multipleDetected?: boolean
    lowConfidence?: boolean
    proofs?: Array<{
      fileId: string
      filename: string
      mimeType: string
      sizeBytes: number
      uploadedAt?: Date
    }>
  } | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    _id: e._id.toString(),
    userId: e.userId.toString(),
    amount: e.amount,
    category: e.category,
    description: e.description,
    date: e.date,
    paymentMethod: e.paymentMethod ?? undefined,
    // Backward-compat: old docs without source field treated as personal
    source: (e.source ?? 'personal') as 'personal' | 'group_bill' | 'subscription',
    sourceGroupBillId: e.sourceGroupBillId ? e.sourceGroupBillId.toString() : undefined,
    sourceSubscriptionId: e.sourceSubscriptionId ? e.sourceSubscriptionId.toString() : undefined,
    subscriptionBillingDate: e.subscriptionBillingDate ?? undefined,
    transactionCapture: e.transactionCapture
      ? {
          ...e.transactionCapture,
          extractedAt: e.transactionCapture.extractedAt instanceof Date
            ? e.transactionCapture.extractedAt.toISOString()
            : e.transactionCapture.extractedAt,
          proofs: (e.transactionCapture.proofs ?? []).map((p) => ({
            ...p,
            uploadedAt: p.uploadedAt instanceof Date ? p.uploadedAt.toISOString() : p.uploadedAt,
          })),
        }
      : undefined,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

// ─── GET /api/expenses ────────────────────────────────────────────────────────
//
// Query params:
//   date      — exact YYYY-MM-DD
//   month     — YYYY-MM prefix
//   category  — category value
//   source    — 'personal' | 'group_bill' | 'all' (default: 'personal' for clean analytics)
//   limit     — max results (default 200)

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const month = searchParams.get('month') // YYYY-MM
    const category = searchParams.get('category')
    const sourceParam = searchParams.get('source') ?? 'all' // default: all for UI fetch
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 1000)

    const query: Record<string, unknown> = { userId }

    // Date filter
    if (date) {
      query.date = date
    } else if (month) {
      query.date = { $regex: `^${month}` }
    }

    if (category) query.category = category

    // Source filter: analytics should pass source=personal; UI fetches pass source=all
    if (sourceParam === 'personal') {
      // Strict personal only — excludes group_bill shares
      query.$or = [{ source: 'personal' }, { source: { $exists: false } }, { source: null }]
    } else if (sourceParam === 'group_bill') {
      query.source = 'group_bill'
    }
    // 'all' → no filter (returns everything)

    const expenses = await Expense.find(query)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean()

    const total = expenses.reduce((sum, e) => sum + e.amount, 0)

    return NextResponse.json({
      expenses: expenses.map(serializeExpense),
      total: Math.round(total * 100) / 100,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[expenses GET] Failed to fetch expenses', {
      route: 'GET /api/expenses',
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
  }
}

// ─── POST /api/expenses ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()

    const parsed = expenseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    // Every manually-created expense is always 'personal'.
    // Subscription fields are intentionally omitted so the sparse/partial
    // unique index on subscription_billing_idempotency does not include them.
    const expense = await Expense.create({
      ...parsed.data,
      userId,
      lifeFlowId,
      source: 'personal',
    })

    return NextResponse.json({ expense: serializeExpense(expense) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Safe structured logging — never exposes secrets or raw DB details to client
    const errorType = error instanceof Error ? error.constructor.name : typeof error
    const errorMsg  = error instanceof Error ? error.message : String(error)

    logger.error('[expenses POST] Failed to create expense', {
      route: 'POST /api/expenses',
      errorType,
      // Truncate message to avoid accidentally logging sensitive content
      errorMessage: errorMsg.slice(0, 200),
    })

    // Duplicate key — return a clear 409 so the client can show a useful message.
    // Mongoose wraps MongoDB E11000 as an Error with a numeric `code` property.
    if (
      error instanceof Error &&
      (error as Error & { code?: unknown }).code === 11000
    ) {
      return NextResponse.json(
        { error: 'A subscription expense for this billing date already exists.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  }
}
