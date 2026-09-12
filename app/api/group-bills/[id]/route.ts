import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { groupBillUpdateSchema, markSettledSchema } from '@/lib/validations'
import GroupBill from '@/models/GroupBill'
import Expense from '@/models/Expense'
import { calculateBill } from '@/lib/billCalculator'
import { getTodayString } from '@/lib/utils'

// ─── Serialiser ───────────────────────────────────────────────────────────────

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

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET /api/group-bills/[id] ────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const bill = await GroupBill.findOne({ _id: id, userId }).lean()
    if (!bill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      groupBill: serializeBill(bill as unknown as Record<string, unknown>),
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills/:id GET]', error)
    return NextResponse.json({ error: 'Failed to fetch group bill' }, { status: 500 })
  }
}

// ─── PATCH /api/group-bills/[id] ─────────────────────────────────────────────
//
// Three actions dispatched by body.action:
//
//  1. action = 'settle'
//     Toggle a settlement's settled flag.
//
//  2. action = 'saveAsExpense'
//     Create a personal Expense for the user's share of this bill.
//     - Idempotent: returns 400 if already saved.
//     - Sets expense.source = 'group_bill', expense.sourceGroupBillId = bill._id
//     - Marks bill.savedAsExpense = true, bill.expenseId = expense._id
//
//  3. (default) Full bill update
//     Recalculates totals server-side.
//     If bill.savedAsExpense is true and the user provided yourPersonId,
//     also updates the linked personal expense amount to reflect the new share.

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const { id } = await params
    const body = await req.json()
    await connectDB()

    const bill = await GroupBill.findOne({ _id: id, userId })
    if (!bill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // ── Action: mark settlement settled / unsettled ────────────────────────
    if (body.action === 'settle') {
      const parsed = markSettledSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const { fromPerson, toPerson } = parsed.data
      const settlement = bill.settlements.find(
        (s) => s.fromPerson === fromPerson && s.toPerson === toPerson
      )
      if (settlement) {
        settlement.settled = !settlement.settled
        await bill.save()
      }
      return NextResponse.json({ groupBill: serializeBill(bill.toObject()) })
    }

    // ── Action: save user's share as a personal expense ───────────────────
    if (body.action === 'saveAsExpense') {
      // Idempotent guard — already saved
      if (bill.savedAsExpense) {
        return NextResponse.json(
          { error: 'Your share is already added to personal spending.' },
          { status: 400 }
        )
      }

      const { yourPersonId, category = 'other' } = body
      if (!yourPersonId) {
        return NextResponse.json({ error: 'yourPersonId is required' }, { status: 400 })
      }

      // Always recalculate server-side — never trust client-supplied amounts
      const calcResult = calculateBill(
        bill.people.map((p) => ({ id: p.id, name: p.name, paidAmount: p.paidAmount })),
        bill.items.map((it) => ({
          id: it.id,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          assignedPeople: it.assignedPeople,
        })),
        {
          discountType: bill.discountType as 'amount' | 'percent',
          discountValue: bill.discountValue,
          taxType: bill.taxType as 'amount' | 'percent',
          taxValue: bill.taxValue,
          serviceChargeType: bill.serviceChargeType as 'amount' | 'percent',
          serviceChargeValue: bill.serviceChargeValue,
          tipType: bill.tipType as 'amount' | 'percent',
          tipValue: bill.tipValue,
        },
        bill.splitMode as 'item' | 'equal' | 'custom',
        bill.customSplits.map((cs) => ({
          personId: cs.personId,
          value: cs.value,
          type: cs.type as 'amount' | 'percent',
        }))
      )

      const myShare = calcResult.personShares.find((ps) => ps.personId === yourPersonId)
      if (!myShare) {
        return NextResponse.json({ error: 'Person not found in bill' }, { status: 400 })
      }

      // Create the personal expense — only the user's share, never the full bill total
      const expense = await Expense.create({
        userId,
        lifeFlowId,
        amount: Math.round(myShare.total * 100) / 100,
        category,
        description: `${bill.name} (your share)`,
        date: bill.date || getTodayString(),
        source: 'group_bill',
        sourceGroupBillId: bill._id,
      })

      bill.savedAsExpense = true
      bill.expenseId = expense._id
      await bill.save()

      return NextResponse.json({
        groupBill: serializeBill(bill.toObject()),
        expense: {
          _id: expense._id.toString(),
          amount: expense.amount,
          category: expense.category,
          description: expense.description,
          date: expense.date,
          source: expense.source,
          sourceGroupBillId: expense.sourceGroupBillId?.toString(),
        },
      })
    }

    // ── Default: full bill update ─────────────────────────────────────────
    const parsed = groupBillUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data

    // Recalculate if any core split data changed
    const coreChanged =
      data.people !== undefined ||
      data.items !== undefined ||
      data.splitMode !== undefined ||
      data.customSplits !== undefined ||
      data.discountValue !== undefined ||
      data.taxValue !== undefined ||
      data.serviceChargeValue !== undefined ||
      data.tipValue !== undefined

    let newShareForPerson: number | null = null

    if (coreChanged) {
      const people =
        data.people ??
        bill.people.map((p) => ({ id: p.id, name: p.name, paidAmount: p.paidAmount }))
      const items =
        data.items ??
        bill.items.map((it) => ({
          id: it.id,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          assignedPeople: it.assignedPeople,
        }))
      const charges = {
        discountType: (data.discountType ?? bill.discountType) as 'amount' | 'percent',
        discountValue: data.discountValue ?? bill.discountValue,
        taxType: (data.taxType ?? bill.taxType) as 'amount' | 'percent',
        taxValue: data.taxValue ?? bill.taxValue,
        serviceChargeType: (data.serviceChargeType ?? bill.serviceChargeType) as 'amount' | 'percent',
        serviceChargeValue: data.serviceChargeValue ?? bill.serviceChargeValue,
        tipType: (data.tipType ?? bill.tipType) as 'amount' | 'percent',
        tipValue: data.tipValue ?? bill.tipValue,
      }
      const splitMode = (data.splitMode ?? bill.splitMode) as 'item' | 'equal' | 'custom'
      const customSplits = (data.customSplits ?? bill.customSplits).map((cs) => ({
        personId: cs.personId,
        value: cs.value,
        type: cs.type as 'amount' | 'percent',
      }))

      const result = calculateBill(people, items, charges, splitMode, customSplits)
      data.subtotal = result.totals.subtotal
      data.discountAmount = result.totals.discountAmount
      data.taxAmount = result.totals.taxAmount
      data.serviceChargeAmount = result.totals.serviceChargeAmount
      data.tipAmount = result.totals.tipAmount
      data.total = result.totals.grandTotal

      if (!data.settlements || data.settlements.length === 0) {
        data.settlements = result.settlements.map((s) => ({ ...s, settled: false }))
      }

      // If bill has a linked personal expense, find the person's new share
      // body.yourPersonId lets the client tell us which person is the user
      if (bill.savedAsExpense && bill.expenseId && body.yourPersonId) {
        const share = result.personShares.find((ps) => ps.personId === body.yourPersonId)
        if (share) {
          newShareForPerson = Math.round(share.total * 100) / 100
        }
      }
    }

    Object.assign(bill, data)
    await bill.save()

    // Sync linked personal expense amount if share changed
    if (newShareForPerson !== null && bill.expenseId) {
      await Expense.findOneAndUpdate(
        { _id: bill.expenseId, userId },
        {
          $set: {
            amount: newShareForPerson,
            description: `${bill.name} (your share)`,
            date: bill.date,
          },
        }
      )
    }

    return NextResponse.json({ groupBill: serializeBill(bill.toObject()) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills/:id PATCH]', error)
    return NextResponse.json({ error: 'Failed to update group bill' }, { status: 500 })
  }
}

// ─── DELETE /api/group-bills/[id] ─────────────────────────────────────────────
//
// Query params:
//   deleteExpense=true  — also delete the linked personal expense (if any)
//   deleteExpense=false — keep the personal expense (default)

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const { searchParams } = new URL(req.url)
    const shouldDeleteExpense = searchParams.get('deleteExpense') === 'true'

    const bill = await GroupBill.findOneAndDelete({ _id: id, userId })
    if (!bill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Cascade-delete the linked personal expense if the client asked for it
    let expenseDeleted = false
    if (shouldDeleteExpense && bill.savedAsExpense && bill.expenseId) {
      const deleted = await Expense.findOneAndDelete({ _id: bill.expenseId, userId })
      expenseDeleted = !!deleted
    }

    return NextResponse.json({
      message: 'Group bill deleted',
      expenseDeleted,
      hadLinkedExpense: bill.savedAsExpense && !!bill.expenseId,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills/:id DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete group bill' }, { status: 500 })
  }
}
