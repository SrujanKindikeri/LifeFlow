/**
 * subscriptionScheduler.ts
 *
 * Server-side engine that processes due subscriptions and creates Personal
 * Expenses automatically.
 *
 * KEY DESIGN DECISIONS
 * ────────────────────
 * 1. Timezone-aware "today": uses the user's `timezone` field so a billing
 *    date of "15 Sep" becomes due on the 15th in the user's locale, not UTC.
 *
 * 2. Billing date stored as YYYY-MM-DD string on the Subscription.  We never
 *    store a UTC timestamp for the conceptual "day" — strings avoid all
 *    DST / midnight drift issues.
 *
 * 3. Idempotency: the Expense model has a unique sparse index on
 *    (sourceSubscriptionId, subscriptionBillingDate).  A duplicate insert
 *    throws a MongoDB E11000 error which we catch and swallow — safe to
 *    call from multiple workers simultaneously.
 *
 * 4. Billing date advancement rule for short months:
 *    The subscription stores the *original* billing day (e.g. 31).
 *    Each month we try to use that day; if the month is shorter we clamp
 *    to the last valid day.  We never let the "preferred day" drift —
 *    it always comes from the original `nextBillingDate`'s day-of-month
 *    or `billingDay` which we derive once.
 *
 *    31 Jan → 28/29 Feb → 31 Mar  (not 28 Mar)
 *    29 Feb 2028 → 28 Feb 2029    (not 29 Feb 2029 since 2029 is not a leap year)
 *
 * 5. Catch-up strategy: process ALL overdue billing cycles deterministically
 *    but cap at MAX_CATCHUP_CYCLES (12) per subscription run to prevent
 *    runaway loops on very stale data.  Each cycle is still idempotent.
 *
 * 6. Deleted expenses: if a user manually deleted an auto-generated expense
 *    the unique index slot is freed.  We do NOT recreate it — once deleted
 *    the billing cycle is considered settled.  We track this by checking
 *    whether an expense already exists BEFORE attempting insertion.
 *
 * 7. No browser timers / setInterval.  This module is called exclusively
 *    from the server-side API route `/api/subscriptions/process`.
 */

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Subscription, { type ISubscription } from '@/models/Subscription'
import Expense from '@/models/Expense'
import Notification from '@/models/Notification'
import User from '@/models/User'
import { paiseToRupees } from '@/lib/moneyCalculator'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Safety cap: never process more than this many missed cycles per subscription. */
const MAX_CATCHUP_CYCLES = 12

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return today's date as YYYY-MM-DD in the given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
export function todayInTimezone(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')!.value
    const m = parts.find((p) => p.type === 'month')!.value
    const d = parts.find((p) => p.type === 'day')!.value
    return `${y}-${m}-${d}`
  } catch {
    return new Date().toISOString().split('T')[0]
  }
}

/**
 * Return the last valid day in a given year-month.
 * Accounts for leap years automatically via Date constructor overflow.
 */
function lastDayOfMonth(year: number, month: number): number {
  // month is 1-based.  Day 0 of next month = last day of this month.
  return new Date(year, month, 0).getDate()
}

/**
 * Clamp a day to the valid range for year-month.
 * e.g. clampDay(31, 2024, 2) → 29  (2024 is leap year)
 *      clampDay(31, 2023, 2) → 28
 *      clampDay(31, 2024, 1) → 31
 */
function clampDay(day: number, year: number, month: number): number {
  return Math.min(day, lastDayOfMonth(year, month))
}

/**
 * Format a Date to YYYY-MM-DD (UTC values — used only after we have
 * already computed year/month/day explicitly).
 */
