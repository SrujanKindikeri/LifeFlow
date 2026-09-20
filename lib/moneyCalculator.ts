/**
 * Money Tracker — pure arithmetic helpers.
 *
 * All amounts are stored and computed in integer minor units (paise for INR).
 * 1 rupee = 100 paise.  Never use floating-point for money math.
 */

import type { MoneyStatus, IMoneyAdditionalAmount } from '@/models/MoneyRecord'

// ── Unit conversion ───────────────────────────────────────────────────────────

/** Convert display rupees (may have decimals) to integer paise. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Convert integer paise to display rupees string. */
export function paiseToRupees(paise: number): number {
  return paise / 100
}

/** Format paise as a localised ₹ string. */
export function formatPaise(paise: number, currency = 'INR'): string {
  const symbols: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }
  const symbol = symbols[currency] ?? currency
  const rupees = paiseToRupees(paise)
  return `${symbol}${rupees.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

// ── Total amount ──────────────────────────────────────────────────────────────

/**
 * Compute the total amount owed/lent by adding the original amount to all
 * additional amounts that were added after the record was created.
 *
 * originalAmountMinor is NEVER mutated — this is the safe accumulator.
 */
export function getTotalAmountMinor(
  originalAmountMinor: number,
  additionalAmounts: Pick<IMoneyAdditionalAmount, 'amountMinor'>[]
): number {
  return additionalAmounts.reduce((sum, a) => sum + a.amountMinor, originalAmountMinor)
}

// ── Balance calculation ───────────────────────────────────────────────────────

export interface MoneyBalance {
  originalMinor:  number
  totalMinor:     number   // originalMinor + all additional amounts
  paidMinor:      number
  remainingMinor: number
}

/**
 * Calculate the outstanding balance.
 *
 * @param originalAmountMinor  The immutable original amount in paise.
 * @param additionalAmounts    Any amounts added after creation (may be empty).
 * @param paymentAmountsPaise  All recorded payment amounts in paise.
 *
 * Immutable — never modifies the input arrays.
 */
export function calcBalance(
  originalAmountMinor: number,
  additionalAmounts: Pick<IMoneyAdditionalAmount, 'amountMinor'>[],
  paymentAmountsPaise: number[]
): MoneyBalance {
  const totalMinor    = getTotalAmountMinor(originalAmountMinor, additionalAmounts)
  const paidMinor     = paymentAmountsPaise.reduce((sum, p) => sum + p, 0)
  const remainingMinor = totalMinor - paidMinor
  return {
    originalMinor: originalAmountMinor,
    totalMinor,
    paidMinor,
    remainingMinor: Math.max(0, remainingMinor),
  }
}

// ── Status derivation ─────────────────────────────────────────────────────────

/**
 * Derive the canonical status from balance + optional due date.
 * This is the single source of truth — never let the client supply a status.
 */
export function deriveStatus(
  balance: MoneyBalance,
  dueDate?: string
): MoneyStatus {
  if (balance.remainingMinor === 0) return 'paid'

  if (dueDate) {
    const today = new Date().toISOString().split('T')[0]
    if (dueDate < today) return 'overdue'
  }

  if (balance.paidMinor === 0) return 'pending'
  return 'partially_paid'
}

// ── Overpayment guard ─────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean
  error?: string
  maxAllowedMinor?: number
}

/** Validate that a new payment does not exceed the remaining balance. */
export function validatePayment(
  remainingMinor: number,
  newPaymentMinor: number
): ValidationResult {
  if (newPaymentMinor <= 0) {
    return { ok: false, error: 'Payment amount must be greater than zero.' }
  }
  if (newPaymentMinor > remainingMinor) {
    return {
      ok: false,
      error: `Payment exceeds the remaining balance. Maximum payment: ${formatPaise(remainingMinor)}.`,
      maxAllowedMinor: remainingMinor,
    }
  }
  return { ok: true }
}

/**
 * Validate an edit to an existing payment.
 * `currentPaymentMinor` is the old amount being replaced.
 */
export function validatePaymentEdit(
  remainingMinorBefore: number,
  currentPaymentMinor: number,
  newPaymentMinor: number
): ValidationResult {
  // Remaining if the old payment is reversed
  const availableMinor = remainingMinorBefore + currentPaymentMinor
  if (newPaymentMinor <= 0) {
    return { ok: false, error: 'Payment amount must be greater than zero.' }
  }
  if (newPaymentMinor > availableMinor) {
    return {
      ok: false,
      error: `Edited amount exceeds the remaining balance. Maximum: ${formatPaise(availableMinor)}.`,
      maxAllowedMinor: availableMinor,
    }
  }
  return { ok: true }
}
