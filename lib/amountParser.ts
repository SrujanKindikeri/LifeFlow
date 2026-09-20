/**
 * amountParser.ts — safe monetary expression parser for LifeFlow
 *
 * Parses expressions like "40+40+10" or "100.50 + 20" into a numeric result.
 *
 * SAFETY:
 *   - Never uses eval() or Function()
 *   - Only allows: digits, decimal points, +, and whitespace
 *   - Rejects any other characters (-, *, /, %, letters, parentheses, etc.)
 *
 * PRECISION:
 *   - Converts each term to integer paise (minor units) before summing
 *   - This avoids floating-point errors like 0.10 + 0.20 = 0.30000000000000004
 *   - Returns result in rupees (float)
 */

/** Characters allowed in a monetary expression (digits, dot, plus, whitespace). */
const SAFE_PATTERN = /^[\d.\s+]+$/

/** A single term (number with optional decimal). */
const TERM_PATTERN = /^\d+(\.\d+)?$/

export interface ParseResult {
  /** The calculated numeric value in rupees, or null if invalid/empty. */
  value: number | null
  /**
   * Whether the input contains an expression (has a + operator).
   * Used to show/hide the calculation preview.
   */
  isExpression: boolean
  /** Human-readable error if the expression is invalid. */
  error: string | null
}

/**
 * Parse a monetary expression string into a numeric result.
 *
 * @param input - Raw string from the input field (e.g. "40+40+10", "100.50", "0.10 + 0.20")
 * @returns ParseResult with value (rupees), isExpression flag, and error message
 *
 * @example
 * parseAmountExpression("40+40+10")   // { value: 90,     isExpression: true,  error: null }
 * parseAmountExpression("100.50")     // { value: 100.50, isExpression: false, error: null }
 * parseAmountExpression("0.10+0.20")  // { value: 0.30,   isExpression: true,  error: null }
 * parseAmountExpression("40*10")      // { value: null,   isExpression: false, error: "Enter a valid amount" }
 * parseAmountExpression("")           // { value: null,   isExpression: false, error: null }
 */
export function parseAmountExpression(input: string): ParseResult {
  const trimmed = input.trim()

  // Empty input — not an error, just no value
  if (trimmed === '') {
    return { value: null, isExpression: false, error: null }
  }

  // Safety check: reject anything outside the allowed character set
  if (!SAFE_PATTERN.test(trimmed)) {
    return { value: null, isExpression: false, error: 'Enter a valid amount' }
  }

  const isExpression = trimmed.includes('+')

  // Split into terms on '+', strip whitespace from each
  const terms = trimmed.split('+').map((t) => t.trim())

  // Validate each term individually
  for (const term of terms) {
    // Empty term means something like "40+" (trailing plus) or "40++10"
    if (term === '') {
      // Trailing/leading plus is allowed while typing — just skip for now
      // (the preview won't show and value stays null until expression is complete)
      return { value: null, isExpression, error: null }
    }
    if (!TERM_PATTERN.test(term)) {
      return { value: null, isExpression, error: 'Enter a valid amount' }
    }
    // Reject multiple decimal points in a single term (TERM_PATTERN already handles this,
    // but be explicit about 40.20.30)
    const dots = (term.match(/\./g) || []).length
    if (dots > 1) {
      return { value: null, isExpression, error: 'Enter a valid amount' }
    }
  }

  // Sum using integer paise to avoid floating-point errors
  // e.g. 0.10 + 0.20 → 10 paise + 20 paise = 30 paise → ₹0.30
  let totalPaise = 0
  for (const term of terms) {
    if (term === '') continue
    // Parse to paise: multiply by 100, round to avoid float imprecision in the multiplication
    const rupees = parseFloat(term)
    if (isNaN(rupees)) {
      return { value: null, isExpression, error: 'Enter a valid amount' }
    }
    totalPaise += Math.round(rupees * 100)
  }

  const value = totalPaise / 100

  // Reject negative results (shouldn't happen with + only, but guard anyway)
  if (value < 0) {
    return { value: null, isExpression, error: 'Amount must be positive' }
  }

  return { value, isExpression, error: null }
}

/**
 * Format a rupee amount for display in the calculation preview.
 * Uses the same symbol map as formatCurrency() in lib/utils.ts.
 *
 * @param amount - Amount in rupees
 * @param currency - Currency code (default 'INR')
 */
export function formatAmountPreview(amount: number, currency = 'INR'): string {
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  }
  const symbol = symbols[currency] ?? currency
  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
