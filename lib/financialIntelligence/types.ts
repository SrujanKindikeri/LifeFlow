/**
 * lib/financialIntelligence/types.ts
 *
 * Shared types for the Financial Intelligence module.
 */

// ── Cash flow types ───────────────────────────────────────────────────────────

export interface CashFlowEntry {
  date: string        // YYYY-MM-DD
  label: string       // human-readable label
  inflowMinor: number
  outflowMinor: number
  netMinor: number
  items: CashFlowItem[]
}

export interface CashFlowItem {
  type: 'subscription' | 'money_record' | 'group_bill'
  id: string
  name: string
  direction: 'inflow' | 'outflow'
  amountMinor: number
  date: string
}

// ── Month-end forecast types ──────────────────────────────────────────────────

export interface MonthEndForecast {
  projectedTotalMinor: number
  projectedRemainingBudgetMinor: number
  dailyAverageMinor: number
  daysRemaining: number
  comparedToPrevMonthMinor: number
  onTrack: boolean
}

// ── Budget risk types ─────────────────────────────────────────────────────────

export interface BudgetRisk {
  category: string
  budgetMinor: number
  spentMinor: number
  percentUsed: number
  riskLevel: 'low' | 'medium' | 'high' | 'exceeded'
}

// ── Money owed types ──────────────────────────────────────────────────────────

export interface MoneyOwedEntry {
  recordId: string
  personName: string
  direction: 'given' | 'borrowed'
  remainingMinor: number
  dueDate?: string
  isOverdue: boolean
  isDated: boolean
  href: string
}

// ── Group bill balance types ──────────────────────────────────────────────────

export interface GroupBillBalanceEntry {
  billId: string
  billName: string
  direction: 'i_owe' | 'owed_to_me'
  amountMinor: number
  href: string
}

// ── Duplicate detection types ─────────────────────────────────────────────────

export interface DuplicateCandidate {
  id: string
  amount: number
  date: string
  description?: string
  category?: string
  matchedId: string
  confidence: 'high' | 'medium'
}

// ── Subscription insight types ────────────────────────────────────────────────

export interface SubscriptionInsight {
  subscriptionId: string
  serviceName: string
  amountMinor: number
  currency: string
  nextBillingDate?: string
  billingCycle: string
  insight: 'unused' | 'upcoming' | 'duplicate_charge' | 'price_change'
  details?: string
}

// ── Main output type ──────────────────────────────────────────────────────────

export interface FinancialIntelligenceData {
  generatedAt: string
  currentMonth: string
  today: string

  overview: {
    totalSpentThisMonthMinor: number
    remainingBudgetMinor: number
    totalOutstandingOwedToMeMinor: number
    totalOutstandingIOweMinor: number
    upcomingOutflowMinor: {
      days7: number
      days14: number
      days30: number
    }
  }

  cashFlow: {
    days7:  CashFlowEntry[]
    days14: CashFlowEntry[]
    days30: CashFlowEntry[]
  }

  monthEndForecast: MonthEndForecast

  budgetRisks: BudgetRisk[]

  moneyOwed: {
    owedToMe:         MoneyOwedEntry[]
    iOwe:             MoneyOwedEntry[]
    undatedOwedToMe:  MoneyOwedEntry[]
    undatedIOwe:      MoneyOwedEntry[]
  }

  groupBillBalances: {
    iOwe:      GroupBillBalanceEntry[]
    owedToMe:  GroupBillBalanceEntry[]
  }

  subscriptionInsights: SubscriptionInsight[]
  duplicateCandidates:  DuplicateCandidate[]
}
