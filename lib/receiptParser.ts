/**
 * receiptParser.ts — Zone-Based Receipt Parser (v2)
 *
 * Root-cause fix for v1: lines were classified in isolation, so phone numbers,
 * bill numbers, table numbers and addresses were extracted as food items.
 *
 * v2 Pipeline:
 *   1. Normalise & clean OCR text
 *   2. Segment the receipt into named ZONES:
 *        HEADER   — everything before the item-table column header
 *        COL_HDR  — the column-header row itself
 *        ITEMS    — rows between column header and the first total/tax line
 *        TOTALS   — subtotal, tax, charge, discount, grand-total lines
 *        FOOTER   — payment info, thank-you messages, etc.
 *   3. Extract restaurant metadata from HEADER zone only
 *   4. Extract items from ITEMS zone only  (prevents metadata leaking in)
 *   5. Extract taxes/charges from TOTALS zone
 *   6. Extract grand total from TOTALS zone
 *   7. Mathematical reconciliation
 *   8. Confidence scoring + review flags
 *
 * Key guarantees:
 *   - Phone numbers, GSTIN, bill/table/token numbers → NEVER extracted as items
 *   - Only text between the column header and the first total line is item-parsed
 *   - Integer paise arithmetic throughout; rupees only at output boundary
 *   - Never invents values; always flags uncertain fields for user review
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type FieldConfidence = 'high' | 'medium' | 'low'

export interface ScannedItem {
  name: string
  quantity: number
  unitPrice: number          // rupees
  lineTotal: number          // rupees
  lineTotalFromReceipt: boolean
  confidence: FieldConfidence
  mathMismatch: boolean
}

export interface GstInfo {
  inclusive: boolean | null
  rate: number | null
  cgstAmount: number | null
  sgstAmount: number | null
  igstAmount: number | null
  totalGstAmount: number
  cgstRate: number | null
  sgstRate: number | null
  igstRate: number | null
  confidence: FieldConfidence
}

export interface ParsedReceipt {
  items: ScannedItem[]
  subtotal: number | null
  serviceCharge: number | null
  otherCharges: number | null
  discount: number | null
  discountPercent: number | null
  gst: GstInfo
  grandTotal: number | null
  computedTotal: number | null
  totalsMatch: boolean
  reconciliationNote: string | null
  overallConfidence: FieldConfidence
  requiresReview: boolean
  reviewFlags: string[]
  restaurantName: string | null
  receiptDate: string | null
  rawLineCount: number
}

// ─── Zone types ───────────────────────────────────────────────────────────────

type ZoneType = 'header' | 'col_hdr' | 'items' | 'totals' | 'footer'

interface ZonedLine {
  raw: string      // original cleaned text
  zone: ZoneType
  lineIdx: number  // position in the full receipt
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAISE = 100

// ── Metadata patterns: lines matching these are NEVER food items ──────────────
//
// These patterns cover every field in a typical Indian restaurant receipt header.
// The list is intentionally broad — false-negatives (missing an item) are far
// less harmful than false-positives (treating a phone number as a price).
const METADATA_PATTERNS: RegExp[] = [
  // Contact details
  /\b(ph|phone|mob|mobile|tel|fax|call)\s*[:\-#]?\s*[\d\s\-+()]{6,}/i,
  /\b\d{3,5}[\s\-]\d{3,5}[\s\-]\d{4}\b/,              // phone-number shape
  /\+91[\s\-]?\d{10}/,                                   // +91 mobile
  /\b[6-9]\d{9}\b/,                                      // bare 10-digit Indian mobile

  // Tax & business identifiers
  /\b(gstin|gst\s*(no|number|in|reg)|cin|fssai|pan\s+(no|number))\s*[:\-#]?\s*\w/i,
  /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}\b/,  // GSTIN format

  // Transaction metadata
  /\b(bill|invoice|receipt|order|kot|token|voucher|txn|transaction)\s*(no|number|#|num)?\s*[:\-#]?\s*[\w\-\/]+/i,
  /\b(table|seat|cover)\s*(no|number|#)?\s*[:\-#]?\s*[\w\-]+/i,
  /\b(token|counter|window)\s*(no|number|#)?\s*[:\-#]?\s*[\w\-]+/i,
  /\b(cashier|server|waiter|captain|steward)\s*[:\-#]?\s*\w/i,

  // Date/time
  /\b(date|time|dt)\s*[:\-#]?\s*\d/i,
  /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i,
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/,            // DD/MM/YY date shape

  // Order type / dine in / take away
  /\b(dine\s*in|take\s*(away|out)|delivery|parcel|swiggy|zomato|online)\b/i,
  /\b(order\s*type|order\s*mode)\b/i,

  // Footer / payment / UPI
  /\b(thank\s*you|thanks|visit\s*again|have\s*a\s*(great|nice|good))\b/i,
  /\b(powered\s*by|software|www\.|http|\.com|\.in)\b/i,
  /\b(upi|cash|card|paytm|gpay|phonepe|bhim|neft|rtgs|imps)\b/i,
  /\b(payment\s*(mode|method|type)|paid\s*(by|via|through))\b/i,
  /\b(signature|authorized|sign)\b/i,
  /\b(e[-\s]?bill|e[-\s]?receipt|digital\s*receipt)\b/i,
  /\b(customer\s*(copy|name|id|phone|mob))\b/i,
]

// ── Column-header row detection ───────────────────────────────────────────────
// A column header row has at least TWO of these column label words with NO prices.
const COL_HDR_WORDS = [
  /\b(item|items|description|desc|particular|product|food)\b/i,
  /\b(qty|quantity|no\.?\s*of|nos|pcs|count)\b/i,
  /\b(rate|unit\s*price|price|u\.?p\.?|mrp)\b/i,
  /\b(amount|total|amnt|amt)\b/i,
  /\b(s\.?\s*no|sr\.?\s*no|sl\.?\s*no|#)\b/i,
]

// ── Total / tax keyword detection ─────────────────────────────────────────────
const GRAND_TOTAL_KW = /\b(grand\s*total|net\s*(payable|amount|total)|total\s*(amount|payable|bill|due)?|bill\s*(amount|total)|amount\s*(payable|due)|payable|balance|final\s*amount|to\s*pay|net\s*bill)\b/i
const SUBTOTAL_KW    = /\b(sub\s*total|item\s*total|food\s*total|gross\s*total|total\s*items?|basic\s*total)\b/i
const TAX_KW         = /\b(cgst|sgst|igst|gst|tax|vat|cess|surcharge|service\s*(charge|tax|fee)|sc\b|packing|packaging|delivery\s*(charge)?|convenience\s*fee|platform\s*fee|round\s*(off|up|down)|rounding)\b/i
const DISCOUNT_KW    = /\b(discount|offer|coupon|promo|cashback|rebate|saving|savings|less)\b/i
const SEPARATOR_LINE = /^[-=*_~.]{4,}$/  // pure separator: "------" "======" etc.
const INCLUSIVE_GST  = /\b(inclusive|incl\.?\s*(of|gst|tax)|tax\s*incl|gst\s*incl|all\s*taxes\s*inclusive)\b/i

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPaise(rupees: number): number {
  return Math.round(rupees * PAISE)
}
function toRupees(paise: number): number {
  return Math.round(paise) / PAISE
}

/**
 * Clean a single OCR line:
 *  - collapse whitespace
 *  - replace pipe characters (column separators in thermal receipts) with spaces
 *  - normalise unicode rupee variants
 */
