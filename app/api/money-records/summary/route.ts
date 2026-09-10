/**
 * GET /api/money-records/summary
 *
 * Returns aggregated Money Tracker totals for the dashboard:
 *  - toCollect:  total outstanding across all "given" records
 *  - toPay:      total outstanding across all "borrowed" records
 *  - totalGiven / totalReceived / outstandingGiven
 *  - totalBorrowed / totalRepaid / outstandingBorrowed
 *  - perPerson breakdown (top debtors/creditors)
 *
 * All amounts in minor units (paise).
 * Only counts non-paid records.
 */

import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import { calcBalance } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    // Fetch all non-deleted records (all statuses — we re-derive from payments)
    const records = await MoneyRecord.find({ userId }).lean()

    if (records.length === 0) {
      return NextResponse.json({
        toCollectMinor: 0,
        toPayMinor: 0,
        netMinor: 0,
        given: { totalMinor: 0, receivedMinor: 0, outstandingMinor: 0 },
        borrowed: { totalMinor: 0, repaidMinor: 0, outstandingMinor: 0 },
        perPerson: [],
      })
    }

    const recordIds = records.map((r) => r._id)
    const allPayments = await MoneyPayment.find({
      moneyRecordId: { $in: recordIds },
    }).lean()

    // Map payments by record id
    const paymentMap = new Map<string, IMoneyPayment[]>()
    for (const p of allPayments) {
      const key = p.moneyRecordId.toString()
      if (!paymentMap.has(key)) paymentMap.set(key, [])
      paymentMap.get(key)!.push(p as unknown as IMoneyPayment)
    }

    // Aggregate
    let toCollectMinor = 0
    let toPayMinor = 0
    let givenTotalMinor = 0
    let givenReceivedMinor = 0
    let borrowedTotalMinor = 0
    let borrowedRepaidMinor = 0

    // Per-person: name → { givenRemaining, borrowedRemaining }
    const personMap = new Map<
      string,
      { name: string; owesYouMinor: number; youOweMinor: number }
    >()

    for (const r of records) {
      const payments = paymentMap.get(r._id.toString()) ?? []
      const balance = calcBalance(
        (r as unknown as IMoneyRecord).originalAmountMinor,
        payments.map((p) => p.amountMinor)
      )

      const personName = (r as unknown as IMoneyRecord).person.name

      if ((r as unknown as IMoneyRecord).direction === 'given') {
        givenTotalMinor    += balance.originalMinor
        givenReceivedMinor += balance.paidMinor
        toCollectMinor     += balance.remainingMinor

        if (!personMap.has(personName)) {
          personMap.set(personName, { name: personName, owesYouMinor: 0, youOweMinor: 0 })
        }
        personMap.get(personName)!.owesYouMinor += balance.remainingMinor
      } else {
        borrowedTotalMinor  += balance.originalMinor
        borrowedRepaidMinor += balance.paidMinor
        toPayMinor          += balance.remainingMinor

        if (!personMap.has(personName)) {
          personMap.set(personName, { name: personName, owesYouMinor: 0, youOweMinor: 0 })
        }
        personMap.get(personName)!.youOweMinor += balance.remainingMinor
      }
    }

    // Build per-person list — only include people with non-zero balances
    const perPerson = Array.from(personMap.values())
      .filter((p) => p.owesYouMinor > 0 || p.youOweMinor > 0)
      .sort((a, b) => (b.owesYouMinor + b.youOweMinor) - (a.owesYouMinor + a.youOweMinor))
      .slice(0, 10) // top 10 for dashboard

    return NextResponse.json({
      toCollectMinor,
      toPayMinor,
      netMinor: toCollectMinor - toPayMinor,
      given: {
        totalMinor:       givenTotalMinor,
        receivedMinor:    givenReceivedMinor,
        outstandingMinor: toCollectMinor,
      },
      borrowed: {
        totalMinor:       borrowedTotalMinor,
        repaidMinor:      borrowedRepaidMinor,
        outstandingMinor: toPayMinor,
      },
      perPerson,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records/summary GET]', err)
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 })
  }
}
