/**
 * lib/receiptVision/types.ts
 *
 * Canonical types for the context-aware receipt extraction pipeline.
 *
 * Architecture:
 *   Receipt image
 *     ↓ Ollama vision-language model (if available) OR Tesseract + spatial parser
 *     ↓ ReceiptExtraction  (structured JSON — never raw OCR text)
 *     ↓ reconcileExtraction()
 *     ↓ ScanPipelineResult  (to review screen)
 *
 * Financial values:
 *   All stored as INTEGER MINOR UNITS (paise) throughout the extraction,
 *   validation, and reconciliation layers. Converted to decimal rupees only
 *   at the UI boundary.
 *
 * Null discipline:
 *   Missing values are explicitly null — NEVER invented or defaulted to 0.
 *   The review screen must show null as "not found" and let the user fill in.
 *
 * Receipt sections — only ITEMS become bill line items:
 *   A. MERCHANT INFO   — name, address, phone, GSTIN, FSSAI
 *   B. BILL METADATA   — bill number, date, time, order type, table no, token no
 *   C. ITEM TABLE      ← only these become BillItems
 *   D. FINANCIAL SUMMARY — subtotal, taxes, service charge, discount, grand total
 */

// ─── Confidence ────────────────────────────────────────────────────────────

/** 0–1 confidence score. */
export type ConfidenceScore = number

/** Coarse bucket derived from a ConfidenceScore. */
export type ConfidenceBucket = 'high' | 'medium' | 'low'

export function toBucket(score: ConfidenceScore): ConfidenceBucket {
  if (score >= 0.85) return 'high'
  if (score >= 0.60) return 'medium'
  return 'low'
}

// ─── Per-item field confidence ─────────────────────────────────────────────

export interface ItemFieldConfidence {
  name:       ConfidenceScore
  quantity:   ConfidenceScore
  unitPrice:  ConfidenceScore
  lineTotal:  ConfidenceScore
}

// ─── Receipt line item (Section C only) ───────────────────────────────────

export interface ReceiptItem {
  /** Display name exactly as printed on the receipt. */
  name:            string
  quantity:        number
  /** Unit price in minor units (paise). */
  unitPriceMinor:  number
  /** quantity × unitPrice in minor units. */
  lineTotalMinor:  number
  confidence:      ItemFieldConfidence
}

// ─── Tax / charge entry ────────────────────────────────────────────────────

export type TaxType =
  | 'cgst'
  | 'sgst'
  | 'igst'
  | 'gst'
  | 'vat'
  | 'service_charge'
  | 'packing'
  | 'delivery'
  | 'other'

export interface TaxEntry {
  /** As printed, e.g. "CGST @2.5%" */
  name:        string
  type:        TaxType
  /** Percentage rate, e.g. 2.5 for 2.5%. null if not printed. */
  rate:        number | null
  /** Amount in minor units. */
  amountMinor: number
}

// ─── Merchant information (Section A) ─────────────────────────────────────

export interface MerchantInfo {
  name:    string | null
  address: string | null
  phone:   string | null
  gstin:   string | null
  fssai:   string | null
}

// ─── Bill metadata (Section B) ────────────────────────────────────────────

export interface BillMetadata {
  /** Bill / invoice / receipt number as printed. */
  number:      string | null
  /** ISO date string YYYY-MM-DD. */
  date:        string | null
  /** Time as printed, e.g. "14:32". */
  time:        string | null
  orderType:   string | null
  tableNumber: string | null
  tokenNumber: string | null
  cashier:     string | null
}

// ─── Structured receipt extraction ────────────────────────────────────────

/**
 * The structured output of a single extraction pass.
 *
 * Sections A and B are stored separately from items (Section C) and totals
 * (Section D) so the review UI can display them correctly and the reconciler
 * can validate only the financial data.
 *
 * NEVER put merchant/metadata fields into items[].
 */
export interface ReceiptExtraction {
  /** Section A: merchant/store information. */
  merchant:           MerchantInfo

  /** Section B: bill/invoice metadata. */
  bill:               BillMetadata

  /** Section C: ordered items — the ONLY source of BillItems. */
  items:              ReceiptItem[]