function cleanLine(s: string): string {
  return s
    .replace(/\|/g, ' ')
    .replace(/Rs\./gi, '₹')
    .replace(/\bRs\b/gi, '₹')
    .replace(/\bINR\b/gi, '₹')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse a monetary string to a float in rupees.
 * Handles: ₹149.00, 149.00, 1,49.00, 1,490, etc.
 * Returns NaN on failure.
 */
function parseRupees(s: string): number {
  if (!s) return NaN
  const cleaned = s
    .replace(/₹/g, '')
    .replace(/,/g, '')
    .trim()
  const n = parseFloat(cleaned)
  if (!isFinite(n) || n < 0 || n > 9_999_999) return NaN
  return n
}

/**
 * Extract ALL monetary amounts from a line for use in total/tax/subtotal detection.
 * Deliberately conservative: only matches numbers that:
 *   (a) are prefixed by ₹, or
 *   (b) have a decimal component (49.00, 149.00 — very likely prices), or
 *   (c) are bare integers ≥ 10 (last resort, avoids single-digit qty noise)
 * This prevents phone-number digits from being parsed as prices.
 */
function extractAmounts(line: string): number[] {
  const results: number[] = []

  // Strategy 1: currency-prefixed amounts — highest confidence
  const prefixed = /₹\s*([\d,]+(?:\.\d{1,2})?)/g
  let m: RegExpExecArray | null
  while ((m = prefixed.exec(line)) !== null) {
    const n = parseRupees(m[1])
    if (isFinite(n) && n >= 0) results.push(n)
  }
  if (results.length > 0) return results

  // Strategy 2: decimal amounts (e.g. 149.00 — very likely a price)
  const decimal = /\b(\d{1,6}\.\d{1,2})\b/g
  while ((m = decimal.exec(line)) !== null) {
    const n = parseFloat(m[1])
    if (isFinite(n) && n >= 0 && n <= 999_999) results.push(n)
  }
  if (results.length > 0) return results

  // Strategy 3: bare integers ≥ 10
  const bare = /\b(\d{2,6})\b/g
  while ((m = bare.exec(line)) !== null) {
    const n = parseInt(m[1], 10)
    if (n >= 10 && n <= 99_999) results.push(n)
  }
  return results
}

/**
 * Extract ALL numbers from an item line — both price-like and qty-like.
 * Used ONLY inside item-zone parsing where we need to see every number
 * including small integers that represent quantities.
 *
 * Returns array of { value, isDecimal } in left-to-right order.
 */
interface TokenNumber {
  value: number
  isDecimal: boolean   // true = has .xx component (very likely a price)
  hasCurrency: boolean // true = preceded by ₹
  pos: number          // character position
  /** true = this digit sequence is embedded in a word (e.g. "1kg", "500g") — NOT a standalone qty */
  inWord: boolean
}

function extractAllTokenNumbers(line: string): TokenNumber[] {
  const results: TokenNumber[] = []
  // Match: optional ₹, then integer part, optional decimal
  const re = /(₹\s*)?(\d{1,6}(?:,\d{2,3})*(?:\.(\d{1,2}))?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const raw = m[2].replace(/,/g, '')
    const n   = parseFloat(raw)
    if (!isFinite(n) || n < 0 || n > 9_999_999) continue
    // Check if the number is embedded in a word (e.g. "1kg", "500g", "2L")
    const matchEnd = re.lastIndex  // position right after the match
    const charAfter = line[matchEnd]
    const inWord = charAfter !== undefined && /[a-zA-Z]/.test(charAfter)

    results.push({
      value:       n,
      isDecimal:   m[3] !== undefined,
      hasCurrency: m[1] !== undefined && m[1].includes('₹'),
      pos:         m.index,
      inWord,
    })
  }
  return results
}

/**
 * Extract a single small integer (1–99) that looks like a quantity.
 * Must appear as a standalone number, not part of a larger number.
 */
function extractQty(s: string): number | null {
  // Match: standalone 1–3 digit integer (quantities rarely exceed 99)
  const m = s.match(/\b([1-9]\d{0,2})\b/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 999 ? n : null
}

/** True if two rupee amounts match within ₹0.50 (accounts for rounding). */
function approxEqual(a: number, b: number): boolean {
  return Math.abs(toPaise(a) - toPaise(b)) <= 50
}

/** True if the line is purely a visual separator. */
function isSeparator(line: string): boolean {
  return SEPARATOR_LINE.test(line.replace(/\s/g, ''))
}

/** True if any METADATA_PATTERNS match. */
function isMetadataLine(line: string): boolean {
  return METADATA_PATTERNS.some((re) => re.test(line))
}

/** Count how many COL_HDR_WORDS match in a line. */
function columnHeaderScore(line: string): number {
  return COL_HDR_WORDS.filter((re) => re.test(line)).length
}

/** True if the line contains a total/tax keyword. */
function isTotalOrTaxLine(line: string): boolean {
  return GRAND_TOTAL_KW.test(line) ||
         SUBTOTAL_KW.test(line) ||
         TAX_KW.test(line) ||
         DISCOUNT_KW.test(line)
}

// ─── Zone segmentation ────────────────────────────────────────────────────────

/**
 * Segment the receipt lines into named zones.
 *
 * Algorithm:
 *   1. Walk lines looking for the column-header row (≥2 col-label words, no prices).
 *   2. Everything before col_hdr → 'header'
 *   3. Col_hdr row itself → 'col_hdr'
 *   4. After col_hdr: lines go into 'items' until we hit a total/tax keyword.
 *   5. After first total/tax line → 'totals'
 *   6. After GRAND TOTAL line → 'footer'
 *
 * Fallback (no column header found):
 *   First 5 lines = header, total/tax lines = totals, rest between = items.
 */
function segmentZones(lines: string[]): ZonedLine[] {
  const result: ZonedLine[] = []

  // ── Find column-header row ────────────────────────────────────────────────
  let colHdrIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Column header: ≥2 column-label words AND no price-like numbers
    const tokens = extractAllTokenNumbers(line)
    const hasPrices = tokens.some((t) => t.isDecimal || t.hasCurrency || t.value >= 100)
    if (!hasPrices && columnHeaderScore(line) >= 2) {
      colHdrIdx = i
      break
    }
  }

  // ── Find first total/tax line AFTER the column header ────────────────────
  // Critical: we only look for the totals boundary AFTER col_hdr so that
  // "All prices inclusive of GST" in the header zone doesn't cut off items.
  const searchFrom = colHdrIdx >= 0 ? colHdrIdx + 1 : 6  // skip first 6 lines in fallback
  let firstTotalIdx = -1
  for (let i = searchFrom; i < lines.length; i++) {
    const line = lines[i]
    // A pure separator line counts as boundary only if it has no text
    if (isSeparator(line)) {
      // Only use separator as boundary if it's after at least one non-separator line
      if (i > searchFrom) { firstTotalIdx = i; break }
      continue
    }
    if (isTotalOrTaxLine(line)) {
      firstTotalIdx = i
      break
    }
  }

  // ── Assign zones ──────────────────────────────────────────────────────────
  let pastGrandTotal = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let zone: ZoneType

    if (pastGrandTotal) {
      zone = 'footer'
    } else if (colHdrIdx >= 0) {
      if (i < colHdrIdx) {
        zone = 'header'
      } else if (i === colHdrIdx) {
        zone = 'col_hdr'
      } else if (firstTotalIdx >= 0 && i >= firstTotalIdx) {
        zone = 'totals'
      } else {
        zone = 'items'
      }
    } else {
      // No column header — use line-index heuristic
      if (i < 6) {
        zone = 'header'
      } else if (firstTotalIdx >= 0 && i >= firstTotalIdx) {
        zone = 'totals'
      } else if (isTotalOrTaxLine(line)) {
        zone = 'totals'
        firstTotalIdx = i
      } else {
        zone = 'items'
      }
    }

    if (zone === 'totals' && GRAND_TOTAL_KW.test(line)) {
      pastGrandTotal = true
    }

    result.push({ raw: line, zone, lineIdx: i })
  }

  return result
}