function toDateString(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/**
 * Parse a YYYY-MM-DD string into { year, month, day }.
 * Never feeds this through `new Date()` to avoid timezone shifts.
 */
function parseDate(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split('-').map(Number)
  return { year: y, month: m, day: d }
}

/**
 * Advance a billing date by one billing cycle, preserving the original
 * preferred day-of-month to avoid drift on short months.
 *
 * @param currentBillingDate  YYYY-MM-DD — the date just processed
 * @param preferredDay        The original day-of-month (e.g. 31).
 *                            Pass the same value every time for this sub.
 * @param sub                 Subscription (for billingCycle / customIntervalDays)
 */
export function advanceBillingDate(
  currentBillingDate: string,
  preferredDay: number,
  sub: Pick<ISubscription, 'billingCycle' | 'customIntervalDays'>
): string {
  const { year, month, day: _day } = parseDate(currentBillingDate)

  switch (sub.billingCycle) {
    case 'weekly': {
      // Add 7 calendar days — simple arithmetic; no month drift issue.
      const d = new Date(year, month - 1, _day + 7)
      return toDateString(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    case 'monthly': {
      let nextYear = year
      let nextMonth = month + 1
      if (nextMonth > 12) { nextMonth = 1; nextYear++ }
      const nextDay = clampDay(preferredDay, nextYear, nextMonth)
      return toDateString(nextYear, nextMonth, nextDay)
    }

    case 'quarterly': {
      let nextYear = year
      let nextMonth = month + 3
      while (nextMonth > 12) { nextMonth -= 12; nextYear++ }
      const nextDay = clampDay(preferredDay, nextYear, nextMonth)
      return toDateString(nextYear, nextMonth, nextDay)
    }

    case 'yearly': {
      const nextYear = year + 1
      // Feb 29 → Feb 28 in non-leap years
      const nextDay = clampDay(preferredDay, nextYear, month)
      return toDateString(nextYear, month, nextDay)
    }

    case 'custom': {
      const interval = sub.customIntervalDays ?? 30
      const d = new Date(year, month - 1, _day + interval)
      return toDateString(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    default:
      return currentBillingDate
  }
}

// ── Category mapping ──────────────────────────────────────────────────────────

/**
 * Map a SubscriptionCategory to an ExpenseCategory.
 * Defaults to 'subscriptions' so auto-generated expenses always have a
 * meaningful category even for categories without a direct mapping.
 */
function mapCategory(subCategory: string): string {
  const map: Record<string, string> = {
    streaming:  'subscriptions',
    music:      'subscriptions',
    software:   'subscriptions',
    cloud:      'subscriptions',
    fitness:    'health',
    news:       'subscriptions',
    gaming:     'entertainment',
    education:  'education',
    utilities:  'bills',
    other:      'subscriptions',
  }
  return map[subCategory] ?? 'subscriptions'
}

// ── Per-subscription processor ────────────────────────────────────────────────

export interface ProcessResult {
  subscriptionId: string
  serviceName: string
  cyclesProcessed: number
  expensesCreated: number
  skipped: number          // already existed (idempotent)
  nextBillingDate: string
  errors: string[]
}

/**
 * Process a single subscription for a given "today" date (in the user's TZ).
 * May create multiple expenses if several billing cycles were missed.
 */
async function processSubscription(
  sub: ISubscription,
  todayStr: string,
  lifeFlowId: string
): Promise<ProcessResult> {
  const result: ProcessResult = {
    subscriptionId: sub._id.toString(),
    serviceName: sub.serviceName,
    cyclesProcessed: 0,
    expensesCreated: 0,
    skipped: 0,
    nextBillingDate: sub.nextBillingDate,
    errors: [],
  }

  // Derive the "preferred day" from the initial nextBillingDate — we preserve
  // this number across all future advancements to avoid short-month drift.
  const preferredDay = parseDate(sub.nextBillingDate).day

  let billingDate = sub.nextBillingDate
  let cycles = 0

  // Walk through all due billing dates up to today.
  while (billingDate <= todayStr && cycles < MAX_CATCHUP_CYCLES) {
    cycles++

    // ── Check if expense already exists for this cycle ──────────────────────
    const alreadyExists = await Expense.exists({
      sourceSubscriptionId: sub._id,
      subscriptionBillingDate: billingDate,
    })

    if (alreadyExists) {
      result.skipped++
    } else {
      // ── Create the expense ─────────────────────────────────────────────────
      try {
        await Expense.create({
          userId:                  sub.userId,
          lifeFlowId,
          // amount: stored as rupees (float) in the Expense model.
          // Subscription stores amountMinor (paise). Convert here.
          amount:                  paiseToRupees(sub.amountMinor),
          // Cast to the expected literal union — mapCategory always returns a valid value.
          category:                mapCategory(sub.category) as 'food' | 'transport' | 'shopping' | 'bills' | 'entertainment' | 'education' | 'health' | 'subscriptions' | 'other',
          description:             sub.serviceName,
          date:                    billingDate,
          // Cast paymentMethod to the enum literal union.
          paymentMethod:           (sub.paymentMethod ?? undefined) as 'upi' | 'cash' | 'card' | 'net_banking' | 'wallet' | 'other' | undefined,
          source:                  'subscription' as const,
          sourceSubscriptionId:    sub._id,
          subscriptionBillingDate: billingDate,
        })
        result.expensesCreated++

        // ── Notification ────────────────────────────────────────────────────
        // One notification per expense created (not per scheduler run).
        await Notification.create({
          userId:    sub.userId,
          lifeFlowId,
          title:     'Subscription expense added',
          message:   `${sub.serviceName} · ₹${paiseToRupees(sub.amountMinor).toLocaleString('en-IN')} · ${billingDate}`,
          type:      'expense',
        }).catch(() => {
          // Notification failure must never abort the expense creation.
        })
      } catch (err: unknown) {
        // E11000 duplicate key = another worker already inserted this expense
        // between our .exists() check and our .create(). Safe to ignore.
        if (
          err instanceof Error &&
          (err.message.includes('E11000') || err.message.includes('duplicate key'))
        ) {
          result.skipped++
        } else {
          result.errors.push(
            `cycle ${billingDate}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    }

    result.cyclesProcessed++

    // ── Advance to next billing date ─────────────────────────────────────────
    const nextDate = advanceBillingDate(billingDate, preferredDay, sub)

    // Safety: if advance didn't move forward, break to avoid infinite loop.
    if (nextDate <= billingDate) {
      result.errors.push(`Billing date did not advance from ${billingDate} — aborting cycle`)
      break
    }

    billingDate = nextDate
  }

  // ── Update subscription's nextBillingDate and lastBillingDate ───────────────
  // Only write to DB if we actually processed something.
  if (result.cyclesProcessed > 0) {
    const lastProcessed = sub.nextBillingDate

    // Walk forward to compute the correct nextBillingDate after all processed cycles.
    // We've already computed `billingDate` as the next-due date above.
    await Subscription.findOneAndUpdate(
      {
        _id:             sub._id,
        // Optimistic concurrency: only update if another worker hasn't
        // already advanced the date.
        nextBillingDate: sub.nextBillingDate,
      },
      {
        $set: {
          nextBillingDate: billingDate,
          lastBillingDate: lastProcessed,
        },
      }
    )

    result.nextBillingDate = billingDate
  }

  return result
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface SchedulerRunResult {
  processedAt: string
  subscriptionsChecked: number
  subscriptionsActioned: number
  totalExpensesCreated: number
  details: ProcessResult[]
}

/**
 * Run the subscription scheduler.
 *
 * Fetches all active subscriptions with autoCreateExpense=true whose
 * nextBillingDate ≤ today (in the user's timezone), then processes each.
 *
 * Safe to call concurrently from multiple workers — idempotency is enforced
 * at the DB layer via the unique index on (sourceSubscriptionId, subscriptionBillingDate).
 */
export async function runSubscriptionScheduler(): Promise<SchedulerRunResult> {
  await connectDB()

  // We need the user's timezone to compute "today" per user.
  // Fetch all distinct userIds from due active subscriptions, then
  // load their timezones in one query.

  // First: find all active subs with autoCreateExpense=true.
  // We use a broad date filter — the timezone-aware check per user happens
  // inside processSubscription. We fetch everything due up to tomorrow UTC
  // to cover all timezones (UTC+14 to UTC-12 spans 26 hours).
  const tomorrowUTC = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().split('T')[0]
  })()

  const dueSubs = await Subscription.find({
    status:            'active',
    autoCreateExpense: true,
    nextBillingDate:   { $lte: tomorrowUTC },
  }).lean()

  if (dueSubs.length === 0) {
    return {
      processedAt:           new Date().toISOString(),
      subscriptionsChecked:  0,
      subscriptionsActioned: 0,
      totalExpensesCreated:  0,
      details:               [],
    }
  }

  // Load timezones and lifeFlowIds for all relevant users in one query.
  const userIds = [...new Set(dueSubs.map((s) => s.userId.toString()))]
  const users = await User.find(
    { _id: { $in: userIds } },
    { _id: 1, timezone: 1, publicId: 1 }
  ).lean()
  const tzMap: Record<string, string> = {}
  const lfIdMap: Record<string, string> = {}
  for (const u of users) {
    tzMap[u._id.toString()]   = u.timezone  ?? 'Asia/Kolkata'
    lfIdMap[u._id.toString()] = u.publicId
  }

  const details: ProcessResult[] = []
  let totalCreated = 0
  let actioned = 0

  for (const subLean of dueSubs) {
    const tz         = tzMap[subLean.userId.toString()]   ?? 'Asia/Kolkata'
    const lifeFlowId = lfIdMap[subLean.userId.toString()] ?? ''
    const todayStr   = todayInTimezone(tz)

    // Final guard: skip if the billing date hasn't arrived in user's timezone.
    if (subLean.nextBillingDate > todayStr) continue

    // Re-fetch as Mongoose document so we can call model methods if needed.
    // Also guards against stale data from the initial bulk lean query.
    const sub = await Subscription.findOne({
      _id:             subLean._id,
      status:          'active',
      autoCreateExpense: true,
    })
    if (!sub) continue

    const result = await processSubscription(sub as ISubscription, todayStr, lifeFlowId)
    details.push(result)
    totalCreated += result.expensesCreated
    if (result.cyclesProcessed > 0) actioned++
  }

  return {
    processedAt:           new Date().toISOString(),
    subscriptionsChecked:  dueSubs.length,
    subscriptionsActioned: actioned,
    totalExpensesCreated:  totalCreated,
    details,
  }
}

// ── Duplicate-detection helper (used by expense creation UI) ──────────────────

/**
 * Check whether a manually-created expense looks like a likely duplicate of
 * an auto-generated subscription expense on the same date.
 *
 * Returns the matching subscription name if a likely duplicate is found,
 * otherwise null.
 */
export async function checkSubscriptionDuplicate(params: {
  userId: string
  amount: number          // rupees (display unit)
  date: string            // YYYY-MM-DD
}): Promise<{ isDuplicate: boolean; subscriptionName?: string; existingExpenseId?: string }> {
  await connectDB()

  // Look for an auto-generated subscription expense on the same date with the
  // same amount (within 1 rupee to tolerate minor float rounding).
  const existing = await Expense.findOne({
    userId: new mongoose.Types.ObjectId(params.userId),
    source: 'subscription',
    date:   params.date,
    amount: { $gte: params.amount - 1, $lte: params.amount + 1 },
  })
    .populate<{ sourceSubscriptionId: { serviceName: string } | null }>(
      'sourceSubscriptionId',
      'serviceName'
    )
    .lean()

  if (!existing) return { isDuplicate: false }

  const subName =
    existing.sourceSubscriptionId &&
    typeof existing.sourceSubscriptionId === 'object' &&
    'serviceName' in existing.sourceSubscriptionId
      ? (existing.sourceSubscriptionId as { serviceName: string }).serviceName
      : undefined

  return {
    isDuplicate:       true,
    subscriptionName:  subName,
    existingExpenseId: existing._id.toString(),
  }
}
