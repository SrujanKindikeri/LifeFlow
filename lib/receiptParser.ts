/**
 * receiptParser.ts — Context-Aware Spatial Receipt Parser (v4)
 *
 * This parser is the Tesseract fallback path. It runs when Ollama is
 * unavailable and uses Tesseract HOCR bounding-box output (word-level
 * coordinates + confidence) to understand receipt STRUCTURE rather than
 * treating OCR output as a flat string to regex over.
 *
 * Root cause of v3 failures:
 *   The previous approach concatenated OCR lines and used regex patterns
 *   to exclude metadata. This fragile negative-filter approach failed
 *   whenever metadata text did not match a known pattern.
 *
 * v4 approach — POSITIVE identification via spatial zones:
 *   1. Parse HOCR XML → typed WordToken[] with (text, x, y, w, h, conf)
 *   2. Group tokens into visual ROWS by Y-coordinate proximity
 *   3. Classify each row by its ROLE:
 *        HEADER   — rows above the column header row
 *        COL_HDR  — row containing "Item / Qty / Rate / Amount" words
 *        ITEM     — rows in the item table (between col_hdr and totals block)
 *        TOTALS   — rows containing subtotal/tax/total keywords
 *        FOOTER   — rows below the grand total row
 *   4. Extract from ITEM rows ONLY using column geometry
 *   5. Extract structured metadata from HEADER rows
 *   6. Extract financial totals from TOTALS rows
 *
 * Guarantees:
 *   - Address, phone, GSTIN, bill number, date, time, table/token numbers
 *     NEVER appear in items[] because they live in HEADER rows.
 *   - Subtotal / tax / grand total NEVER appear in items[] because they
 *     live in TOTALS rows.
 *   - Multi-line item names are joined using row proximity and column geometry.
 *   - Confidence scores are real Tesseract word confidence values (0-100).
 *
 * Output:
 *   ParsedReceipt  (same public interface as v3 for backward compatibility)
 *   ReceiptExtraction  (the new canonical type used by the scan pipeline)
 */

// ═══════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════

export type FieldConfidence = 'high' | 'medium' | 'low'

export interface ItemFieldConfidence {
  name:      FieldConfidence
  quantity:  FieldConfidence
  unitPrice: FieldConfidence
  lineTotal: FieldConfidence
}

export interface ScannedItem {
  name:                 string
  quantity:             number
  unitPrice:            number   // rupees
  lineTotal:            number   // rupees
  lineTotalFromReceipt: boolean
  confidence:           FieldConfidence
  fieldConfidence:      ItemFieldConfidence
  mathMismatch:         boolean
  needsReview:          boolean
  reviewNote:           string | null
}

export interface TaxEntry {
  label:  string
  type:   'cgst' | 'sgst' | 'igst' | 'gst' | 'service' | 'discount' | 'packing' | 'other'
  rate:   number | null
  amount: number   // rupees
}

/** GST summary — convenience view over TaxEntry[]. Backward-compatible with v3 tests. */
export interface GstInfo {
  inclusive:      boolean | null
  rate:           number | null
  cgstAmount:     number | null
  sgstAmount:     number | null
  igstAmount:     number | null
  totalGstAmount: number
  cgstRate:       number | null
  sgstRate:       number | null
  igstRate:       number | null
  confidence:     FieldConfidence
}

export interface ParsedReceipt {
  restaurantName:  string | null
  receiptDate:     string | null
  invoiceNumber:   string | null
  items:           ScannedItem[]
  subtotal:        number | null
  taxes:           TaxEntry[]
  /** Convenience GST summary (backward-compatible with v3 tests). */
  gst:             GstInfo
  serviceCharge:   number | null
  discount:        number | null
  grandTotal:      number | null
  /** Computed total from items + taxes + charges (for tests / review UI). */
  computedTotal:   number | null
  /** Whether the computed total matches the printed grand total (within ₹1). */
  totalsMatch:     boolean
  overallConfidence: FieldConfidence
  requiresReview:  boolean
  reviewFlags:     string[]
  rawLineCount:    number
  ocrEngine:       'tesseract' | null
}

export interface OcrQuality {
  looksLikeReceipt: boolean
  tooSparse:        boolean
  hasItemLines:     boolean
  hasTotalLine:     boolean
  lineCount:        number
}

// ═══════════════════════════════════════════════════════════════════
// HOCR WORD TOKEN
// ═══════════════════════════════════════════════════════════════════

export interface WordToken {
  text: string
  x:    number   // left edge (pixels)
  y:    number   // top edge
  w:    number   // width
  h:    number   // height
  conf: number   // 0–100 Tesseract confidence
}

// ═══════════════════════════════════════════════════════════════════
// HOCR PARSER
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse Tesseract HOCR XML into typed WordToken[].
 *
 * HOCR format: <span class="ocrx_word" title="bbox 10 20 80 40; x_wconf 92">text</span>
 */
export function parseHocr(hocrXml: string): WordToken[] {
  const tokens: WordToken[] = []

  // Match all word spans — use a regex rather than a full XML parser to
  // avoid dependencies. The HOCR format is regular enough.
  const wordRe = /<span[^>]*class="ocrx_word"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g
  let m: RegExpExecArray | null

  while ((m = wordRe.exec(hocrXml)) !== null) {
    const title   = m[1]
    const rawText = m[2].replace(/<[^>]+>/g, '').trim()  // strip any nested tags

    if (!rawText) continue

    // Parse bbox: "bbox x0 y0 x1 y1"
    const bboxM = title.match(/bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/)
    if (!bboxM) continue
    const x0 = parseInt(bboxM[1])
    const y0 = parseInt(bboxM[2])
    const x1 = parseInt(bboxM[3])
    const y1 = parseInt(bboxM[4])

    // Parse confidence: "x_wconf 85"
    const confM = title.match(/x_wconf\s+(\d+)/)
    const conf  = confM ? parseInt(confM[1]) : 50

    tokens.push({
      text: rawText,
      x:    x0,
      y:    y0,
      w:    x1 - x0,
      h:    y1 - y0,
      conf,
    })
  }

  return tokens
}

// ═══════════════════════════════════════════════════════════════════
// ROW GROUPING
// ═══════════════════════════════════════════════════════════════════

