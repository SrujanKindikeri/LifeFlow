import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { expenseSchema } from '@/lib/validations'
import Expense from '@/models/Expense'

// ─── Serialiser ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeExpense(e: any) {
  return {
    _id: e._id.toString(),
    userId: e.userId.toString(),
    amount: e.amount,
    category: e.category,
    description: e.description,
    date: e.date,
    paymentMethod: e.paymentMethod ?? undefined,
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
          proofs: (e.transactionCapture.proofs ?? []).map((p: { uploadedAt?: Date | string; [k: string]: unknown }) => ({
            ...p,
            uploadedAt: p.uploadedAt instanceof Date ? p.uploadedAt.toISOString() : p.uploadedAt,
          })),
        }
      : undefined,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
    updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : e.updatedAt,
  }
}

// ─── GET /api/expenses/[id] ───────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const expense = await Expense.findOne({ _id: id, userId }).lean()
    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    return NextResponse.json({ expense: serializeExpense(expense) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[expense GET]', error)
    return NextResponse.json({ error: 'Failed to fetch expense' }, { status: 500 })
  }
}

// ─── PATCH /api/expenses/[id] ─────────────────────────────────────────────────
//
// Only allows editing amount, category, description, date.
// source / sourceGroupBillId are NOT editable via this route —
// those are managed by the group-bills API.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const parsed = expenseSchema.partial().safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const expense = await Expense.findOneAndUpdate(
      { _id: id, userId },
      { $set: parsed.data },
      { new: true }
    )

    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    return NextResponse.json({ expense: serializeExpense(expense) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[expense PATCH]', error)
    return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 })
  }
}

// ─── DELETE /api/expenses/[id] ────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const expense = await Expense.findOneAndDelete({ _id: id, userId })
    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Expense deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[expense DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
  }
}
