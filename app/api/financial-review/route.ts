/**
 * GET /api/financial-review?month=YYYY-MM
 *
 * Aggregates real financial data for the requested month.
 * Personal spending and Group Bills are ALWAYS kept separate.
 * Only explicitly created personal expenses count toward personal spending.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Expense from '@/models/Expense'
import GroupBill from '@/models/GroupBill'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import SavingsContribution from '@/models/SavingsContribution'
import Subscription from '@/models/Subscription'
import { EXPENSE_CATEGORIES } from '@/lib/utils'
import { paiseToRupees, calcBalance } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

function getMonthRange(month: string): [string, string] {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return [start, end]
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const month = searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
    const [monthStart, monthEnd] = getMonthRange(month)

    const [
      personalExpenses,
      groupBills,
      moneyRecords,
      savingsContributions,
      activeSubscriptions,
    ] = await Promise.all([
      // Personal expenses only
      Expense.find({ userId, source: 'personal', date: { $gte: monthStart, $lte: monthEnd } }).lean(),
      // Group bills created this month
      GroupBill.find({ userId, date: { $gte: monthStart, $lte: monthEnd } }).lean(),
      // All money records
      MoneyRecord.find({ userId }).lean(),
      // Savings contributions this month
      SavingsContribution.find({ userId, date: { $gte: monthStart, $lte: monthEnd } }).lean(),
      // Active subscriptions
      Subscription.find({ userId, status: 'active' }).lean(),
    ])

    // ── Personal Spending ──────────────────────────────────────────────────────
    const categoryMap: Record<string, number> = {}
    let totalPersonalSpend = 0
    for (const e of personalExpenses) {
      const paise = Math.round(e.amount * 100)
      categoryMap[e.category] = (categoryMap[e.category] ?? 0) + paise
      totalPersonalSpend += paise
    }

    const daysInMonth = new Date(parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7)), 0).getDate()
    const avgDailySpend = totalPersonalSpend > 0
      ? Math.round(totalPersonalSpend / daysInMonth)
      : 0

    const topCategory = Object.entries(categoryMap).sort((a, b) => b[1] - a[1])[0]

    const spendingByCategory = Object.entries(categoryMap).map(([cat, minor]) => {
      const info = EXPENSE_CATEGORIES.find((c) => c.value === cat)
      return {
        category:    cat,
        label:       info?.label ?? cat,
        emoji:       info?.emoji ?? '📦',
        amountMinor: minor,
        amount:      paiseToRupees(minor),
        pct:         totalPersonalSpend > 0 ? Math.round((minor / totalPersonalSpend) * 100) : 0,
      }
    }).sort((a, b) => b.amountMinor - a.amountMinor)

    // ── Group Bills ────────────────────────────────────────────────────────────
    const totalGroupBills = groupBills.reduce((s, b) => s + b.total, 0)

    // ── Money Records ──────────────────────────────────────────────────────────
    const recordIds = moneyRecords.map((r) => r._id)
    const allPayments = recordIds.length > 0
      ? await MoneyPayment.find({ moneyRecordId: { $in: recordIds } }).lean()
      : []

    const paymentMap = new Map<string, IMoneyPayment[]>()
    for (const p of allPayments) {
      const key = p.moneyRecordId.toString()
      if (!paymentMap.has(key)) paymentMap.set(key, [])
      paymentMap.get(key)!.push(p as unknown as IMoneyPayment)
    }

    // Payments received/made THIS month
    const thisMonthPayments = allPayments.filter((p) =>
      p.paymentDate >= monthStart && p.paymentDate <= monthEnd
    )

    let moneyCollectedMinor = 0
    let moneyPaidMinor = 0
    let moneyGivenOutstandingMinor = 0
    let moneyBorrowedOutstandingMinor = 0

    for (const r of moneyRecords) {
      const rec = r as unknown as IMoneyRecord
      const payments = paymentMap.get(r._id.toString()) ?? []
      const bal = calcBalance(rec.originalAmountMinor, rec.additionalAmounts ?? [], payments.map((p) => p.amountMinor))

      if (rec.direction === 'given') {
        moneyGivenOutstandingMinor += bal.remainingMinor
        // Payments on given = collections
        const monthPmts = thisMonthPayments.filter((p) => p.moneyRecordId.toString() === r._id.toString())
        moneyCollectedMinor += monthPmts.reduce((s, p) => s + p.amountMinor, 0)
      } else {
        moneyBorrowedOutstandingMinor += bal.remainingMinor
        const monthPmts = thisMonthPayments.filter((p) => p.moneyRecordId.toString() === r._id.toString())
        moneyPaidMinor += monthPmts.reduce((s, p) => s + p.amountMinor, 0)
      }
    }

    // ── Savings ────────────────────────────────────────────────────────────────
    const totalSavedMinor = savingsContributions.reduce((s, c) => s + c.amountMinor, 0)

    // ── Subscriptions ──────────────────────────────────────────────────────────
    // Subscriptions due this month
    let subscriptionCostMinor = 0
    for (const s of activeSubscriptions) {
      // Count if next billing date is in this month, or approximate monthly cost
      if (s.nextBillingDate >= monthStart && s.nextBillingDate <= monthEnd) {
        subscriptionCostMinor += s.amountMinor
      }
    }

    return NextResponse.json({
      month,
      personal: {
        totalMinor:       totalPersonalSpend,
        total:            paiseToRupees(totalPersonalSpend),
        avgDailyMinor:    avgDailySpend,
        avgDaily:         paiseToRupees(avgDailySpend),
        topCategory:      topCategory ? topCategory[0] : null,
        topCategoryMinor: topCategory ? topCategory[1] : 0,
        byCategory:       spendingByCategory,
        transactionCount: personalExpenses.length,
      },
      groupBills: {
        totalAmount:  totalGroupBills,
        count:        groupBills.length,
      },
      money: {
        collectedMinor:              moneyCollectedMinor,
        collected:                   paiseToRupees(moneyCollectedMinor),
        paidMinor:                   moneyPaidMinor,
        paid:                        paiseToRupees(moneyPaidMinor),
        givenOutstandingMinor:       moneyGivenOutstandingMinor,
        givenOutstanding:            paiseToRupees(moneyGivenOutstandingMinor),
        borrowedOutstandingMinor:    moneyBorrowedOutstandingMinor,
        borrowedOutstanding:         paiseToRupees(moneyBorrowedOutstandingMinor),
      },
      savings: {
        totalMinor: totalSavedMinor,
        total:      paiseToRupees(totalSavedMinor),
        count:      savingsContributions.length,
      },
      subscriptions: {
        costMinor: subscriptionCostMinor,
        cost:      paiseToRupees(subscriptionCostMinor),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[financial-review GET]', error)
    return NextResponse.json({ error: 'Failed to fetch financial review' }, { status: 500 })
  }
}
