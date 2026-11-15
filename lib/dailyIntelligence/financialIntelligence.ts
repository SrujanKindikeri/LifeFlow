/**
 * lib/dailyIntelligence/financialIntelligence.ts
 *
 * Surfaces relevant financial alerts for the Daily Intelligence briefing.
 *
 * RULES
 * ─────
 * • Only include items that are actionable or time-sensitive today.
 * • Never count the same financial event twice across modules.
 * • Never invent balances, predict income, or present estimates as confirmed.
 * • Amounts from Subscription / Budget use amountMinor (paise).
 * • Amounts from Expense use amount (rupees) — convert with × 100 to get paise.
 * • MoneyRecord amounts are in paise (originalAmountMinor).
 *
 * DEDUPLICATION
 * ─────────────
 * A subscription that has already created an Expense for the same billing date
 * (Expense.source = 'subscription', Expense.subscriptionBillingDate = today)
 * is reported as a subscription fact, NOT also as an expense item — avoiding
 * double-counting.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type FinancialAlertKind =
  | 'subscription_renewal_today'
  | 'subscription_renewal_soon'
  | 'budget_near_limit'
  | 'budget_exceeded'
  | 'money_due_today'
  | 'money_overdue'

export interface FinancialAlert {
  kind: FinancialAlertKind
  title: string
  description: string
  amountMinor?: number       // paise, if applicable
  currency?: string
  dueDate?: string           // YYYY-MM-DD
  href: string               // deep-link to the relevant record
  /** The source record ID to use as a deduplication key */
  sourceId: string
}

// ─── Raw input shapes ─────────────────────────────────────────────────────────

interface RawSubscription {
  _id: { toString(): string }
  serviceName: string
  amountMinor: number
  currency: string
  nextBillingDate: string
  status: string
}

interface RawBudget {
  _id: { toString(): string }
  category: string
  amountMinor: number
  currency: string
  month: string
}

interface RawExpense {
  _id: { toString(): string }
  amount: number             // RUPEES
  category: string
  source: string
  sourceSubscriptionId?: { toString(): string }
  subscriptionBillingDate?: string
  date: string
}

interface RawMoneyRecord {
  _id: { toString(): string }
  person: { name: string }
  direction: 'given' | 'borrowed'
  dueDate?: string
  status: string
  originalAmountMinor: number
  additionalAmounts: { amountMinor: number }[]
}

interface RawMoneyPayment {
  moneyRecordId: { toString(): string }
  amountMinor: number
}

// ─── Category display names ────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  food:          'Food & Dining',
  transport:     'Transport',
  shopping:      'Shopping',
  bills:         'Bills & Utilities',
  entertainment: 'Entertainment',
  education:     'Education',
  health:        'Health & Wellness',
  subscriptions: 'Subscriptions',
  other:         'Other',
}

// ─── Main function ─────────────────────────────────────────────────────────────

export interface BuildFinancialAlertsInput {
  today: string              // YYYY-MM-DD in user's timezone
  currentMonth: string       // YYYY-MM in user's timezone
  /** Only active subscriptions (pre-filtered by caller) */
  subscriptions: RawSubscription[]
  budgets: RawBudget[]
  /** All personal expenses for current month (pre-filtered by caller) */
  monthExpenses: RawExpense[]
  moneyRecords: RawMoneyRecord[]
  moneyPayments: RawMoneyPayment[]
  /** Whether user has opted into financial insights */
  includeFinancial: boolean
}

