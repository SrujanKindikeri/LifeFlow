/**
 * lib/financialIntelligence/cashFlow.ts
 *
 * Builds a projected cash flow for the next N days based on
 * upcoming subscriptions, money record due dates, and group bill balances.
 */

import type { CashFlowEntry, CashFlowItem } from './types'
import type mongoose from 'mongoose'

// ── Input types ───────────────────────────────────────────────────────────────

interface RawSubscription {
  _id: mongoose.Types.ObjectId
  serviceName: string
  amountMinor: number
  currency: string
  nextBillingDate?: string
  billingCycle: string
  status: string
}

interface RawMoneyRecord {
  _id: mongoose.Types.ObjectId
  person: { name: string }
  direction: 'given' | 'borrowed'
  dueDate?: string
  originalAmountMinor: number
  additionalAmounts: { amountMinor: number }[]
  paymentAmountsMinor: number[]
}

interface RawGroupBill {
  _id: mongoose.Types.ObjectId
  name: string
  date: string
  settlements: { fromPerson: string; toPerson: string; amount: number; settled: boolean }[]
  people: { id: string; name: string }[]
  currency: string
  youPersonId: string
}

interface BuildCashFlowInput {
  today: string       // YYYY-MM-DD
  maxDays: number
  subscriptions: RawSubscription[]
  moneyRecords: RawMoneyRecord[]
  groupBills: RawGroupBill[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().split('T')[0]
}

// ── Main function ─────────────────────────────────────────────────────────────

export function buildCashFlow(input: BuildCashFlowInput): CashFlowEntry[] {
  const { today, maxDays, subscriptions, moneyRecords, groupBills } = input
  const endDate = addDays(today, maxDays)

  // Build a map of date → items
  const dateMap = new Map<string, CashFlowItem[]>()

  const addItem = (date: string, item: CashFlowItem) => {
    if (date < today || date > endDate) return
    if (!dateMap.has(date)) dateMap.set(date, [])
    dateMap.get(date)!.push(item)
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────
  for (const sub of subscriptions) {
    if (!sub.nextBillingDate || sub.status !== 'active') continue
    if (sub.nextBillingDate >= today && sub.nextBillingDate <= endDate) {
      addItem(sub.nextBillingDate, {
        type:        'subscription',
        id:          sub._id.toString(),
        name:        sub.serviceName,
        direction:   'outflow',
        amountMinor: sub.amountMinor,
        date:        sub.nextBillingDate,
      })
    }
  }

  // ── Money records ──────────────────────────────────────────────────────────
  for (const r of moneyRecords) {
    if (!r.dueDate) continue
    const paidMinor = r.paymentAmountsMinor.reduce((s, a) => s + a, 0)
    const extraMinor = r.additionalAmounts.reduce((s, a) => s + a.amountMinor, 0)
    const remaining = r.originalAmountMinor + extraMinor - paidMinor
    if (remaining <= 0) continue

    addItem(r.dueDate, {
      type:        'money_record',
      id:          r._id.toString(),
      name:        r.person.name,
      direction:   r.direction === 'borrowed' ? 'outflow' : 'inflow',
      amountMinor: remaining,
      date:        r.dueDate,
    })
  }

  // ── Group bills ────────────────────────────────────────────────────────────
  for (const bill of groupBills) {
    for (const s of bill.settlements) {
      if (s.settled) continue
      if (s.fromPerson !== bill.youPersonId) continue
      const amountMinor = Math.round(s.amount * 100)
      if (amountMinor <= 0) continue
      addItem(bill.date, {
        type:        'group_bill',
        id:          bill._id.toString(),
        name:        bill.name,
        direction:   'outflow',
        amountMinor,
        date:        bill.date,
      })
    }
  }

  // Build sorted entries
  const entries: CashFlowEntry[] = []
  const sortedDates = Array.from(dateMap.keys()).sort()

  for (const date of sortedDates) {
    const items = dateMap.get(date)!
    const inflowMinor  = items.filter((i) => i.direction === 'inflow').reduce((s, i) => s + i.amountMinor, 0)
    const outflowMinor = items.filter((i) => i.direction === 'outflow').reduce((s, i) => s + i.amountMinor, 0)
    entries.push({
      date,
      label:        date,
      inflowMinor,
      outflowMinor,
      netMinor:     inflowMinor - outflowMinor,
      items,
    })
  }

  return entries
}

export function sliceCashFlow(entries: CashFlowEntry[], days: number): CashFlowEntry[] {
  // entries are already sorted ascending; we just need those within `days` from today
  // Caller passes the full 30-day entries; we filter to the desired window
  return entries.slice(0, days)
}

export function sumCashFlow(entries: CashFlowEntry[]): {
  totalInflowMinor: number
  totalOutflowMinor: number
  netMinor: number
} {
  let totalInflowMinor  = 0
  let totalOutflowMinor = 0
  for (const e of entries) {
    totalInflowMinor  += e.inflowMinor
    totalOutflowMinor += e.outflowMinor
  }
  return { totalInflowMinor, totalOutflowMinor, netMinor: totalInflowMinor - totalOutflowMinor }
}
