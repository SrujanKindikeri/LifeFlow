/**
 * lib/financialIntelligence/index.ts
 *
 * Main orchestrator — assembles the full FinancialIntelligenceData payload
 * from pre-fetched MongoDB documents.
 *
 * DATA INTEGRITY GUARANTEES
 * ─────────────────────────
 * • All amounts computed server-side from persisted records.
 * • Subscription billing date expenses are never double-counted:
 *   subscriptions appear as future outflows only when nextBillingDate is in
 *   the future — an already-processed billing date has an Expense that is
 *   counted separately in personal spending.
 * • MoneyRecord balances use calcBalance() (the canonical helper) so partial
 *   payments are always accounted for.
 * • GroupBill amounts for "you" are derived from settlements where the
 *   fromPerson/toPerson matches the "You" person id in the bill.
 * • GroupBill outstanding amounts are NOT double-counted with MoneyRecord
 *   balances unless an explicit link exists (not implemented in current schema).
 * • No data is written to the database — this is a pure read-and-compute path.
 * • Currency: Expense amounts stored in rupees; Budget/Subscription/MoneyRecord
 *   amounts stored in paise (integer minor units). This module normalises to
 *   paise internally and exposes paise in the output.
 */

import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import Budget from '@/models/Budget'
import Subscription from '@/models/Subscription'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import GroupBill from '@/models/GroupBill'
import mongoose from 'mongoose'
import { calcBalance } from '@/lib/moneyCalculator'
import { buildCashFlow, sliceCashFlow, sumCashFlow } from './cashFlow'
import { buildMonthEndForecast } from './monthEndForecast'
import { detectDuplicates } from './duplicateDetector'
import { buildSubscriptionInsights } from './subscriptionInsights'
import { buildBudgetRisks } from './budgetRisk'
import type {
  FinancialIntelligenceData,
  MoneyOwedEntry,
  GroupBillBalanceEntry,
} from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().split('T')[0]
}