export function buildFinancialAlerts(input: BuildFinancialAlertsInput): FinancialAlert[] {
  if (!input.includeFinancial) return []

  const { today, currentMonth, subscriptions, budgets, monthExpenses, moneyRecords, moneyPayments } = input
  const alerts: FinancialAlert[] = []
  const seenSourceIds = new Set<string>()

  // ── Compute tomorrow's date for "renewal soon" look-ahead ─────────────────
  const [ty, tm, td] = today.split('-').map(Number)
  const tomorrow = new Date(Date.UTC(ty, tm - 1, td + 1))
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const in3Days = new Date(Date.UTC(ty, tm - 1, td + 3))
  const in3DaysStr = in3Days.toISOString().split('T')[0]

  // ── 1. Subscription renewals ───────────────────────────────────────────────
  // Track which subscription IDs have already generated an expense today
  // to avoid double-counting.
  const autoExpensedSubIds = new Set(
    monthExpenses
      .filter((e) => e.source === 'subscription' && e.subscriptionBillingDate === today)
      .map((e) => e.sourceSubscriptionId?.toString())
      .filter(Boolean)
  )

  for (const sub of subscriptions) {
    if (sub.status !== 'active') continue
    const id = sub._id.toString()
    if (seenSourceIds.has(id)) continue

    if (sub.nextBillingDate === today) {
      alerts.push({
        kind: 'subscription_renewal_today',
        title: `${sub.serviceName} renews today`,
        description: autoExpensedSubIds.has(id)
          ? `${sub.serviceName} renewed today — expense already recorded.`
          : `${sub.serviceName} is due for renewal today.`,
        amountMinor: sub.amountMinor,
        currency: sub.currency,
        dueDate: today,
        href: `/app/subscriptions`,
        sourceId: id,
      })
      seenSourceIds.add(id)
    } else if (sub.nextBillingDate === tomorrowStr || sub.nextBillingDate <= in3DaysStr) {
      alerts.push({
        kind: 'subscription_renewal_soon',
        title: `${sub.serviceName} renews ${sub.nextBillingDate === tomorrowStr ? 'tomorrow' : `on ${sub.nextBillingDate}`}`,
        description: `${sub.serviceName} will renew ${sub.nextBillingDate === tomorrowStr ? 'tomorrow' : `in a few days`}.`,
        amountMinor: sub.amountMinor,
        currency: sub.currency,
        dueDate: sub.nextBillingDate,
        href: `/app/subscriptions`,
        sourceId: id,
      })
      seenSourceIds.add(id)
    }
  }

  // ── 2. Budget alerts ───────────────────────────────────────────────────────
  // Calculate current month spending per category
  const spendByCategoryPaise = new Map<string, number>()
  for (const e of monthExpenses) {
    const paise = Math.round(e.amount * 100)
    spendByCategoryPaise.set(e.category, (spendByCategoryPaise.get(e.category) ?? 0) + paise)
  }

  for (const budget of budgets) {
    if (budget.month !== currentMonth) continue
    const spentPaise = spendByCategoryPaise.get(budget.category) ?? 0
    const percent = budget.amountMinor > 0 ? (spentPaise / budget.amountMinor) * 100 : 0
    const id = budget._id.toString()
    if (seenSourceIds.has(id)) continue
    const label = CATEGORY_LABELS[budget.category] ?? budget.category

    if (percent >= 100) {
      alerts.push({
        kind: 'budget_exceeded',
        title: `${label} budget exceeded`,
        description: `You've spent ${Math.round(percent)}% of your ${label} budget this month.`,
        amountMinor: spentPaise,
        currency: budget.currency,
        href: `/app/budgets`,
        sourceId: id,
      })
      seenSourceIds.add(id)
    } else if (percent >= 80) {
      alerts.push({
        kind: 'budget_near_limit',
        title: `${label} budget at ${Math.round(percent)}%`,
        description: `You've used ${Math.round(percent)}% of your ${label} budget — ${budget.amountMinor - spentPaise > 0 ? `₹${((budget.amountMinor - spentPaise) / 100).toFixed(0)} remaining` : 'limit reached'}.`,
        amountMinor: spentPaise,
        currency: budget.currency,
        href: `/app/budgets`,
        sourceId: id,
      })
      seenSourceIds.add(id)
    }
  }

  // ── 3. Money records due today / overdue ───────────────────────────────────
  // Build payment totals
  const paymentSumMap = new Map<string, number>()
  for (const p of moneyPayments) {
    const key = p.moneyRecordId.toString()
    paymentSumMap.set(key, (paymentSumMap.get(key) ?? 0) + p.amountMinor)
  }

  for (const r of moneyRecords) {
    if (!r.dueDate) continue
    const id = r._id.toString()
    if (seenSourceIds.has(id)) continue

    const totalMinor = r.originalAmountMinor + r.additionalAmounts.reduce((s, a) => s + a.amountMinor, 0)
    const paidMinor = paymentSumMap.get(id) ?? 0
    const remainingMinor = Math.max(0, totalMinor - paidMinor)
    if (remainingMinor === 0) continue // fully paid

    const verb = r.direction === 'given' ? `${r.person.name} owes you` : `You owe ${r.person.name}`

    if (r.dueDate === today) {
      alerts.push({
        kind: 'money_due_today',
        title: `Money due today: ${r.person.name}`,
        description: `${verb} — due today.`,
        amountMinor: remainingMinor,
        currency: 'INR',
        dueDate: today,
        href: `/app/money`,
        sourceId: id,
      })
      seenSourceIds.add(id)
    } else if (r.dueDate < today) {
      alerts.push({
        kind: 'money_overdue',
        title: `Overdue payment: ${r.person.name}`,
        description: `${verb} — was due on ${r.dueDate}.`,
        amountMinor: remainingMinor,
        currency: 'INR',
        dueDate: r.dueDate,
        href: `/app/money`,
        sourceId: id,
      })
      seenSourceIds.add(id)
    }
  }

  // Sort: today-critical first, then by kind priority
  const KIND_ORDER: Record<FinancialAlertKind, number> = {
    subscription_renewal_today: 0,
    money_due_today:            1,
    budget_exceeded:            2,
    money_overdue:              3,
    budget_near_limit:          4,
    subscription_renewal_soon:  5,
  }
  alerts.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  return alerts
}
