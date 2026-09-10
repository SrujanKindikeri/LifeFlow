/**
 * POST /api/group-bills/[id]/optimize
 *
 * Calculates a debt-minimization settlement for a group bill.
 * Uses the standard "net-out balances" greedy algorithm:
 * 1. Compute net balance for each person (+ve = owed to, -ve = owes)
 * 2. Greedily match the largest creditor against the largest debtor
 * 3. Continue until all settled
 *
 * NEVER modifies actual records — returns the optimized plan only.
 * To apply, call POST with { apply: true } which PATCHES the bill's settlements.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import GroupBill from '@/models/GroupBill'

interface OptimizedTransaction {
  fromPerson: string
  fromName:   string
  toPerson:   string
  toName:     string
  amount:     number
}

function optimizeSettlements(
  people: { id: string; name: string }[],
  settlements: { fromPerson: string; toPerson: string; amount: number; settled: boolean }[]
): OptimizedTransaction[] {
  // Work only with unsettled transactions
  const unsettled = settlements.filter((s) => !s.settled)

  // Step 1: compute net balance per person
  const balance = new Map<string, number>()
  for (const p of people) balance.set(p.id, 0)

  for (const s of unsettled) {
    balance.set(s.toPerson, (balance.get(s.toPerson) ?? 0) + s.amount)
    balance.set(s.fromPerson, (balance.get(s.fromPerson) ?? 0) - s.amount)
  }

  // Step 2: separate creditors (positive) and debtors (negative)
  const creditors: { id: string; amount: number }[] = []
  const debtors:   { id: string; amount: number }[] = []

  for (const [id, amt] of balance.entries()) {
    const rounded = Math.round(amt * 100) / 100
    if (rounded > 0.005) creditors.push({ id, amount: rounded })
    else if (rounded < -0.005) debtors.push({ id, amount: Math.abs(rounded) })
  }

  // Step 3: greedy matching
  const result: OptimizedTransaction[] = []
  const nameMap = new Map(people.map((p) => [p.id, p.name]))

  let ci = 0, di = 0
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]
    const debtor   = debtors[di]
    const transfer = Math.min(creditor.amount, debtor.amount)

    if (transfer > 0.005) {
      result.push({
        fromPerson: debtor.id,
        fromName:   nameMap.get(debtor.id) ?? debtor.id,
        toPerson:   creditor.id,
        toName:     nameMap.get(creditor.id) ?? creditor.id,
        amount:     Math.round(transfer * 100) / 100,
      })
    }

    creditor.amount -= transfer
    debtor.amount   -= transfer

    if (creditor.amount < 0.005) ci++
    if (debtor.amount   < 0.005) di++
  }

  return result
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const bill = await GroupBill.findOne({ _id: id, userId }).lean()
    if (!bill) {
      return NextResponse.json({ error: 'Group bill not found' }, { status: 404 })
    }

    const original = bill.settlements.filter((s) => !s.settled).map((s) => ({
      fromPerson: s.fromPerson,
      fromName:   bill.people.find((p) => p.id === s.fromPerson)?.name ?? s.fromPerson,
      toPerson:   s.toPerson,
      toName:     bill.people.find((p) => p.id === s.toPerson)?.name ?? s.toPerson,
      amount:     s.amount,
    }))

    const optimized = optimizeSettlements(bill.people, bill.settlements)

    return NextResponse.json({
      original,
      optimized,
      saving: {
        originalCount:  original.length,
        optimizedCount: optimized.length,
        reduced:        original.length - optimized.length,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[optimize GET]', error)
    return NextResponse.json({ error: 'Failed to compute optimization' }, { status: 500 })
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

    if (!body.apply) {
      return NextResponse.json({ error: 'Pass { apply: true } to apply the optimized settlement' }, { status: 400 })
    }

    await connectDB()

    const bill = await GroupBill.findOne({ _id: id, userId })
    if (!bill) {
      return NextResponse.json({ error: 'Group bill not found' }, { status: 404 })
    }

    const optimized = optimizeSettlements(bill.people, bill.settlements)

    // Preserve already-settled transactions, replace unsettled with optimized plan
    const alreadySettled = bill.settlements.filter((s) => s.settled)
    const newSettlements = [
      ...alreadySettled,
      ...optimized.map((t) => ({
        fromPerson: t.fromPerson,
        toPerson:   t.toPerson,
        amount:     t.amount,
        settled:    false,
      })),
    ]

    bill.settlements = newSettlements as typeof bill.settlements
    await bill.save()

    return NextResponse.json({
      message: 'Optimized settlement applied',
      settlementCount: newSettlements.length,
      optimized,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[optimize POST]', error)
    return NextResponse.json({ error: 'Failed to apply optimized settlement' }, { status: 500 })
  }
}