export interface VisualRow {
  tokens: WordToken[]
  /** Median Y of all tokens in this row */
  y:      number
  /** Typical line height (used for multi-line continuation detection) */
  lineH:  number
}

/**
 * Group word tokens into visual rows by Y-coordinate proximity.
 *
 * Two tokens are in the same row if their Y positions differ by less than
 * ROW_GAP_FACTOR × average character height.
 */
export function groupIntoRows(tokens: WordToken[]): VisualRow[] {
  if (tokens.length === 0) return []

  // Sort by Y then X
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)

  // Estimate typical character height from median token heights
  const heights = sorted.map((t) => t.h).sort((a, b) => a - b)
  const medH    = heights[Math.floor(heights.length / 2)] || 20
  const rowGap  = medH * 0.55   // tokens within 55% of char height = same row

  const rows: VisualRow[] = []
  let currentTokens: WordToken[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentTokens[currentTokens.length - 1]
    const cur  = sorted[i]

    if (Math.abs(cur.y - prev.y) <= rowGap) {
      currentTokens.push(cur)
    } else {
      rows.push(finalizeRow(currentTokens, medH))
      currentTokens = [cur]
    }
  }
  rows.push(finalizeRow(currentTokens, medH))

  return rows
}

function finalizeRow(tokens: WordToken[], defaultH: number): VisualRow {
  // Sort tokens left to right
  const sorted = [...tokens].sort((a, b) => a.x - b.x)
  const ys     = sorted.map((t) => t.y)
  const medY   = ys[Math.floor(ys.length / 2)]
  const avgH   = sorted.reduce((s, t) => s + t.h, 0) / sorted.length || defaultH
  return { tokens: sorted, y: medY, lineH: avgH }
}

// ═══════════════════════════════════════════════════════════════════
// ZONE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

export type RowZone = 'header' | 'col_hdr' | 'item' | 'totals' | 'footer'

export interface ZonedRow extends VisualRow {
  zone:    RowZone
  rawText: string
}

// ── Keyword patterns ──────────────────────────────────────────────────────────

const COL_HDR_WORDS = [
  /\b(item|items|description|desc|particular|product|food)\b/i,
  /\b(qty|quantity|nos|pcs|count)\b/i,
  /\b(rate|unit\s*price?|price|u\.?p\.?|mrp)\b/i,
  /\b(amount|total|amnt|amt)\b/i,
]

const TOTAL_KEYWORDS = /\b(grand\s*total|net\s*(payable|amount|total)|total\s*(amount|payable|bill|due)?|bill\s*(amount|total)|amount\s*(payable|due)|payable|balance|final\s*amount|to\s*pay|net\s*bill)\b/i
const SUBTOTAL_KW    = /\b(sub\s*total|item\s*total|food\s*total|gross\s*total|basic\s*total)\b/i
const TAX_KW         = /\b(cgst|sgst|igst|gst|tax|vat|cess|service\s*(charge|tax|fee)|sc\b|packing|packaging|round\s*(off|up|down)|rounding)\b/i

/**
 * Strict grand-total keyword — does NOT match "Sub Total" or "Item Total".
 * Used to set pastGrandTotal and identify the definitive grand total line.
 */
const GRAND_TOTAL_STRICT = /\b(grand\s*total|net\s*(payable|amount|total)|bill\s*(amount|total)|amount\s*(payable|due)|payable(?!\s*by)|balance\s*due|final\s*amount|to\s*pay|net\s*bill)\b/i
const DISCOUNT_KW    = /\b(discount|offer|coupon|promo|cashback|saving|less)\b/i

function isTaxOrTotalRow(text: string): boolean {
  return TOTAL_KEYWORDS.test(text) || SUBTOTAL_KW.test(text) ||
         TAX_KW.test(text) || DISCOUNT_KW.test(text)
}

function colHdrScore(text: string): number {
  return COL_HDR_WORDS.filter((r) => r.test(text)).length
}

/**
 * Classify each visual row into a zone.
 *
 * Algorithm:
 *   1. Find the column-header row (row with ≥2 col-label words, no prices).
 *   2. Find the last totals block from the bottom (last contiguous group of
 *      tax/total keyword lines).
 *   3. Rows above col_hdr → header
 *   4. Rows between col_hdr and lastTotalsStart → item
 *   5. Rows from lastTotalsStart to grand total → totals
 *   6. Rows after grand total → footer
 */
export function classifyZones(rows: VisualRow[]): ZonedRow[] {
  const texts = rows.map((r) => r.tokens.map((t) => t.text).join(' '))

  // ── Step 1: find col_hdr row ──────────────────────────────────────────────
  let colHdrIdx = -1

  // Strict: ≥2 col words, no price tokens
  for (let i = 0; i < rows.length; i++) {
    const text   = texts[i]
    const score  = colHdrScore(text)
    const tokens = rows[i].tokens
    const hasPrices = tokens.some((t) => /^\d{2,6}(\.\d{1,2})?$/.test(t.text) && parseFloat(t.text) >= 10)
    if (score >= 2 && !hasPrices) { colHdrIdx = i; break }
  }

  // Soft fallback: ≥1 col word with item/qty/total keyword, no prices
  if (colHdrIdx < 0) {
    for (let i = 0; i < rows.length; i++) {
      const text  = texts[i]
      const score = colHdrScore(text)
      const hasCritical = /\b(item|description|qty|quantity|amount|total)\b/i.test(text)
      const tokens = rows[i].tokens
      const hasPrices = tokens.some((t) => /^\d{2,6}(\.\d{1,2})?$/.test(t.text) && parseFloat(t.text) >= 100)
      if (score >= 1 && hasCritical && !hasPrices) { colHdrIdx = i; break }
    }
  }

  // ── Step 2: find start of last totals block from bottom ───────────────────
  let lastTotalsStart = rows.length
  let inTotalsBlock   = false

  for (let i = rows.length - 1; i >= (colHdrIdx >= 0 ? colHdrIdx + 1 : 0); i--) {
    const text  = texts[i]
    const isTot = isTaxOrTotalRow(text)
    const isSep = /^[-=*_~.]{3,}$/.test(text.replace(/\s/g, ''))
    const isEmpty = text.trim().length === 0

    if (isTot || isSep || isEmpty) {
      if (isTot) {
        inTotalsBlock = true
        lastTotalsStart = i
      }
    } else {
      if (inTotalsBlock) break   // hit the first non-total line above the block
    }
  }

  // ── Step 3: if no col_hdr found, use content-based header boundary ────────
  let contentHeaderEnd = 0
  if (colHdrIdx < 0) {
    for (let i = 0; i < rows.length; i++) {
      const text = texts[i]
      const hasPriceToken = rows[i].tokens.some(
        (t) => /\d{2,6}\.\d{1,2}/.test(t.text) || (/^\d{3,6}$/.test(t.text) && parseInt(t.text) >= 50),
      )
      const hasLetter = /[a-zA-Z]/.test(text)
      const isMeta    = isObviousMetadata(text)
      if (hasLetter && hasPriceToken && !isMeta) {
        contentHeaderEnd = i
        break
      }
      contentHeaderEnd = i + 1
    }
  }

  // ── Step 4: assign zones ───────────────────────────────────────────────────
  const result: ZonedRow[] = []
  let pastGrandTotal = false

  for (let i = 0; i < rows.length; i++) {
    const text = texts[i]
    let zone: RowZone

    if (pastGrandTotal) {
      zone = 'footer'
    } else if (i >= lastTotalsStart) {
      zone = 'totals'
    } else if (colHdrIdx >= 0) {
      if (i < colHdrIdx)         zone = 'header'
      else if (i === colHdrIdx)  zone = 'col_hdr'
      else                       zone = 'item'
    } else {
      zone = i < contentHeaderEnd ? 'header' : 'item'
    }

    if (zone === 'totals' && GRAND_TOTAL_STRICT.test(text)) {
      pastGrandTotal = true
    }

    result.push({ ...rows[i], zone, rawText: text })
  }

  return result
}

