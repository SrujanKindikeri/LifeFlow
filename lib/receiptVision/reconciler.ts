/**
 * lib/receiptVision/reconciler.ts
 *
 * Deterministic financial reconciler for receipt extractions.
 *
 * ALL arithmetic is performed in INTEGER MINOR UNITS (paise) to eliminate
 * floating-point rounding errors.
 *
 * Checks performed:
 *   1. Per-item:   quantity × unitPriceMinor ≈ lineTotalMinor   (±1 paise tolerance)
 *   2. Subtotal:   Σ(lineTotalMinor) ≈ subtotalMinor             (±2 paise tolerance)
 *   3. Grand total: subtotal + taxes + serviceCharge + roundOff - discount
 *                   ≈ grandTotalMinor                             (±5 paise tolerance)
 *
 * The reconciler NEVER modifies the extraction. It only reports what matches.
 */

import type {
  ReceiptExtraction,
  ReconciliationResult,
  ItemReconciliation,
} from './types'

// ─── Tolerances ────────────────────────────────────────────────────────────────

const ITEM_TOLERANCE      = 1   // 1 paise for per-item checks
const SUBTOTAL_TOLERANCE  = 2   // 2 paise for subtotal
const GRAND_TOLERANCE     = 5   // 5 paise for grand total (rounding accumulates)

// ─── Main reconciler ──────────────────────────────────────────────────────────