  /** Section D: financial summary. */
  /** Printed subtotal (sum of item line totals) in minor units. */
  subtotalMinor:      number | null
  /** All tax/charge entries (CGST, SGST, IGST, service charge, etc.). */
  taxes:              TaxEntry[]
  /** Service charge in minor units (0 if not on receipt). */
  serviceChargeMinor: number
  /** Discount in minor units — positive = reduction (0 if not on receipt). */
  discountMinor:      number
  /** Round-off in minor units (can be negative). 0 if not present. */
  roundOffMinor:      number
  /**
   * Grand total as printed on the receipt, in minor units.
   * null when not visible — NEVER invented.
   */
  grandTotalMinor:    number | null

  /** Overall confidence 0–1 for the entire extraction. */
  overallConfidence:  ConfidenceScore

  /** Which provider produced this extraction. */
  provider:           'ai' | 'ollama' | 'tesseract'
}

// ─── Provider interface ────────────────────────────────────────────────────

/**
 * ReceiptVisionProvider
 *
 * The single abstraction between the scan pipeline and any vision model.
 *
 * Contract:
 *   - extractReceipt accepts image as base64 string + MIME type.
 *   - Returns ReceiptExtraction on success.
 *   - Throws ReceiptVisionError on failure.
 *   - NEVER returns metadata (address, phone, GSTIN, dates) as items.
 */
export interface ReceiptVisionProvider {
  readonly name: string
  extractReceipt(
    imageBase64: string,
    mimeType:    string,
  ): Promise<ReceiptExtraction>
}

// ─── Provider error ────────────────────────────────────────────────────────

export type ReceiptVisionErrorCode =
  | 'provider_unavailable'    // service unreachable / not configured
  | 'extraction_failed'       // could not parse structured output
  | 'schema_invalid'          // output failed schema validation
  | 'image_rejected'          // provider rejected the image
  | 'rate_limited'            // provider rate limit hit
  | 'timeout'                 // request exceeded time budget

export class ReceiptVisionError extends Error {
  constructor(
    public readonly code: ReceiptVisionErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ReceiptVisionError'
  }
}

// ─── Reconciliation result ─────────────────────────────────────────────────

export interface ItemReconciliation {
  /** Index into ReceiptExtraction.items */
  index:           number
  /** quantity × unitPriceMinor */
  computedMinor:   number
  /** As extracted */
  extractedMinor:  number
  /** true when |computed - extracted| ≤ 1 paise */
  match:           boolean
}

export interface ReconciliationResult {
  itemChecks:               ItemReconciliation[]
  /** Σ of all lineTotalMinor values */
  computedSubtotalMinor:    number
  /** from ReceiptExtraction.subtotalMinor */
  extractedSubtotalMinor:   number | null
  /** subtotal + taxes + serviceCharge + roundOff - discount */
  computedGrandTotalMinor:  number
  /** from ReceiptExtraction.grandTotalMinor */
  extractedGrandTotalMinor: number | null

  itemsMatchLinetotals:    boolean   // every item: qty×unit ≈ lineTotal
  linetoalsSumToSubtotal:  boolean | null  // null = subtotal not available
  totalsReconcile:         boolean | null  // null = grandTotal not available

  /** Human-readable summary of what passed and what failed. */
  summary: string
}

// ─── Scan pipeline result ──────────────────────────────────────────────────

/**
 * Confidence status for the entire scan:
 *
 *   VERIFIED:       item structure detected, prices consistent, totals reconcile,
 *                   OCR confidence high.
 *   REVIEW:         some fields uncertain, minor arithmetic mismatch, or
 *                   unclear quantity/price.
 *   LOW_CONFIDENCE: poor image, unreadable receipt, major reconciliation failure.
 *   FAILED:         no usable data extracted.
 */
export type ScanStatus =
  | 'verified'            // full financial validation passed
  | 'review_required'     // extracted but has mismatches or low confidence
  | 'grand_total_missing' // extraction ok but grand total not visible
  | 'failed'              // could not extract usable data

export interface ScanPipelineResult {
  status:          ScanStatus
  extraction:      ReceiptExtraction
  reconciliation:  ReconciliationResult
  /** Which pass produced this result: 'primary' or 'recovery' */
  pass:            'primary' | 'recovery'
  /** Human-readable messages to display in the review UI. */
  reviewMessages:  string[]
  /** Fields that need user attention. */
  reviewFlags:     string[]
}
