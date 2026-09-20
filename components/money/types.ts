/**
 * Client-side types for the Money Tracker UI.
 * Mirror the API response shape from /api/money-records.
 */

export type MoneyDirection = 'given' | 'borrowed'
export type MoneyStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue'

export interface MoneyPerson {
  name: string
  phone?: string
  email?: string
  lifeFlowId?: string
}

export interface MoneyPaymentData {
  _id: string
  userId: string
  moneyRecordId: string
  amountMinor: number
  paymentDate: string
  note?: string
  createdAt: string
  updatedAt: string
}

/** An additional amount added to an existing record after creation. */
export interface MoneyAdditionalAmountData {
  _id: string
  amountMinor: number
  reason: string
  date: string
  note?: string
  createdAt: string
}

export interface MoneyRecordData {
  _id: string
  userId: string
  person: MoneyPerson
  direction: MoneyDirection
  /** The immutable first amount given/borrowed. Never changes after creation. */
  originalAmountMinor: number
  /**
   * originalAmountMinor + sum of all additionalAmounts.
   * This is the number displayed as the "total" in the UI.
   * Falls back to originalAmountMinor for records that existed before this
   * feature was added (additionalAmounts will be an empty array).
   */
  totalAmountMinor: number
  additionalAmounts: MoneyAdditionalAmountData[]
  currency: string
  reason: string
  category?: string
  givenDate: string
  dueDate?: string
  note?: string
  status: MoneyStatus
  paidMinor: number
  remainingMinor: number
  payments: MoneyPaymentData[]
  createdAt: string
  updatedAt: string
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function formatPaiseDisplay(paise: number, currency = 'INR'): string {
  const symbols: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }
  const symbol = symbols[currency] ?? currency
  const amount = paise / 100
  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

export function statusLabel(status: MoneyStatus): string {
  switch (status) {
    case 'pending':        return 'Pending'
    case 'partially_paid': return 'Partially Paid'
    case 'paid':           return 'Paid'
    case 'overdue':        return 'Overdue'
  }
}

export function statusColor(status: MoneyStatus): string {
  switch (status) {
    case 'pending':        return 'text-amber-500'
    case 'partially_paid': return 'text-blue-500'
    case 'paid':           return 'text-emerald-500'
    case 'overdue':        return 'text-red-500'
  }
}

export function statusBg(status: MoneyStatus): string {
  switch (status) {
    case 'pending':        return 'bg-amber-500/10 border-amber-500/25'
    case 'partially_paid': return 'bg-blue-500/10 border-blue-500/25'
    case 'paid':           return 'bg-emerald-500/10 border-emerald-500/25'
    case 'overdue':        return 'bg-red-500/10 border-red-500/25'
  }
}

/** Build a human-readable payment direction sentence. */
export function paymentDirectionText(
  direction: MoneyDirection,
  personName: string,
  amountStr: string
): string {
  return direction === 'given'
    ? `${personName} paid you ${amountStr}`
    : `You paid ${personName} ${amountStr}`
}

/** Date formatted as "Sep 2" style */
export function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}