function getMonthRange(month: string): [string, string] {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return [start, end]
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Detect the "You" person id from a GroupBill's people array. */
function getYouPersonId(people: { id: string; name: string }[]): string {
  const you = people.find((p) => p.name.toLowerCase() === 'you')
  return you ? you.id : (people[0]?.id ?? '')
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function buildFinancialIntelligence(
  userId: string,
  today: string,
  currentMonth: string
): Promise<FinancialIntelligenceData> {
  await connectDB()

  const userObjectId = new mongoose.Types.ObjectId(userId)
  const prevMonth = getPrevMonth(currentMonth)
  const [monthStart, monthEnd] = getMonthRange(currentMonth)
  const [prevMonthStart, prevMonthEnd] = getMonthRange(prevMonth)
  const ninetyDaysAgo = addDays(today, -90)
  const thirtyDaysAhead = addDays(today, 30)

  // ── Parallel DB queries ───────────────────────────────────────────────────
  const [
    currentMonthExpenses,
    prevMonthExpenses,
    recentExpenses,   // last 90 days (for duplicate detection, subscription linkage)
    allBudgets,
    activeSubscriptions,
    moneyRecordsRaw,
    allGroupBills,
  ] = await Promise.all([
    // Personal expenses for current month
    Expense.find({
      userId: userObjectId,
      source: 'personal',
      date: { $gte: monthStart, $lte: monthEnd },
    }).lean(),

    // Personal expenses for previous month (for forecast comparison)
    Expense.find({
      userId: userObjectId,
      source: 'personal',
      date: { $gte: prevMonthStart, $lte: prevMonthEnd },
    }).lean(),

    // Last 90 days of all personal + subscription expenses (for duplicate detection)
    Expense.find({
      userId: userObjectId,
      date: { $gte: ninetyDaysAgo, $lte: today },
    })
      .select('_id amount category description date source sourceSubscriptionId subscriptionBillingDate')
      .lean(),

    // All budgets for current month
    Budget.find({
      userId: userObjectId,
      month: currentMonth,
      status: 'active',
    }).lean(),

    // Active subscriptions with next billing date within 30 days (for cash flow)
    // We also fetch all active subs for the insights page
    Subscription.find({
      userId: userObjectId,
      status: 'active',
    }).lean(),

    // Money records (not fully paid)
    MoneyRecord.find({
      userId: userObjectId,
      status: { $in: ['pending', 'partially_paid', 'overdue'] },
    }).lean(),

    // All group bills for this user (sorted by most recent)
    GroupBill.find({ userId: userObjectId })
      .sort({ date: -1 })
      .limit(100)
      .lean(),
  ])

  // Fetch all payments for the relevant money records
  const moneyRecordIds = moneyRecordsRaw.map((r) => r._id)
  const allPayments = moneyRecordIds.length > 0
    ? await MoneyPayment.find({ moneyRecordId: { $in: moneyRecordIds } }).lean()
    : []

  // ── Build payment map ─────────────────────────────────────────────────────
  const paymentMap = new Map<string, number[]>()
  for (const p of allPayments) {
    const key = p.moneyRecordId.toString()
    if (!paymentMap.has(key)) paymentMap.set(key, [])
    paymentMap.get(key)!.push(p.amountMinor)
  }

  // ── Personal spending total ───────────────────────────────────────────────
  const totalSpentThisMonthMinor = currentMonthExpenses.reduce(
    (s, e) => s + Math.round(e.amount * 100), 0
  )

  // ── Budget total ──────────────────────────────────────────────────────────
  const budgetTotalMinor = allBudgets.reduce((s, b) => s + b.amountMinor, 0)
  const remainingBudgetMinor = Math.max(0, budgetTotalMinor - totalSpentThisMonthMinor)

  // ── Budget risk ───────────────────────────────────────────────────────────
  const budgetRisks = buildBudgetRisks({
    today,
    currentMonth,
    budgets: allBudgets.map((b) => ({
      _id: b._id,
      category: b.category,
      amountMinor: b.amountMinor,
      currency: b.currency,
      month: b.month,
      status: b.status,
    })),
    expenses: currentMonthExpenses.map((e) => ({
      amount: e.amount,
      category: e.category,
      source: e.source,
      date: e.date,
    })),
  })

  // ── Money records ─────────────────────────────────────────────────────────
  const owedToMe: MoneyOwedEntry[] = []
  const iOwe: MoneyOwedEntry[] = []
  const undatedOwedToMe: MoneyOwedEntry[] = []
  const undatedIOwe: MoneyOwedEntry[] = []

  let totalOutstandingOwedToMeMinor = 0
  let totalOutstandingIOweMinor = 0

  for (const r of moneyRecordsRaw) {
    const payments = paymentMap.get(r._id.toString()) ?? []
    const bal = calcBalance(
      r.originalAmountMinor,
      r.additionalAmounts ?? [],
      payments
    )
    if (bal.remainingMinor <= 0) continue

    const isOverdue = !!r.dueDate && r.dueDate < today
    const entry: MoneyOwedEntry = {
      recordId:       r._id.toString(),
      personName:     r.person.name,
      direction:      r.direction as 'given' | 'borrowed',
      remainingMinor: bal.remainingMinor,
      dueDate:        r.dueDate,
      isOverdue,
      isDated:        !!r.dueDate,
      href:           '/app/money',
    }

    if (r.direction === 'given') {
      totalOutstandingOwedToMeMinor += bal.remainingMinor
      if (r.dueDate) owedToMe.push(entry)
      else undatedOwedToMe.push(entry)
    } else {
      totalOutstandingIOweMinor += bal.remainingMinor
      if (r.dueDate) iOwe.push(entry)
      else undatedIOwe.push(entry)
    }
  }

  // Sort by due date ascending (overdue first)
  const sortByDue = (a: MoneyOwedEntry, b: MoneyOwedEntry) => {
    if (!a.dueDate && !b.dueDate) return 0
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate.localeCompare(b.dueDate)
  }
  owedToMe.sort(sortByDue)
  iOwe.sort(sortByDue)

  // ── Group bill balances ───────────────────────────────────────────────────
  const gbIOweDedupe = new Set<string>()
  const gbOwedToMeDedupe = new Set<string>()
  const gbIOweFull: GroupBillBalanceEntry[] = []
  const gbOwedToMeFull: GroupBillBalanceEntry[] = []

  for (const bill of allGroupBills) {
    const youPersonId = getYouPersonId(bill.people)

    for (const s of bill.settlements) {
      if (s.settled) continue

      // Convert rupees to paise
      const amountMinor = Math.round(s.amount * 100)
      if (amountMinor <= 0) continue

      const key = `${bill._id.toString()}:${s.fromPerson}:${s.toPerson}`

      if (s.fromPerson === youPersonId) {
        if (!gbIOweDedupe.has(key)) {
          gbIOweDedupe.add(key)
          gbIOweFull.push({
            billId:      bill._id.toString(),
            billName:    bill.name,
            direction:   'i_owe',
            amountMinor,
            href:        '/app/people',
          })
        }
      } else if (s.toPerson === youPersonId) {
        if (!gbOwedToMeDedupe.has(key)) {
          gbOwedToMeDedupe.add(key)
          gbOwedToMeFull.push({
            billId:      bill._id.toString(),
            billName:    bill.name,
            direction:   'owed_to_me',
            amountMinor,
            href:        '/app/people',
          })
        }
      }
    }
  }

  // ── Cash flow ─────────────────────────────────────────────────────────────
  const moneyRecordsForCashFlow = moneyRecordsRaw
    .filter((r) => !!r.dueDate && r.dueDate >= today && r.dueDate <= thirtyDaysAhead)
    .map((r) => ({
      _id:                 r._id,
      person:              r.person,
      direction:           r.direction as 'given' | 'borrowed',
      dueDate:             r.dueDate,
      originalAmountMinor: r.originalAmountMinor,
      additionalAmounts:   r.additionalAmounts ?? [],
      paymentAmountsMinor: paymentMap.get(r._id.toString()) ?? [],
    }))

  const groupBillsForCashFlow = allGroupBills.map((bill) => ({
    _id:         bill._id,
    name:        bill.name,
    date:        bill.date,
    settlements: bill.settlements.map((s) => ({
      fromPerson: s.fromPerson,
      toPerson:   s.toPerson,
      amount:     s.amount,
      settled:    s.settled,
    })),
    people:      bill.people.map((p) => ({ id: p.id, name: p.name })),
    currency:    bill.currency,
    youPersonId: getYouPersonId(bill.people),
  }))

  const allCashFlowEntries = buildCashFlow({
    today,
    maxDays: 30,
    subscriptions: activeSubscriptions.map((s) => ({
      _id:             s._id,
      serviceName:     s.serviceName,
      amountMinor:     s.amountMinor,
      currency:        s.currency,
      nextBillingDate: s.nextBillingDate,
      billingCycle:    s.billingCycle,
      status:          s.status,
    })),
    moneyRecords: moneyRecordsForCashFlow,
    groupBills: groupBillsForCashFlow,
  })

  const cf7  = sliceCashFlow(allCashFlowEntries, 7)
  const cf14 = sliceCashFlow(allCashFlowEntries, 14)
  const cf30 = sliceCashFlow(allCashFlowEntries, 30)

  const { totalOutflowMinor: out7  } = sumCashFlow(cf7)
  const { totalOutflowMinor: out14 } = sumCashFlow(cf14)
  const { totalOutflowMinor: out30 } = sumCashFlow(cf30)

  // ── Month-end forecast ────────────────────────────────────────────────────
  const monthEndForecast = buildMonthEndForecast({
    today,
    currentMonth,
    currentMonthExpenses: currentMonthExpenses.map((e) => ({
      amount:   e.amount,
      date:     e.date,
      source:   e.source,
      category: e.category,
    })),
    prevMonthExpenses: prevMonthExpenses.map((e) => ({
      amount:   e.amount,
      date:     e.date,
      source:   e.source,
      category: e.category,
    })),
    budgetTotalMinor,
  })

  // ── Duplicate detection ───────────────────────────────────────────────────
  const duplicateCandidates = detectDuplicates(
    recentExpenses.map((e) => ({
      _id:                     e._id.toString(),
      amount:                  e.amount,
      date:                    e.date,
      description:             e.description,
      category:                e.category,
      source:                  e.source,
      sourceSubscriptionId:    e.sourceSubscriptionId?.toString(),
      subscriptionBillingDate: e.subscriptionBillingDate,
    }))
  )

  // ── Subscription insights ─────────────────────────────────────────────────
  const recentSubExpenses = recentExpenses.filter((e) => e.source === 'subscription')
  const subscriptionInsights = buildSubscriptionInsights({
    today,
    subscriptions: activeSubscriptions.map((s) => ({
      _id:               s._id,
      serviceName:       s.serviceName,
      amountMinor:       s.amountMinor,
      currency:          s.currency,
      nextBillingDate:   s.nextBillingDate,
      billingCycle:      s.billingCycle,
      status:            s.status,
      category:          s.category,
      autoCreateExpense: s.autoCreateExpense,
    })),
    recentExpenses: recentSubExpenses.map((e) => ({
      sourceSubscriptionId:    e.sourceSubscriptionId
        ? { toString: () => e.sourceSubscriptionId!.toString() }
        : undefined,
      subscriptionBillingDate: e.subscriptionBillingDate,
      source:                  e.source,
      date:                    e.date,
    })),
  })

  // ── Assemble and return ───────────────────────────────────────────────────
  return {
    generatedAt:  new Date().toISOString(),
    currentMonth,
    today,

    overview: {
      totalSpentThisMonthMinor,
      remainingBudgetMinor,
      totalOutstandingOwedToMeMinor,
      totalOutstandingIOweMinor,
      upcomingOutflowMinor: {
        days7:  out7,
        days14: out14,
        days30: out30,
      },
    },

    cashFlow: {
      days7:  cf7,
      days14: cf14,
      days30: cf30,
    },

    monthEndForecast,

    budgetRisks,

    moneyOwed: {
      owedToMe,
      iOwe,
      undatedOwedToMe,
      undatedIOwe,
    },

    groupBillBalances: {
      iOwe:      gbIOweFull,
      owedToMe:  gbOwedToMeFull,
    },

    subscriptionInsights,
    duplicateCandidates,
  }
}