export function reconcileExtraction(e: ReceiptExtraction): ReconciliationResult {
  // ── 1. Per-item math ─────────────────────────────────────────────────────
  const itemChecks: ItemReconciliation[] = e.items.map((item, index) => {
    const computedMinor = item.quantity * item.unitPriceMinor
    const match = Math.abs(computedMinor - item.lineTotalMinor) <= ITEM_TOLERANCE
    return { index, computedMinor, extractedMinor: item.lineTotalMinor, match }
  })

  const itemsMatchLinetotals = itemChecks.every((c) => c.match)

  // ── 2. Subtotal check ─────────────────────────────────────────────────────
  const computedSubtotalMinor = e.items.reduce((sum, item) => sum + item.lineTotalMinor, 0)

  let linetoalsSumToSubtotal: boolean | null = null
  if (e.subtotalMinor !== null) {
    linetoalsSumToSubtotal =
      Math.abs(computedSubtotalMinor - e.subtotalMinor) <= SUBTOTAL_TOLERANCE
  }

  // ── 3. Grand total reconciliation ─────────────────────────────────────────
  const baseForTotal = e.subtotalMinor ?? computedSubtotalMinor
  const totalTaxMinor = e.taxes.reduce((sum, t) => sum + t.amountMinor, 0)

  const computedGrandTotalMinor =
    baseForTotal +
    totalTaxMinor +
    e.serviceChargeMinor +
    e.roundOffMinor -
    e.discountMinor

  let totalsReconcile: boolean | null = null
  if (e.grandTotalMinor !== null) {
    totalsReconcile =
      Math.abs(computedGrandTotalMinor - e.grandTotalMinor) <= GRAND_TOLERANCE
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const summary = buildSummary({
    itemChecks,
    itemsMatchLinetotals,
    linetoalsSumToSubtotal,
    totalsReconcile,
    computedSubtotalMinor,
    extractedSubtotalMinor:   e.subtotalMinor,
    computedGrandTotalMinor,
    extractedGrandTotalMinor: e.grandTotalMinor,
  })

  return {
    itemChecks,
    computedSubtotalMinor,
    extractedSubtotalMinor:   e.subtotalMinor,
    computedGrandTotalMinor,
    extractedGrandTotalMinor: e.grandTotalMinor,
    itemsMatchLinetotals,
    linetoalsSumToSubtotal,
    totalsReconcile,
    summary,
  }
}

// ─── Recovery trigger ─────────────────────────────────────────────────────────

/**
 * Decide whether to attempt a second OCR pass.
 * Triggers when extraction looks incomplete or financially inconsistent.
 */
export function shouldAttemptRecovery(
  e: ReceiptExtraction,
  r: ReconciliationResult,
): boolean {
  if (e.items.length < 2)                return true
  if (e.overallConfidence < 0.60)        return true
  if (e.grandTotalMinor === null)         return true
  if (!r.itemsMatchLinetotals)            return true
  if (r.linetoalsSumToSubtotal === false) return true
  if (r.totalsReconcile === false)        return true
  return false
}

/**
 * Compare two extractions and return the better one.
 * Priority: more items → better reconciliation → higher confidence → has grand total.
 */
export function pickBetterExtraction(
  a: ReceiptExtraction, ra: ReconciliationResult,
  b: ReceiptExtraction, rb: ReconciliationResult,
): 'a' | 'b' {
  if (b.items.length > a.items.length)  return 'b'
  if (a.items.length > b.items.length)  return 'a'

  const aScore = reconciliationScore(ra)
  const bScore = reconciliationScore(rb)
  if (bScore > aScore) return 'b'
  if (aScore > bScore) return 'a'

  if (b.overallConfidence > a.overallConfidence) return 'b'
  if (a.overallConfidence > b.overallConfidence) return 'a'

  if (b.grandTotalMinor !== null && a.grandTotalMinor === null) return 'b'

  return 'a'
}

// ─── Review flags ──────────────────────────────────────────────────────────────

/**
 * Build human-readable review flag strings for the UI.
 */
export function buildReviewFlags(
  e: ReceiptExtraction,
  r: ReconciliationResult,
): string[] {
  const flags: string[] = []

  const mismatched = r.itemChecks.filter((c) => !c.match)
  if (mismatched.length === 1) {
    const item = e.items[mismatched[0].index]
    flags.push(
      `"${item.name}": quantity × unit price doesn't match the line total. Please verify.`,
    )
  } else if (mismatched.length > 1) {
    flags.push(
      `${mismatched.length} items have quantity × unit price mismatches. Please review item prices.`,
    )
  }

  if (r.linetoalsSumToSubtotal === false) {
    const diff = Math.abs((r.extractedSubtotalMinor ?? 0) - r.computedSubtotalMinor)
    flags.push(
      `Item totals sum to ${fmt(r.computedSubtotalMinor)}, ` +
      `but receipt shows ${fmt(r.extractedSubtotalMinor ?? 0)} — ` +
      `difference of ${fmt(diff)}.`,
    )
  }

  if (r.totalsReconcile === false) {
    const diff = Math.abs((r.extractedGrandTotalMinor ?? 0) - r.computedGrandTotalMinor)
    flags.push(
      `Computed grand total (${fmt(r.computedGrandTotalMinor)}) ` +
      `doesn't match receipt (${fmt(r.extractedGrandTotalMinor ?? 0)}) — ` +
      `difference of ${fmt(diff)}.`,
    )
  }

  if (e.grandTotalMinor === null) {
    flags.push('Grand total not visible in scanned image.')
  }

  const lowConfItems = e.items.filter(
    (it) =>
      it.confidence.name < 0.60 ||
      it.confidence.unitPrice < 0.60 ||
      it.confidence.lineTotal < 0.60,
  )
  if (lowConfItems.length > 0) {
    flags.push(
      `${lowConfItems.length} item${lowConfItems.length > 1 ? 's' : ''} ` +
      `had low confidence — please verify the highlighted fields.`,
    )
  }

  if (e.items.length < 2 && (e.subtotalMinor ?? 0) > 10000) {
    flags.push(
      'Only 1 item was detected but the subtotal suggests more items. ' +
      'Some items may have been missed.',
    )
  }

  return flags
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function reconciliationScore(r: ReconciliationResult): number {
  let s = 0
  if (r.itemsMatchLinetotals)           s++
  if (r.linetoalsSumToSubtotal === true) s++
  if (r.totalsReconcile === true)        s++
  return s
}

function fmt(minor: number): string {
  return '₹' + (minor / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function buildSummary(args: {
  itemChecks:               ItemReconciliation[]
  itemsMatchLinetotals:     boolean
  linetoalsSumToSubtotal:   boolean | null
  totalsReconcile:          boolean | null
  computedSubtotalMinor:    number
  extractedSubtotalMinor:   number | null
  computedGrandTotalMinor:  number
  extractedGrandTotalMinor: number | null
}): string {
  const parts: string[] = []

  parts.push(
    args.itemsMatchLinetotals
      ? `All ${args.itemChecks.length} item(s): qty×price=total ✓`
      : `${args.itemChecks.filter((c) => !c.match).length} item(s) with math mismatch`,
  )

  if (args.linetoalsSumToSubtotal !== null) {
    parts.push(args.linetoalsSumToSubtotal ? 'Subtotal ✓' : 'Subtotal mismatch')
  }

  if (args.totalsReconcile !== null) {
    parts.push(args.totalsReconcile ? 'Grand total ✓' : 'Grand total mismatch')
  } else {
    parts.push('Grand total not found')
  }

  return parts.join(' | ')
}