// ─── Item table parsing ───────────────────────────────────────────────────────

/**
 * Detect the column layout from the col_hdr line.
 * Returns column positions as character indices for positional parsing.
 */
interface ColLayout {
  hasSerial: boolean
  hasQty: boolean
  hasRate: boolean    // unit price column
  hasAmount: boolean  // line total column
  // approx char-index where each column starts (−1 = not detected)
  serialPos: number
  namePos: number
  qtyPos: number
  ratePos: number
  amountPos: number
}

function detectColLayout(colHdrLine: string): ColLayout {
  const lc = colHdrLine.toLowerCase()
  return {
    hasSerial:  /\b(s\.?\s*no|sr\.?\s*no|sl\.?\s*no|#)\b/.test(lc),
    hasQty:     /\b(qty|quantity|nos|pcs|count)\b/.test(lc),
    hasRate:    /\b(rate|unit\s*price|price|u\.?p\.?|mrp)\b/.test(lc),
    hasAmount:  /\b(amount|total|amnt|amt)\b/.test(lc),
    serialPos:  Math.max(lc.search(/\b(s\.?\s*no|sr\.?\s*no|#)\b/), -1),
    namePos:    Math.max(lc.search(/\b(item|description|desc|particular|product|food)\b/), 0),
    qtyPos:     Math.max(lc.search(/\b(qty|quantity)\b/), -1),
    ratePos:    Math.max(lc.search(/\b(rate|price)\b/), -1),
    amountPos:  Math.max(lc.search(/\b(amount|total|amnt)\b/), -1),
  }
}

/**
 * Parse item lines from the ITEMS zone.
 *
 * Handles:
 *   FORMAT A: "Masala Dosa   1   149.00   149.00"    (name qty rate total)
 *   FORMAT B: "Masala Dosa   149.00"                 (name total, qty=1 inferred)
 *   FORMAT C: "2 x 49.00     98.00"  / "Tea  2 x ₹49  ₹98"   (multiplier)
 *   FORMAT D: "1. Masala Dosa  1  149.00  149.00"    (with serial number)
 *   FORMAT E: multi-line item (name line + numbers on next line)
 *
 * Critically: metadata lines are excluded before parsing even begins.
 */
interface RawItem {
  name: string
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
  confidence: FieldConfidence
}

const MULTIPLIER_RE = /(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d{1,6}(?:\.\d{1,2})?)/

function parseItemsZone(
  zonedLines: ZonedLine[],
  layout: ColLayout,
): RawItem[] {
  const itemLines = zonedLines.filter((zl) => zl.zone === 'items')
  const results: RawItem[] = []

  let i = 0
  while (i < itemLines.length) {
    const { raw: line } = itemLines[i]

    // ── Hard exclusions ───────────────────────────────────────────────────
    if (!line || isSeparator(line) || isMetadataLine(line)) {
      i++
      continue
    }

    // ── Check if this is a name-only line (no prices) followed by a ──────
    // continuation line with the numbers
    const lineTokens = extractAllTokenNumbers(line)
    const lineHasPrices = lineTokens.some(
      (t) => t.isDecimal || t.hasCurrency || t.value >= 100,
    )
    const hasMultiplier = MULTIPLIER_RE.test(line)

    if (!lineHasPrices && !hasMultiplier) {
      // Possible name-only line — look ahead for continuation
      const next = itemLines[i + 1]
      if (next && !isSeparator(next.raw) && !isMetadataLine(next.raw)) {
        const nextTokens = extractAllTokenNumbers(next.raw)
        const nextHasPrices = nextTokens.some(
          (t) => t.isDecimal || t.hasCurrency || t.value >= 10,
        )
        // Continuation: next line has prices and very little non-numeric text
        const nextTextOnly = next.raw
          .replace(/₹/g, '')
          .replace(/[\d.,×xX*\s]+/g, '')
          .trim()
        if (nextHasPrices && nextTextOnly.length <= 8) {
          // Merge name + continuation
          const merged = line + ' ' + next.raw
          const parsed = parseOneItemLine(merged, layout)
          if (parsed) {
            results.push(parsed)
            i += 2
            continue
          }
        }
      }
      // No usable continuation — skip (likely a modifier or blank description)
      i++
      continue
    }

    const parsed = parseOneItemLine(line, layout)
    if (parsed) results.push(parsed)
    i++
  }

  return results
}

/**
 * Parse a single item line.  Tries formats in priority order.
 */
function parseOneItemLine(line: string, layout: ColLayout): RawItem | null {
  // Strip leading serial number: "1. " "2) " "01 "
  const stripped = line.replace(/^\s*\d{1,3}[.)]\s*/, '').trim()
  if (!stripped) return null

  // ── Format C: multiplier (2×49 or 2 x 49) ────────────────────────────────
  const multM = stripped.match(MULTIPLIER_RE)
  if (multM) {
    const qty = parseFloat(multM[1])
    const rate = parseFloat(multM[2].replace(/,/g, ''))
    const beforeMult = stripped.slice(0, multM.index ?? 0).trim()
    const afterMult = stripped.slice((multM.index ?? 0) + multM[0].length).trim()

    const name = cleanItemName(beforeMult) || cleanItemName(afterMult.replace(/[\d.,₹\s]+$/, '').trim())
    if (!name) return null

    const afterAmounts = extractAmounts(afterMult)
    const lineTotal = afterAmounts.length > 0
      ? afterAmounts[afterAmounts.length - 1]
      : (isFinite(qty * rate) ? Math.round(qty * rate * 100) / 100 : null)

    return {
      name,
      quantity: isFinite(qty) ? qty : 1,
      unitPrice: isFinite(rate) ? rate : null,
      lineTotal,
      confidence: name.length >= 2 ? 'high' : 'medium',
    }
  }

  // ── Extract all token numbers (prices AND qty candidates) ─────────────────
  const tokens = extractAllTokenNumbers(stripped)
  if (tokens.length === 0) return null

  // Extract the item name by removing all number/currency tokens from the text
  const nameRaw = stripped
    .replace(/(₹\s*)?(\d{1,6}(?:,\d{2,3})*(?:\.\d{1,2})?)/g, ' ')
    .replace(/[×xX*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const name = cleanItemName(nameRaw)
  if (!name || name.length < 2) return null

  // ── Separate qty candidates from price candidates ─────────────────────────
  // A qty candidate: integer, value 1–99, appears BEFORE any decimal/currency number
  // A price candidate: has decimal OR has ₹ prefix OR is a large integer (≥100)

  // Skip leading serial-number token if the layout has a serial column
  // e.g. "1  Basmati Rice  2  120.00  240.00" → skip the leading 1 (serial)
  const serialOffset = (
    layout.hasSerial &&
    tokens.length >= 2 &&
    !tokens[0].isDecimal &&
    !tokens[0].hasCurrency &&
    !tokens[0].inWord &&
    tokens[0].value >= 1 &&
    tokens[0].value <= 99
  ) ? 1 : 0

  const workingTokens = tokens.slice(serialOffset)
  // Exclude "inWord" tokens (e.g. "1" in "1kg") from all numeric analysis
  const analysisTokens = workingTokens.filter((t) => !t.inWord)
  const firstPriceIdx = analysisTokens.findIndex((t) => t.isDecimal || t.hasCurrency || t.value >= 100)

  // Look for a qty token that appears before the first price token
  let qty = 1
  let qtyFound = false
  if (firstPriceIdx > 0) {
    // There's at least one token before the first price-like token
    for (let i = 0; i < firstPriceIdx; i++) {
      const t = analysisTokens[i]
      if (!t.isDecimal && !t.hasCurrency && !t.inWord && t.value >= 1 && t.value <= 99) {
        qty = t.value
        qtyFound = true
        break
      }
    }
  } else if (firstPriceIdx === -1) {
    // No decimal/currency/large amounts — all are bare integers
    // If layout has a qty column, treat first small non-word integer as qty
    if (layout.hasQty && analysisTokens.length >= 2) {
      const first = analysisTokens[0]
      if (!first.inWord && first.value >= 1 && first.value <= 99) {
        qty = first.value
        qtyFound = true
      }
    }
  }

  // Price tokens: decimal OR ₹-prefixed OR large integer — and NOT in a word
  const priceTokens = qtyFound
    ? analysisTokens.filter((t) => !t.inWord && (t.isDecimal || t.hasCurrency || t.value >= 100))
    : analysisTokens.filter((t) => !t.inWord && (t.isDecimal || t.hasCurrency || t.value >= 10))

  if (priceTokens.length === 0) {
    // Only qty-like numbers — can't make a price
    return null
  }

  // Last price token = line total; second-to-last = unit price (if present)
  const lineTotal = priceTokens[priceTokens.length - 1].value

  if (priceTokens.length >= 2) {
    const unitPrice = priceTokens[priceTokens.length - 2].value
    const conf = approxEqual(qty * unitPrice, lineTotal) ? 'high' : 'medium'
    return { name, quantity: qty, unitPrice, lineTotal, confidence: conf }
  }

  // Only one price token — it's the total; unit price = total / qty
  return {
    name,
    quantity: qty,
    unitPrice: Math.round((lineTotal / qty) * 100) / 100,
    lineTotal,
    confidence: qtyFound ? 'medium' : (layout.hasRate ? 'medium' : 'high'),
  }
}

/**
 * Clean an item name:
 *  - Strip leading/trailing punctuation and whitespace
 *  - Remove obvious non-name fragments (single letters, stray symbols)
 *  - Validate: must be ≥2 characters, must contain at least one letter
 */
function cleanItemName(raw: string): string {
  const cleaned = raw
    .replace(/^[\s\-_.,:;/\\]+/, '')     // leading junk
    .replace(/[\s\-_.,:;/\\]+$/, '')     // trailing junk
    .replace(/\s+/g, ' ')
    .trim()

  // Must have at least one letter (prevents pure-number names)
  if (!/[a-zA-Z\u0900-\u097F]/.test(cleaned)) return ''
  // Must be at least 2 chars
  if (cleaned.length < 2) return ''

  return cleaned
}

// ─── Tax / charge line parser ─────────────────────────────────────────────────

interface TaxLine {
  label: string
  amount: number
  rate: number | null
  type: 'cgst' | 'sgst' | 'igst' | 'gst' | 'service' | 'discount' | 'packing' | 'other'
}

function parseTaxLines(zonedLines: ZonedLine[]): TaxLine[] {
  const results: TaxLine[] = []
  const totalsLines = zonedLines.filter(
    (zl) => zl.zone === 'totals' || zl.zone === 'footer',
  )

  for (const { raw: line } of totalsLines) {
    if (isSeparator(line)) continue
    if (GRAND_TOTAL_KW.test(line)) continue   // grand total handled separately
    if (SUBTOTAL_KW.test(line)) continue      // subtotal handled separately
    if (!TAX_KW.test(line) && !DISCOUNT_KW.test(line)) continue

    const amounts = extractAmounts(line)
    if (amounts.length === 0) continue
    const amount = amounts[amounts.length - 1]

    // Extract rate percentage if present
    const rateM = line.match(/(\d+(?:\.\d+)?)\s*%/)
    const rate = rateM ? parseFloat(rateM[1]) : null

    const lc = line.toLowerCase()
    let type: TaxLine['type'] = 'other'
    if (/\bcgst\b/.test(lc))                           type = 'cgst'
    else if (/\bsgst\b/.test(lc))                      type = 'sgst'
    else if (/\bigst\b/.test(lc))                      type = 'igst'
    else if (/\bgst\b/.test(lc))                       type = 'gst'
    else if (/service\s*(charge|fee|tax)?/.test(lc))   type = 'service'
    else if (DISCOUNT_KW.test(lc))                     type = 'discount'
    else if (/packing|packaging/.test(lc))             type = 'packing'

    results.push({ label: line, amount, rate, type })
  }

  return results
}

// ─── Total line extraction ────────────────────────────────────────────────────

function extractSubtotal(zonedLines: ZonedLine[]): number | null {
  for (const { raw: line, zone } of zonedLines) {
    if (zone !== 'totals') continue
    if (!SUBTOTAL_KW.test(line)) continue
    const amounts = extractAmounts(line)
    if (amounts.length > 0) return amounts[amounts.length - 1]
  }
  return null
}

function extractGrandTotal(zonedLines: ZonedLine[]): number | null {
  // Search from the bottom of the totals zone for the grand total
  const totalLines = zonedLines.filter((zl) => zl.zone === 'totals' || zl.zone === 'footer')
  // Prefer explicit GRAND_TOTAL_KW match
  for (const { raw: line } of [...totalLines].reverse()) {
    if (!GRAND_TOTAL_KW.test(line)) continue
    const amounts = extractAmounts(line)
    if (amounts.length > 0) return amounts[amounts.length - 1]
  }
  // Fallback: last line in totals with a currency amount that doesn't match
  // a known tax/subtotal keyword
  for (const { raw: line } of [...totalLines].reverse()) {
    if (isSeparator(line)) continue
    if (SUBTOTAL_KW.test(line)) continue
    if (TAX_KW.test(line) || DISCOUNT_KW.test(line)) continue
    const amounts = extractAmounts(line)
    if (amounts.length > 0) return amounts[amounts.length - 1]
  }
  return null
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

function extractRestaurantName(zonedLines: ZonedLine[]): string | null {
  const headerLines = zonedLines.filter((zl) => zl.zone === 'header')
  for (const { raw: line } of headerLines.slice(0, 6)) {
    if (!line) continue
    if (isMetadataLine(line)) continue
    if (extractAmounts(line).length > 0) continue
    if (isTotalOrTaxLine(line)) continue
    if (line.length < 3 || line.length > 80) continue
    return line
  }
  return null
}

function extractReceiptDate(text: string): string | null {
  const MONTHS: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  }
  // "17 Jun 2026" or "17-Jun-2026"
  let m = text.match(/\b(\d{1,2})[\s\-](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-,](\d{4})\b/i)
  if (m) {
    return `${m[3]}-${MONTHS[m[2].toLowerCase().slice(0, 3)]}-${m[1].padStart(2, '0')}`
  }
  // DD/MM/YYYY
  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/)
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  // YYYY-MM-DD
  m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseReceiptText(rawText: string): ParsedReceipt {
  const reviewFlags: string[] = []

  // ── 1. Clean and split into lines ─────────────────────────────────────────
  const lines = rawText
    .split('\n')
    .map(cleanLine)
    .filter((l) => l.length > 0)

  // ── 2. Zone segmentation ──────────────────────────────────────────────────
  const zonedLines = segmentZones(lines)

  // ── 3. Metadata ───────────────────────────────────────────────────────────
  const restaurantName = extractRestaurantName(zonedLines)
  const receiptDate    = extractReceiptDate(rawText)

  // ── 4. Column layout ──────────────────────────────────────────────────────
  const colHdrLine = zonedLines.find((zl) => zl.zone === 'col_hdr')
  const layout = colHdrLine
    ? detectColLayout(colHdrLine.raw)
    : { hasSerial: false, hasQty: false, hasRate: false, hasAmount: false,
        serialPos: -1, namePos: 0, qtyPos: -1, ratePos: -1, amountPos: -1 }

  // ── 5. Parse items (items zone only) ─────────────────────────────────────
  const rawItems = parseItemsZone(zonedLines, layout)

  // ── 6. Build ScannedItems with math validation ────────────────────────────
  const scannedItems: ScannedItem[] = rawItems.map((raw) => {
    const unitPriceFinal = raw.unitPrice ?? (raw.lineTotal !== null ? raw.lineTotal / raw.quantity : 0)
    const lineTotalFinal = raw.lineTotal ?? Math.round(raw.quantity * unitPriceFinal * 100) / 100

    const mathMismatch =
      raw.unitPrice !== null &&
      raw.lineTotal !== null &&
      !approxEqual(raw.quantity * raw.unitPrice, raw.lineTotal)

    if (mathMismatch) {
      reviewFlags.push(`"${raw.name}": qty × unit price ≠ line total`)
    }

    return {
      name:                raw.name,
      quantity:            raw.quantity,
      unitPrice:           Math.round(unitPriceFinal * 100) / 100,
      lineTotal:           Math.round(lineTotalFinal * 100) / 100,
      lineTotalFromReceipt: raw.lineTotal !== null,
      confidence:          mathMismatch ? 'low' : raw.confidence,
      mathMismatch,
    }
  })

  // ── 7. Tax lines ──────────────────────────────────────────────────────────
  const taxLines = parseTaxLines(zonedLines)

  let cgstAmount: number | null = null
  let sgstAmount: number | null = null
  let igstAmount: number | null = null
  let gstFlatAmount: number | null = null
  let cgstRate: number | null = null
  let sgstRate: number | null = null
  let igstRate: number | null = null
  let gstRate: number | null = null
  let serviceChargeTotal = 0
  let otherChargesTotal = 0
  let discountTotal = 0
  let discountPercent: number | null = null

  for (const tl of taxLines) {
    switch (tl.type) {
      case 'cgst':
        cgstAmount = (cgstAmount ?? 0) + tl.amount
        if (tl.rate !== null) cgstRate = tl.rate
        break
      case 'sgst':
        sgstAmount = (sgstAmount ?? 0) + tl.amount
        if (tl.rate !== null) sgstRate = tl.rate
        break
      case 'igst':
        igstAmount = (igstAmount ?? 0) + tl.amount
        if (tl.rate !== null) igstRate = tl.rate
        break
      case 'gst':
        gstFlatAmount = (gstFlatAmount ?? 0) + tl.amount
        if (tl.rate !== null) gstRate = tl.rate
        break
      case 'service':
        serviceChargeTotal += tl.amount
        break
      case 'discount':
        discountTotal += tl.amount
        if (tl.rate !== null) discountPercent = tl.rate
        break
      case 'packing':
      case 'other':
        otherChargesTotal += tl.amount
        break
    }
  }

  // Overall GST rate
  let overallGstRate: number | null = null
  if (cgstRate !== null && sgstRate !== null) overallGstRate = cgstRate + sgstRate
  else if (igstRate !== null) overallGstRate = igstRate
  else if (gstRate !== null) overallGstRate = gstRate

  // Total GST in paise
  let totalGstPaise = 0
  if (cgstAmount !== null || sgstAmount !== null) {
    totalGstPaise = toPaise(cgstAmount ?? 0) + toPaise(sgstAmount ?? 0)
  } else if (igstAmount !== null) {
    totalGstPaise = toPaise(igstAmount)
  } else if (gstFlatAmount !== null) {
    totalGstPaise = toPaise(gstFlatAmount)
  }

  // GST inclusive detection
  const gstPresentOnReceipt = cgstAmount !== null || sgstAmount !== null ||
                               igstAmount !== null || gstFlatAmount !== null
  const gstInclusive = INCLUSIVE_GST.test(rawText) ? true
                     : gstPresentOnReceipt ? false
                     : null

  const gstConfidence: FieldConfidence =
    (cgstAmount !== null || sgstAmount !== null || igstAmount !== null) ? 'high'
    : gstFlatAmount !== null ? 'medium'
    : 'low'

  if (!gstPresentOnReceipt && !INCLUSIVE_GST.test(rawText)) {
    reviewFlags.push('GST / tax information not found on receipt')
  }

  const gstInfo: GstInfo = {
    inclusive: gstInclusive,
    rate: overallGstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalGstAmount: toRupees(totalGstPaise),
    cgstRate,
    sgstRate,
    igstRate,
    confidence: gstConfidence,
  }

  // ── 8. Subtotal & grand total ─────────────────────────────────────────────
  const subtotalFromReceipt = extractSubtotal(zonedLines)
  const grandTotalFromReceipt = extractGrandTotal(zonedLines)

  // Compute subtotal from items
  const itemsSubtotalPaise = scannedItems.reduce(
    (sum, it) => sum + toPaise(it.lineTotal), 0,
  )
  const itemsSubtotal = toRupees(itemsSubtotalPaise)

  // Choose best subtotal
  let subtotalFinal: number | null
  if (subtotalFromReceipt !== null) {
    if (Math.abs(subtotalFromReceipt - itemsSubtotal) / Math.max(itemsSubtotal, 1) <= 0.02) {
      subtotalFinal = subtotalFromReceipt
    } else {
      subtotalFinal = itemsSubtotal  // trust our sum over potentially OCR-garbled receipt
      if (itemsSubtotal > 0) {
        reviewFlags.push(
          `Computed item subtotal ₹${itemsSubtotal.toFixed(2)} differs from ` +
          `printed subtotal ₹${subtotalFromReceipt.toFixed(2)}`,
        )
      }
    }
  } else {
    subtotalFinal = itemsSubtotal > 0 ? itemsSubtotal : null
  }

  const serviceCharge = serviceChargeTotal > 0 ? serviceChargeTotal : null
  const otherCharges  = otherChargesTotal  > 0 ? otherChargesTotal  : null
  const discount      = discountTotal      > 0 ? discountTotal      : null

  // ── 9. Reconciliation ─────────────────────────────────────────────────────
  let computedTotalPaise = itemsSubtotalPaise + totalGstPaise
  if (serviceChargeTotal > 0) computedTotalPaise += toPaise(serviceChargeTotal)
  if (otherChargesTotal  > 0) computedTotalPaise += toPaise(otherChargesTotal)
  if (discountTotal      > 0) computedTotalPaise -= toPaise(discountTotal)
  const computedTotal = computedTotalPaise > 0 ? toRupees(computedTotalPaise) : null

  let totalsMatch = false
  let reconciliationNote: string | null = null

  if (grandTotalFromReceipt !== null && computedTotal !== null) {
    const discPaise = Math.abs(toPaise(grandTotalFromReceipt) - toPaise(computedTotal))
    if (discPaise <= 100) {   // within ₹1 (handles rounding)
      totalsMatch = true
    } else {
      const diff = toRupees(toPaise(grandTotalFromReceipt) - toPaise(computedTotal))
      reconciliationNote =
        `Receipt total ₹${grandTotalFromReceipt.toFixed(2)} vs. ` +
        `computed ₹${computedTotal.toFixed(2)} ` +
        `(${diff >= 0 ? '+' : ''}₹${diff.toFixed(2)})`
      reviewFlags.push('Total does not reconcile — please review highlighted values')
    }
  } else if (grandTotalFromReceipt === null) {
    reviewFlags.push('Grand total not found on receipt')
  }

  // ── 10. Overall confidence ─────────────────────────────────────────────────
  const lowCount  = scannedItems.filter((it) => it.confidence === 'low').length
  const medCount  = scannedItems.filter((it) => it.confidence === 'medium').length
  const highCount = scannedItems.filter((it) => it.confidence === 'high').length

  let overallConfidence: FieldConfidence = 'high'
  if (scannedItems.length === 0) {
    overallConfidence = 'low'
    reviewFlags.push('No items could be extracted from this receipt')
  } else if (lowCount > 0 || !totalsMatch) {
    overallConfidence = 'low'
  } else if (medCount >= highCount || reviewFlags.length > 1) {
    overallConfidence = 'medium'
  }

  const requiresReview =
    overallConfidence !== 'high' ||
    reviewFlags.length > 0 ||
    scannedItems.some((it) => it.confidence !== 'high')

  return {
    items:              scannedItems,
    subtotal:           subtotalFinal,
    serviceCharge,
    otherCharges,
    discount,
    discountPercent,
    gst:                gstInfo,
    grandTotal:         grandTotalFromReceipt,
    computedTotal,
    totalsMatch,
    reconciliationNote,
    overallConfidence,
    requiresReview,
    reviewFlags,
    restaurantName,
    receiptDate,
    rawLineCount:       lines.length,
  }
}

// ─── OCR quality check ────────────────────────────────────────────────────────

export interface OcrQualityResult {
  looksLikeReceipt: boolean
  tooSparse: boolean
  amountCount: number
  hasItemLines: boolean
  hasTotalLine: boolean
}

export function checkOcrQuality(text: string): OcrQualityResult {
  if (!text || text.trim().length < 20) {
    return { looksLikeReceipt: false, tooSparse: true, amountCount: 0, hasItemLines: false, hasTotalLine: false }
  }
  const lines = text.split('\n').map(cleanLine).filter(Boolean)
  const amountCount = lines.reduce((n, l) => n + extractAmounts(l).length, 0)
  const zonedLines  = segmentZones(lines)
  const hasItemLines = zonedLines.some((zl) => zl.zone === 'items')
  const hasTotalLine = lines.some((l) => GRAND_TOTAL_KW.test(l) || SUBTOTAL_KW.test(l))
  const tooSparse   = lines.length < 4 || amountCount < 2

  return {
    looksLikeReceipt: !tooSparse && (hasItemLines || hasTotalLine) && amountCount >= 2,
    tooSparse,
    amountCount,
    hasItemLines,
    hasTotalLine,
  }
}