// ── Obvious metadata patterns ─────────────────────────────────────────────────
// These match lines that are CLEARLY metadata, not items.
// Used only for the content-based header boundary when no col_hdr is found.
const OBVIOUS_METADATA = [
  /\b(gstin|gst\s*(no|number|reg)|cin|fssai|pan\s*(no|number))\b/i,
  /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}\b/,  // GSTIN format
  /\b(bill|invoice|receipt|order|token)\s*(no\.?|number|#)\s*[:\-#]?\s*\w/i,
  /\b(table|seat)\s*(no\.?|number|#)\s*[:\-#]?\s*\w/i,
  /\b(dine\s*in|take\s*away|delivery|parcel)\b/i,
  /\b(thank\s*you|visit\s*again|powered\s*by)\b/i,
  /\b(upi|cash|card|paytm|gpay|phonepe)\b/i,
]

function isObviousMetadata(text: string): boolean {
  return OBVIOUS_METADATA.some((r) => r.test(text))
}

// ═══════════════════════════════════════════════════════════════════
// COLUMN GEOMETRY
// ═══════════════════════════════════════════════════════════════════

interface ColBoundaries {
  /** X position that separates the name column from quantity column. */
  nameRightBound:  number
  /** X position of the quantity column center. */
  qtyCenter:       number | null
  /** X position of the rate/unit-price column center. */
  rateCenter:      number | null
  /** X position of the amount/total column center. */
  amountCenter:    number | null
  /** Whether a serial-number column exists at the far left. */
  hasSerial:       boolean
}

/**
 * Determine column boundaries from the column header row.
 * Returns null if no column header row exists (text-only fallback).
 */
function detectColumns(colHdrRow: ZonedRow | undefined): ColBoundaries | null {
  if (!colHdrRow) return null

  const tokens = colHdrRow.tokens

  function findTokenCenter(pattern: RegExp): number | null {
    for (const t of tokens) {
      if (pattern.test(t.text.toLowerCase())) return t.x + t.w / 2
    }
    return null
  }

  const hasSerial = tokens.some((t) => /^(s\.?no?|sr\.?no?|sl\.?no?|#)$/i.test(t.text))
  const qtyCenter    = findTokenCenter(/^(qty|quantity|nos|pcs|count)$/i)
  const rateCenter   = findTokenCenter(/^(rate|price|unit|u\.?p\.?|mrp)$/i)
  const amountCenter = findTokenCenter(/^(amount|total|amnt|amt)$/i)

  // Name column ends just before the qty column (or rate if no qty)
  const rightmostLeft = Math.min(
    ...[qtyCenter, rateCenter, amountCenter]
      .filter((v): v is number => v !== null)
      .map((v) => v - 40),
    Infinity,
  )
  const nameRightBound = isFinite(rightmostLeft) ? rightmostLeft : Infinity

  return { nameRightBound, qtyCenter, rateCenter, amountCenter, hasSerial }
}

// ═══════════════════════════════════════════════════════════════════
// ITEM EXTRACTION
// ═══════════════════════════════════════════════════════════════════

interface RawItem {
  name:       string
  quantity:   number
  unitPrice:  number | null
  lineTotal:  number | null
  nameConf:   FieldConfidence
  qtyConf:    FieldConfidence
  priceConf:  FieldConfidence
  totalConf:  FieldConfidence
}

/**
 * Extract items from ITEM-zone rows using column geometry.
 *
 * When column boundaries are known from REAL HOCR bounding boxes:
 *   - Assign each token to name/qty/rate/amount column by X position.
 *   - Multi-line items: if a row has text only in the name column and the
 *     next row has numbers, merge them into one item.
 *
 * When no col_hdr or running in text-only mode (synthetic coordinates):
 *   - Use the right-to-left text heuristic for all items.
 *   - Multi-word names handled by stripping all number tokens.
 */
function extractItems(itemRows: ZonedRow[], cols: ColBoundaries | null, haveRealCoordinates = false): RawItem[] {
  // In text-only mode the synthetic X coords are useless for column separation.
  // Fall through directly to text-only extraction for every row.
  if (!cols || !haveRealCoordinates) {
    const results: RawItem[] = []
    let i = 0
    while (i < itemRows.length) {
      const row = itemRows[i]
      // Look-ahead merge for multi-line names
      const item = extractItemTextOnly(row)
      if (item && (item.lineTotal === null || item.lineTotal === 0)) {
        // Name-only or incomplete — try merging with next row
        const next = itemRows[i + 1]
        if (next && next.zone === 'item') {
          const merged: ZonedRow = {
            ...row,
            tokens: [...row.tokens, ...next.tokens].sort((a, b) => a.x - b.x),
            rawText: row.rawText + ' ' + next.rawText,
          }
          const mergedItem = extractItemTextOnly(merged)
          if (mergedItem && (mergedItem.lineTotal ?? 0) > 0) {
            results.push(mergedItem)
            i += 2
            continue
          }
        }
      }
      if (item) results.push(item)
      i++
    }
    return results
  }

  // Real HOCR coordinates — use column geometry
  const results: RawItem[] = []
  let i = 0
  while (i < itemRows.length) {
    results.push(...extractItemWithColumns(itemRows[i], itemRows, i, cols))
    i++
  }
  return results
}

/**
 * Extract item from a single row using column boundaries.
 * Returns array because a row might contribute to a pending multi-line item.
 */
function extractItemWithColumns(
  row:     ZonedRow,
  allRows: ZonedRow[],
  idx:     number,
  cols:    ColBoundaries,
): RawItem[] {
  const nameTokens:   WordToken[] = []
  const qtyTokens:    WordToken[] = []
  const rateTokens:   WordToken[] = []
  const amountTokens: WordToken[] = []

  // Determine column assignment boundaries
  const qtyBound    = cols.qtyCenter    !== null ? cols.qtyCenter    - 30 : null
  const rateBound   = cols.rateCenter   !== null ? cols.rateCenter   - 30 : null
  const amountBound = cols.amountCenter !== null ? cols.amountCenter - 30 : null

  for (const tok of row.tokens) {
    const cx = tok.x + tok.w / 2

    if (amountBound !== null && cx >= amountBound) {
      amountTokens.push(tok)
    } else if (rateBound !== null && cx >= rateBound) {
      rateTokens.push(tok)
    } else if (qtyBound !== null && cx >= qtyBound) {
      qtyTokens.push(tok)
    } else {
      nameTokens.push(tok)
    }
  }

  // Build text strings for each column
  const nameText   = nameTokens.map((t) => t.text).join(' ').trim()
  const qtyText    = qtyTokens.map((t)  => t.text).join(' ').trim()
  const rateText   = rateTokens.map((t) => t.text).join(' ').trim()
  const amountText = amountTokens.map((t) => t.text).join(' ').trim()

  // Parse values
  const qty        = parseQty(qtyText)
  const unitPrice  = parseMoney(rateText)
  let   lineTotal  = parseMoney(amountText)

  // If we have a name but no numbers at all, this might be a multi-line
  // name continuation — look ahead one row
  const hasAnyNumber = qty !== null || unitPrice !== null || lineTotal !== null
  if (!hasAnyNumber && nameText && idx + 1 < allRows.length) {
    const nextRow = allRows[idx + 1]
    if (nextRow.zone === 'item') {
      const nextAmounts = extractAmounts(nextRow.rawText)
      if (nextAmounts.length > 0) {
        // Merge: current name + next row's numbers
        const merged = extractItemWithColumns(
          { ...nextRow, rawText: nameText + ' ' + nextRow.rawText },
          allRows,
          idx + 1,
          cols,
        )
        if (merged.length > 0) {
          merged[0].name = nameText + ' ' + merged[0].name
          return merged
        }
      }
    }
    return []  // defer — will be picked up as name fragment of the next row
  }

  // Strip leading serial number from name
  const cleanedName = cleanItemName(
    nameText.replace(/^\s*\d{1,3}[.)]\s*/, ''),
  )
  if (!cleanedName) return []

  // Repair lineTotal if missing but we have qty × unitPrice
  if (lineTotal === null && qty !== null && unitPrice !== null) {
    lineTotal = Math.round(qty * unitPrice * 100) / 100
  }

  // Average confidence of name tokens
  const avgNameConf = nameTokens.length > 0
    ? nameTokens.reduce((s, t) => s + t.conf, 0) / nameTokens.length
    : 50

  return [{
    name:      cleanedName,
    quantity:  qty ?? 1,
    unitPrice,
    lineTotal,
    nameConf:  confBucket(avgNameConf),
    qtyConf:   qty    !== null ? 'high' : 'low',
    priceConf: unitPrice !== null ? 'high' : 'medium',
    totalConf: lineTotal !== null ? 'high' : 'low',
  }]
}

/**
 * Text-only item extraction — no reliable column boundaries.
 *
 * Strategy: right-to-left assignment on ALL number tokens in the row.
 *   - Rightmost number   → line total
 *   - Second-rightmost   → unit price (if present and different from total)
 *   - First small integer (1–99) preceding price tokens → quantity
 *   - Everything else (letters) → item name
 *
 * Handles:
 *   "Masala Dosa   1   149.00   149.00"
 *   "Cold Coffee   110.00"
 *   "Tea            2    49.00    98.00"
 *   "Masala Chai 3 x 30.00  90.00"
 *   "Basmati Rice 1kg  2  120.00  240.00"   ← qty embedded after non-alpha
 */
function extractItemTextOnly(row: ZonedRow): RawItem | null {
  const text = row.rawText
  if (!text.trim()) return null

  // Multiplier notation: "3 x 30.00" → qty=3, unit=30
  const multM = text.match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d{1,6}(?:\.\d{1,2})?)/)
  if (multM) {
    const qty   = parseFloat(multM[1])
    const rate  = parseFloat(multM[2].replace(/,/g, ''))
    const rest  = text.slice((multM.index ?? 0) + multM[0].length)
    const afAmts = extractAmounts(rest)
    const total  = afAmts.length > 0 ? afAmts[afAmts.length - 1] : Math.round(qty * rate * 100) / 100

    const beforeMult = text.slice(0, multM.index ?? 0).replace(/\d/g, '').trim()
    const name = cleanItemName(beforeMult)
    if (!name) return null

    return {
      name,
      quantity:  isFinite(qty) ? Math.round(qty) : 1,
      unitPrice: isFinite(rate) ? rate : null,
      lineTotal: isFinite(total) ? total : null,
      nameConf:  name.length >= 3 ? 'high' : 'medium',
      qtyConf:   'high',
      priceConf: 'high',
      totalConf: isFinite(total) ? 'high' : 'low',
    }
  }

  // Collect all standalone number tokens with their positions
  const numberRe = /(₹\s*)?(\d{1,6}(?:,\d{2,3})*(?:\.\d{1,2})?)\b/g
  const numTokens: { value: number; start: number; end: number; isDecimal: boolean; hasCurrency: boolean }[] = []
  let m: RegExpExecArray | null
  while ((m = numberRe.exec(text)) !== null) {
    const raw = m[2].replace(/,/g, '')
    const n   = parseFloat(raw)
    if (!isFinite(n) || n < 0 || n > 9_999_999) continue
    // Skip if embedded in a word (e.g. "1kg", "A42")
    const after  = text[m.index + m[0].length]
    const before = text[m.index - 1]
    if (after  && /[a-zA-Z]/.test(after))  continue
    if (before && /[a-zA-Z]/.test(before)) continue
    numTokens.push({
      value:       n,
      start:       m.index,
      end:         m.index + m[0].length,
      isDecimal:   m[2].includes('.'),
      hasCurrency: !!(m[1] && m[1].includes('₹')),
    })
  }

  if (numTokens.length === 0) return null

  // Identify price tokens (decimal, ₹-prefixed, or ≥100) vs qty candidates (small int)
  const priceTokens = numTokens.filter((t) => t.isDecimal || t.hasCurrency || t.value >= 100)
  const smallInts   = numTokens.filter((t) => !t.isDecimal && !t.hasCurrency && t.value >= 1 && t.value <= 99)

  if (priceTokens.length === 0) {
    // All small integers — can't determine a price; treat last as total
    if (numTokens.length < 2) return null
    const total = numTokens[numTokens.length - 1].value
    const name  = cleanItemName(text.replace(numberRe, ' ').replace(/\s+/g, ' '))
    if (!name) return null
    return { name, quantity: 1, unitPrice: total, lineTotal: total, nameConf: 'medium', qtyConf: 'low', priceConf: 'low', totalConf: 'low' }
  }

  const lineTotal  = priceTokens[priceTokens.length - 1].value
  const totalConf: FieldConfidence = priceTokens[priceTokens.length - 1].isDecimal ? 'high' : 'medium'
  const totalEnd   = priceTokens[priceTokens.length - 1].end

  let unitPrice: number | null = null
  let priceConf: FieldConfidence = 'low'
  if (priceTokens.length >= 2) {
    unitPrice = priceTokens[priceTokens.length - 2].value
    priceConf = priceTokens[priceTokens.length - 2].isDecimal ? 'high' : 'medium'
  }

  // Find quantity: the LAST small integer that appears BEFORE the first price token
  const firstPriceStart = priceTokens[0].start
  const qtyCandidate    = smallInts.filter((t) => t.end <= firstPriceStart).pop()
  const qty    = qtyCandidate?.value ?? 1
  const qtyConf: FieldConfidence = qtyCandidate ? 'high' : 'low'
  const qtyEnd = qtyCandidate?.end ?? 0

  // Name = everything between the end of qty token and the start of first price token,
  // with all remaining number tokens stripped.
  const nameSection = text
    .slice(0, firstPriceStart)
    .slice(0, qtyCandidate ? qtyCandidate.start : undefined)  // remove qty from end of name section
    .replace(/(₹\s*)?\d{1,6}(?:,\d{2,3})*(?:\.\d{1,2})?\b/g, ' ')
    .replace(/[×xX*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const name = cleanItemName(nameSection.replace(/^\s*\d{1,3}[.)]\s*/, ''))
  if (!name) return null

  const avgConf  = row.tokens.reduce((s, t) => s + t.conf, 0) / Math.max(row.tokens.length, 1)
  const nameConf: FieldConfidence = avgConf >= 80 && name.length >= 3 ? 'high' : name.length >= 3 ? 'medium' : 'low'

  return {
    name,
    quantity:  qty,
    unitPrice,
    lineTotal,
    nameConf,
    qtyConf,
    priceConf,
    totalConf,
  }
}

// ═══════════════════════════════════════════════════════════════════
// METADATA EXTRACTION
// ═══════════════════════════════════════════════════════════════════

interface ExtractedMetadata {
  restaurantName: string | null
  invoiceNumber:  string | null
  receiptDate:    string | null
  tableNumber:    string | null
  tokenNumber:    string | null
  orderType:      string | null
}

function extractMetadata(headerRows: ZonedRow[]): ExtractedMetadata {
  let restaurantName: string | null = null
  let invoiceNumber:  string | null = null
  let receiptDate:    string | null = null
  let tableNumber:    string | null = null
  let tokenNumber:    string | null = null
  let orderType:      string | null = null

  const fullText = headerRows.map((r) => r.rawText).join('\n')

  // Restaurant name: first non-empty, non-metadata header line
  for (const row of headerRows.slice(0, 8)) {
    const text = row.rawText.trim()
    if (!text) continue
    if (isObviousMetadata(text)) continue
    if (extractAmounts(text).length > 0) continue
    if (isTaxOrTotalRow(text)) continue
    if (text.length < 2 || text.length > 80) continue
    if (restaurantName === null) { restaurantName = text; continue }
  }

  // Invoice / Bill number
  const invM = fullText.match(/\b(?:bill|invoice|receipt|order)\s*(?:no\.?|number|#|num)?\s*[:\-#]?\s*([\w\-\/]+)/i)
  if (invM) invoiceNumber = invM[1].trim()

  // Date
  receiptDate = extractDate(fullText)

  // Table number
  const tableM = fullText.match(/\b(?:table|tbl|seat|cover)\s*(?:no\.?|number|#)?\s*[:\-#]?\s*([\w\-]+)/i)
  if (tableM) tableNumber = tableM[1].trim()

  // Token number
  const tokenM = fullText.match(/\b(?:token|kot|counter|window)\s*(?:no\.?|number|#)?\s*[:\-#]?\s*([\w\-]+)/i)
  if (tokenM) tokenNumber = tokenM[1].trim()

  // Order type
  const orderM = fullText.match(/\b(dine[\s-]*in|take[\s-]*away|take[\s-]*out|delivery|parcel)\b/i)
  if (orderM) orderType = orderM[1].trim()

  return { restaurantName, invoiceNumber, receiptDate, tableNumber, tokenNumber, orderType }
}

// ═══════════════════════════════════════════════════════════════════
// TAX / TOTALS EXTRACTION
// ═══════════════════════════════════════════════════════════════════

interface ExtractedTotals {
  subtotal:      number | null
  taxes:         TaxEntry[]
  serviceCharge: number | null
  discount:      number | null
  grandTotal:    number | null
}

function extractTotals(totalsRows: ZonedRow[]): ExtractedTotals {
  let subtotal:      number | null = null
  let grandTotal:    number | null = null
  let serviceCharge: number | null = null
  let discount:      number | null = null
  const taxes: TaxEntry[] = []

  // Prefer grand total from GRAND_TOTAL_STRICT match, searching from the bottom
  for (const row of [...totalsRows].reverse()) {
    const text = row.rawText
    if (!GRAND_TOTAL_STRICT.test(text)) continue
    const amounts = extractAmounts(text)
    if (amounts.length > 0) { grandTotal = amounts[amounts.length - 1]; break
    }
  }

  // Fallback: last non-tax, non-subtotal totals line that has an amount
  if (grandTotal === null) {
    for (const row of [...totalsRows].reverse()) {
      const text = row.rawText
      if (SUBTOTAL_KW.test(text))  continue
      if (TAX_KW.test(text))       continue
      if (DISCOUNT_KW.test(text))  continue
      const amounts = extractAmounts(text)
      if (amounts.length > 0) { grandTotal = amounts[amounts.length - 1]; break }
    }
  }

  // Subtotal
  for (const row of totalsRows) {
    const text = row.rawText
    if (!SUBTOTAL_KW.test(text)) continue
    const amounts = extractAmounts(text)
    if (amounts.length > 0) { subtotal = amounts[amounts.length - 1]; break }
  }

  // Tax lines
  for (const row of totalsRows) {
    const text = row.rawText
    if (!TAX_KW.test(text) && !DISCOUNT_KW.test(text)) continue
    if (TOTAL_KEYWORDS.test(text) || SUBTOTAL_KW.test(text)) continue

    const amounts = extractAmounts(text)
    if (amounts.length === 0) continue
    const amount = amounts[amounts.length - 1]

    const rateM = text.match(/(\d+(?:\.\d+)?)\s*%/)
    const rate  = rateM ? parseFloat(rateM[1]) : null

    const lc = text.toLowerCase()
    let type: TaxEntry['type'] = 'other'
    if      (/\bcgst\b/.test(lc))              type = 'cgst'
    else if (/\bsgst\b/.test(lc))              type = 'sgst'
    else if (/\bigst\b/.test(lc))              type = 'igst'
    else if (/\bgst\b/.test(lc))               type = 'gst'
    else if (/service/.test(lc))               type = 'service'
    else if (DISCOUNT_KW.test(lc))             type = 'discount'
    else if (/packing|packaging/.test(lc))     type = 'packing'

    if (type === 'service') {
      serviceCharge = (serviceCharge ?? 0) + amount
    } else if (type === 'discount') {
      discount = (discount ?? 0) + amount
    } else {
      taxes.push({ label: text.trim(), type, rate, amount })
    }
  }

  return { subtotal, taxes, serviceCharge, discount, grandTotal }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function extractAmounts(text: string): number[] {
  const results: number[] = []
  let m: RegExpExecArray | null

  // ₹-prefixed
  const prefixed = /₹\s*([\d,]+(?:\.\d{1,2})?)/g
  while ((m = prefixed.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ''))
    if (isFinite(n) && n >= 0) results.push(n)
  }
  if (results.length > 0) return results

  // Decimal numbers
  const decimal = /\b(\d{1,6}\.\d{1,2})\b/g
  while ((m = decimal.exec(text)) !== null) {
    const n = parseFloat(m[1])
    if (isFinite(n) && n >= 0 && n <= 999_999) results.push(n)
  }
  if (results.length > 0) return results

  // Bare integers ≥ 10
  const bare = /\b(\d{2,6})\b/g
  while ((m = bare.exec(text)) !== null) {
    const n = parseInt(m[1], 10)
    if (n >= 10 && n <= 99_999) results.push(n)
  }
  return results
}

function parseMoney(text: string): number | null {
  if (!text.trim()) return null
  const amounts = extractAmounts(text)
  if (amounts.length === 0) return null
  return amounts[amounts.length - 1]
}

function parseQty(text: string): number | null {
  if (!text.trim()) return null
  const n = parseInt(text.replace(/\D/g, ''), 10)
  if (!isFinite(n) || n < 1 || n > 999) return null
  return n
}

function cleanItemName(raw: string): string {
  const cleaned = raw
    .replace(/^[\s\-_.,:;/\\]+/, '')
    .replace(/[\s\-_.,:;/\\]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!/[a-zA-Z\u0900-\u097F]/.test(cleaned)) return ''
  if (cleaned.length < 2) return ''
  return cleaned
}

function confBucket(tesseractConf: number): FieldConfidence {
  if (tesseractConf >= 85) return 'high'
  if (tesseractConf >= 60) return 'medium'
  return 'low'
}

// Months for date parsing
const MONTHS: Record<string, string> = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
}

function extractDate(text: string): string | null {
  // "14 Jan 2024"
  let m = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[,\s]+(\d{4})\b/i)
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,'0')}`

  // "14/01/2024" or "14-01-2024"
  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`

  // "2024-01-14"
  m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`

  return null
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — HOCR PATH
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a receipt from Tesseract HOCR XML output.
 *
 * This is the primary entry point for the Tesseract fallback path.
 * HOCR provides word-level bounding boxes and confidence scores, enabling
 * spatial zone detection and column-aware item extraction.
 */
export function parseReceiptHocr(hocrXml: string): ParsedReceipt {
  const reviewFlags: string[] = []

  // ── 1. Parse HOCR → tokens ───────────────────────────────────────────────
  const tokens = parseHocr(hocrXml)

  if (tokens.length < 5) {
    return emptyReceipt('No readable text found in image.', reviewFlags)
  }

  // ── 2. Group into rows ───────────────────────────────────────────────────
  const rows = groupIntoRows(tokens)

  // ── 3. Classify zones ────────────────────────────────────────────────────
  const zonedRows = classifyZones(rows)

  return buildReceiptFromZones(zonedRows, reviewFlags, 'tesseract', hocrXml)
}

/**
 * Parse receipt from plain text (legacy path, no HOCR).
 * Used when Tesseract is run without HOCR output.
 * Text lines are treated as rows with no spatial information.
 */
export function parseReceiptText(rawText: string): ParsedReceipt {
  const reviewFlags: string[] = []

  const lines = rawText
    .split('\n')
    .map((l) => l
      .replace(/\|/g, ' ')
      .replace(/Rs\./gi, '₹')
      .replace(/\bRs\b/gi, '₹')
      .replace(/\bINR\b/gi, '₹')
      .replace(/\s+/g, ' ')
      .trim(),
    )
    .filter((l) => l.length > 0)

  if (lines.length < 3) {
    return emptyReceipt('Receipt text too short.', reviewFlags)
  }

  // Synthesize VisualRow[] from text lines — Y = line index × 20px, no confidence data
  const syntheticRows: VisualRow[] = lines.map((line, idx) => {
    // Approximate token splitting by whitespace
    let x = 0
    const tokens: WordToken[] = line.split(/\s+/).filter(Boolean).map((word) => {
      const t: WordToken = { text: word, x, y: idx * 20, w: word.length * 8, h: 18, conf: 70 }
      x += t.w + 8
      return t
    })
    return { tokens, y: idx * 20, lineH: 18 }
  })

  const zonedRows = classifyZones(syntheticRows)
  return buildReceiptFromZones(zonedRows, reviewFlags, 'tesseract', rawText)
}

/**
 * Shared zone → ParsedReceipt builder.
 */
function buildReceiptFromZones(
  zonedRows:    ZonedRow[],
  reviewFlags:  string[],
  engine:       'tesseract' | null,
  rawText?:     string,
): ParsedReceipt {
  // ── Extract from zones ─────────────────────────────────────────────────
  const headerRows = zonedRows.filter((r) => r.zone === 'header')
  const colHdrRow  = zonedRows.find((r) => r.zone === 'col_hdr')
  const itemRows   = zonedRows.filter((r) => r.zone === 'item')
  const totalsRows = zonedRows.filter((r) => r.zone === 'totals')

  // Column geometry
  const cols = detectColumns(colHdrRow)

  // Metadata
  const meta = extractMetadata(headerRows)

  // Items (ONLY from item rows — never from header or totals)
  // Pass haveRealCoordinates=true only when we came from HOCR (real pixel coords)
  const haveRealCoords = engine === 'tesseract' && !!(rawText && rawText.includes('ocrx_word'))
  const rawItems = extractItems(itemRows, cols, haveRealCoords)

  // Totals
  const totals = extractTotals(totalsRows)

  // ── Build ScannedItems ────────────────────────────────────────────────
  const scannedItems: ScannedItem[] = rawItems
    .filter((r) => r.name.trim().length > 0)
    .map((raw) => {
      const unitPriceFinal = raw.unitPrice
        ?? (raw.lineTotal !== null ? raw.lineTotal / raw.quantity : 0)
      const lineTotalFinal = raw.lineTotal
        ?? Math.round(raw.quantity * unitPriceFinal * 100) / 100

      const mathMismatch =
        raw.unitPrice !== null &&
        raw.lineTotal !== null &&
        Math.abs(Math.round(raw.quantity * raw.unitPrice * 100) - Math.round(raw.lineTotal * 100)) > 50

      if (mathMismatch) {
        reviewFlags.push(`"${raw.name}": qty × unit price does not match line total`)
      }

      const needsReview =
        raw.nameConf  === 'low' ||
        raw.qtyConf   === 'low' ||
        raw.priceConf === 'low' ||
        raw.totalConf === 'low' ||
        mathMismatch

      const notes: string[] = []
      if (raw.nameConf  === 'low') notes.push('name unclear')
      if (raw.qtyConf   === 'low') notes.push('quantity unconfirmed')
      if (raw.priceConf === 'low') notes.push('unit price unconfirmed')
      if (raw.totalConf === 'low') notes.push('line total unconfirmed')
      if (mathMismatch)            notes.push('qty × price ≠ total')

      const overallConf: FieldConfidence = mathMismatch
        ? 'low'
        : raw.nameConf === 'low' ? 'low'
        : raw.nameConf === 'medium' ? 'medium'
        : 'high'

      return {
        name:                raw.name,
        quantity:            raw.quantity,
        unitPrice:           Math.round(unitPriceFinal * 100) / 100,
        lineTotal:           Math.round(lineTotalFinal * 100) / 100,
        lineTotalFromReceipt: raw.lineTotal !== null,
        confidence:          overallConf,
        fieldConfidence: {
          name:      raw.nameConf,
          quantity:  raw.qtyConf,
          unitPrice: raw.priceConf,
          lineTotal: raw.totalConf,
        },
        mathMismatch,
        needsReview,
        reviewNote: notes.length > 0 ? notes.join('; ') : null,
      }
    })

  // ── Subtotal ──────────────────────────────────────────────────────────
  const itemsSubtotal = scannedItems.reduce((s, it) => s + it.lineTotal, 0)
  const itemsSubtotalR = Math.round(itemsSubtotal * 100) / 100

  let subtotalFinal: number | null = totals.subtotal
  if (subtotalFinal !== null && itemsSubtotalR > 0) {
    const divergePct = Math.abs(subtotalFinal - itemsSubtotalR) / Math.max(subtotalFinal, 1)
    if (divergePct > 0.05) {
      reviewFlags.push(
        `Item total ₹${itemsSubtotalR.toFixed(2)} differs from receipt subtotal ₹${subtotalFinal.toFixed(2)}`,
      )
    }
  } else if (subtotalFinal === null && itemsSubtotalR > 0) {
    subtotalFinal = itemsSubtotalR
  }

  // ── Overall confidence ─────────────────────────────────────────────────
  const allConfs = zonedRows.flatMap((r) => r.tokens.map((t) => t.conf))
  const avgConf  = allConfs.length > 0
    ? allConfs.reduce((s, c) => s + c, 0) / allConfs.length
    : 50

  const overallConfidence: FieldConfidence =
    avgConf >= 80 && scannedItems.length >= 2 && totals.grandTotal !== null
      ? 'high'
      : avgConf >= 60 ? 'medium'
      : 'low'

  const requiresReview =
    overallConfidence !== 'high' ||
    reviewFlags.length > 0 ||
    scannedItems.some((it) => it.needsReview) ||
    totals.grandTotal === null

  // Add review flag for missing grand total (tests depend on this)
  if (totals.grandTotal === null && scannedItems.length > 0) {
    reviewFlags.push('Grand total not found on receipt')
  }

  return {
    restaurantName:  meta.restaurantName,
    receiptDate:     meta.receiptDate,
    invoiceNumber:   meta.invoiceNumber,
    items:           scannedItems,
    subtotal:        subtotalFinal,
    taxes:           totals.taxes,
    gst:             buildGstInfo(totals.taxes, rawText ?? ''),
    serviceCharge:   totals.serviceCharge,
    discount:        totals.discount,
    grandTotal:      totals.grandTotal,
    computedTotal:   buildComputedTotal(subtotalFinal, totals),
    totalsMatch:     buildTotalsMatch(totals.grandTotal, subtotalFinal, totals),
    overallConfidence,
    requiresReview,
    reviewFlags,
    rawLineCount:    zonedRows.length,
    ocrEngine:       engine,
  }
}

// ─── GST info builder (backward-compat with v3 tests) ────────────────────────

const INCLUSIVE_GST_RE = /\b(inclusive|incl\.?\s*(of|gst|tax)|tax\s*incl|gst\s*incl|all\s*taxes\s*inclusive)\b/i

function buildGstInfo(taxes: TaxEntry[], rawText: string): GstInfo {
  let cgstAmount: number | null = null
  let sgstAmount: number | null = null
  let igstAmount: number | null = null
  let gstFlatAmount: number | null = null
  let cgstRate: number | null = null
  let sgstRate: number | null = null
  let igstRate: number | null = null
  let gstRate: number | null = null

  for (const t of taxes) {
    switch (t.type) {
      case 'cgst': cgstAmount = (cgstAmount ?? 0) + t.amount; if (t.rate) cgstRate = t.rate; break
      case 'sgst': sgstAmount = (sgstAmount ?? 0) + t.amount; if (t.rate) sgstRate = t.rate; break
      case 'igst': igstAmount = (igstAmount ?? 0) + t.amount; if (t.rate) igstRate = t.rate; break
      case 'gst':  gstFlatAmount = (gstFlatAmount ?? 0) + t.amount; if (t.rate) gstRate = t.rate; break
    }
  }

  let totalGstAmount = 0
  if (cgstAmount !== null || sgstAmount !== null) {
    totalGstAmount = (cgstAmount ?? 0) + (sgstAmount ?? 0)
  } else if (igstAmount !== null) {
    totalGstAmount = igstAmount
  } else if (gstFlatAmount !== null) {
    totalGstAmount = gstFlatAmount
  }

  const gstPresent = cgstAmount !== null || sgstAmount !== null || igstAmount !== null || gstFlatAmount !== null
  const inclusive  = INCLUSIVE_GST_RE.test(rawText) ? true : gstPresent ? false : null

  const rate = (cgstRate !== null && sgstRate !== null)
    ? cgstRate + sgstRate
    : igstRate ?? gstRate ?? null

  const confidence: FieldConfidence =
    (cgstAmount !== null || sgstAmount !== null || igstAmount !== null) ? 'high'
    : gstFlatAmount !== null ? 'medium'
    : 'low'

  return { inclusive, rate, cgstAmount, sgstAmount, igstAmount, totalGstAmount, cgstRate, sgstRate, igstRate, confidence }
}

function buildComputedTotal(
  subtotalFinal: number | null,
  totals: { taxes: TaxEntry[]; serviceCharge: number | null; discount: number | null },
): number | null {
  if (subtotalFinal === null) return null
  let computed = Math.round(subtotalFinal * 100)
  for (const t of totals.taxes) computed += Math.round(t.amount * 100)
  if (totals.serviceCharge) computed += Math.round(totals.serviceCharge * 100)
  if (totals.discount)      computed -= Math.round(totals.discount * 100)
  return computed > 0 ? Math.round(computed) / 100 : null
}

function buildTotalsMatch(
  grandTotal:    number | null,
  subtotalFinal: number | null,
  totals:        { taxes: TaxEntry[]; serviceCharge: number | null; discount: number | null },
): boolean {
  const computed = buildComputedTotal(subtotalFinal, totals)
  if (grandTotal === null || computed === null) return false
  return Math.abs(Math.round(grandTotal * 100) - Math.round(computed * 100)) <= 100 // ₹1 tolerance
}

function emptyReceipt(flag: string, reviewFlags: string[]): ParsedReceipt {
  reviewFlags.push(flag)
  return {
    restaurantName: null, receiptDate: null, invoiceNumber: null,
    items: [], subtotal: null, taxes: [],
    gst: { inclusive: null, rate: null, cgstAmount: null, sgstAmount: null, igstAmount: null, totalGstAmount: 0, cgstRate: null, sgstRate: null, igstRate: null, confidence: 'low' },
    serviceCharge: null,
    discount: null, grandTotal: null,
    computedTotal: null, totalsMatch: false,
    overallConfidence: 'low', requiresReview: true, reviewFlags,
    rawLineCount: 0, ocrEngine: null,
  }
}

// ═══════════════════════════════════════════════════════════════════
// OCR QUALITY CHECK (used by scan route)
// ═══════════════════════════════════════════════════════════════════

export function checkOcrQuality(text: string): OcrQuality {
  const lines     = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const lineCount = lines.length
  const tooSparse = lineCount < 4

  let hasItemLines  = false
  let hasTotalLine  = false

  for (const line of lines) {
    if (!hasTotalLine && (TOTAL_KEYWORDS.test(line) || SUBTOTAL_KW.test(line))) {
      hasTotalLine = true
    }
    if (!hasItemLines) {
      const amounts  = extractAmounts(line)
      const hasLetter = /[a-zA-Z]/.test(line)
      if (hasLetter && amounts.length > 0) hasItemLines = true
    }
  }

  return {
    looksLikeReceipt: !tooSparse && (hasItemLines || hasTotalLine),
    tooSparse,
    hasItemLines,
    hasTotalLine,
    lineCount,
  }
}
