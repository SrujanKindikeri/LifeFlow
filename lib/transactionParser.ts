/**
 * transactionParser.ts
 *
 * Content-based parser for UPI / payment app screenshots.
 *
 * Design principles:
 *  - Works purely on extracted text — no coordinate-based parsing.
 *  - Supports PhonePe, Paytm, BHIM, GPay, and any unknown layout.
 *  - Never invents values: if a field cannot be found, it is left undefined.
 *  - Never trusts OCR output blindly: caller must show results for user confirmation.
 *  - Amount precision: returns values in minor units (paise) after user confirmation.
 */

import type {
  TransactionDirection,
  TransactionStatus,
  ITransactionReference,
  TransactionReferenceType,
} from '@/models/Expense'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ParsedTransaction {
  /** Amount in rupees as a human-readable string, e.g. "75.00". Caller converts to paise. */
  amountRaw?: string
  /** Rounded amount in rupees (number), after stripping currency symbols. */
  amountRupees?: number
  currency: string
  direction?: TransactionDirection
  status?: TransactionStatus

  // Parties
  paidTo?: string
  receivedFrom?: string
  upiId?: string
  phoneNumber?: string
  bank?: string

  // References — can have multiple (UTR + Transaction ID etc.)
  references: ITransactionReference[]

  // Date / time as found in the text
  transactionDate?: string   // YYYY-MM-DD
  transactionTime?: string   // HH:MM

  remarks?: string

  // Quality indicators
  multipleDetected: boolean
  lowConfidence: boolean
  confidence: 'high' | 'partial' | 'low'
}

export interface ParseResult {
  ok: boolean
  parsed?: ParsedTransaction
  /** Human-readable message to show when ok=false */
  message?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip common noise from OCR lines */
function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Convert rupees (possibly decimal) to integer paise.
 * E.g. 75.00 → 7500, 105 → 10500
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

// ─── Amount extraction ────────────────────────────────────────────────────────

/**
 * Extract the transaction amount from OCR text.
 *
 * Strategy (highest → lowest priority):
 *  1. Amount on a keyword line: "Amount: ₹75", "Paid ₹75", "Total ₹1,250.50"
 *  2. Currency-prefixed standalone amount: "₹ 75.00", "Rs. 105", "INR 20"
 *  3. Bare large number on its own line following a known header
 *     (many UPI apps render the amount as a big heading without a ₹ on
 *     the same OCR text line, e.g.  "Transaction Successful\n75.00\n…")
 *
 * Handles:  ₹105  ₹105.00  ₹20  ₹75.00  ₹1,250  ₹1,250.50
 *           Rs 105  Rs. 105  INR 105
 *           bare 75 / 75.00 on its own line near a payment keyword
 */
function extractAmount(text: string): { raw: string; rupees: number } | undefined {
  type Match = { raw: string; rupees: number; priority: number }
  const candidates: Match[] = []
  let m: RegExpExecArray | null

  // ── Priority 1: amount on / after a keyword line ───────────────────────────
  // Matches "Amount ₹75", "Paid ₹75.00", "Total Rs. 1,250", "Debited: INR 500"
  // Also handles when the number is on the NEXT line after the keyword:
  //   "Amount\n75.00"  or  "Amount\n₹75"
  const kwAmountPattern =
    /(?:amount|total|paid|sent|debited|transferred|payment|transaction)[^\n]{0,40}?(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi
  kwAmountPattern.lastIndex = 0
  while ((m = kwAmountPattern.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(val) && val > 0) {
      candidates.push({ raw: m[1], rupees: val, priority: 1 })
    }
  }

  // Also keyword → newline → (optional ₹) → number
  const kwNextLinePattern =
    /(?:amount|total|paid|sent|debited|transferred|payment|transaction)[^\n]*\n\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/gi
  kwNextLinePattern.lastIndex = 0
  while ((m = kwNextLinePattern.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(val) && val > 0) {
      candidates.push({ raw: m[1], rupees: val, priority: 1 })
    }
  }

  // ── Priority 2: currency-prefixed amount anywhere ──────────────────────────
  // ₹75  ₹ 75.00  Rs.105  Rs 1,250.50  INR 20
  const currencyPattern = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi
  currencyPattern.lastIndex = 0
  while ((m = currencyPattern.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(val) && val > 0) {
      candidates.push({ raw: m[1], rupees: val, priority: 2 })
    }
  }

  // ── Priority 3: bare number on its own line that looks like a payment amount ─
  // Many UPI apps show the big amount as "75.00" or "75" on a line by itself
  // right after/before a success/payment heading.
  // Only match if a payment keyword appears within 3 lines of the number.
  const lines = text.split('\n')
  const PAYMENT_KW = /paid|sent|received|debited|credited|success|transaction|amount|payment|transfer/i
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // Line must be ONLY a number (with optional commas/decimal) — nothing else
    if (!/^[\d,]+(?:\.\d{1,2})?$/.test(line)) continue
    const val = parseFloat(line.replace(/,/g, ''))
    if (isNaN(val) || val <= 0) continue
    // Check surrounding context (±3 lines) for a payment keyword
    const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' ')
    if (PAYMENT_KW.test(context)) {
      candidates.push({ raw: line, rupees: val, priority: 3 })
    }
  }

  if (candidates.length === 0) return undefined

  // Sort by priority (lower = better), then by first-occurrence position
  // (earlier in text = more prominent)
  candidates.sort((a, b) => a.priority - b.priority)

  const best = candidates[0]
  // Normalise raw to a clean decimal string for display
  const raw = best.rupees % 1 === 0 ? String(best.rupees) : best.rupees.toFixed(2)
  return { raw, rupees: best.rupees }
}

// ─── Direction detection ──────────────────────────────────────────────────────

const SENT_KEYWORDS = [
  'paid', 'payment made', 'you paid', 'sent', 'debited', 'money sent',
  'transferred', 'transfer successful', 'you sent', 'debit',
]
const RECEIVED_KEYWORDS = [
  'received', 'money received', 'credited', 'credit', 'you received',
  'payment received', 'receiving', 'received from',
]

function detectDirection(text: string): TransactionDirection | undefined {
  const lower = text.toLowerCase()

  // Check for explicit "money received" / "received from" patterns first
  if (/money\s+received|received\s+from|payment\s+received|amount\s+credited/i.test(text)) {
    return 'received'
  }
  if (/money\s+sent|payment\s+made|amount\s+debited/i.test(text)) {
    return 'sent'
  }

  // Score-based for ambiguous text
  let sentScore = 0
  let receivedScore = 0

  for (const kw of SENT_KEYWORDS) {
    if (lower.includes(kw)) sentScore++
  }
  for (const kw of RECEIVED_KEYWORDS) {
    if (lower.includes(kw)) receivedScore++
  }

  if (sentScore > receivedScore) return 'sent'
  if (receivedScore > sentScore) return 'received'
  return undefined
}

// ─── Status detection ─────────────────────────────────────────────────────────

function detectStatus(text: string): TransactionStatus | undefined {
  const lower = text.toLowerCase()

  if (/transaction\s+successful|payment\s+successful|transfer\s+successful/i.test(text)) {
    return 'successful'
  }
  if (/\bsuccessful\b|\bsuccess\b/i.test(text)) return 'successful'
  if (/\bcompleted\b/i.test(text)) return 'completed'
  if (/\breceived\b/i.test(text) && !lower.includes('not received')) return 'received'
  if (/\bpaid\b/i.test(text)) return 'paid'
  if (/\bfailed\b|\bfailure\b/i.test(text)) return 'failed'
  if (/\bdeclined\b|\brejected\b/i.test(text)) return 'declined'
  if (/\bpending\b/i.test(text)) return 'pending'

  return undefined
}

// ─── Reference extraction ─────────────────────────────────────────────────────

interface ReferencePattern {
  type: TransactionReferenceType
  patterns: RegExp[]
}

const REFERENCE_PATTERNS: ReferencePattern[] = [
  {
    type: 'UTR',
    patterns: [
      /UTR[\s:#]*([A-Z0-9]{10,22})/gi,
      /UTR\s+No\.?[\s:#]*([A-Z0-9]{10,22})/gi,
    ],
  },
  {
    type: 'UPI_TRANSACTION_ID',
    patterns: [
      /(?:PhonePe\s+)?Transaction\s+ID[\s:#]*([A-Z0-9]{10,30})/gi,
      /UPI\s+Transaction\s+ID[\s:#]*([A-Z0-9]{10,30})/gi,
      /Txn\s+ID[\s:#]*([A-Z0-9]{10,30})/gi,
    ],
  },
  {
    type: 'UPI_REF',
    patterns: [
      /UPI\s+Ref(?:erence)?\s*(?:No\.?|Number)?[\s:#]*(\d{10,20})/gi,
      /UPI\s+Ref\s*No\.?[\s:#]*(\d{10,20})/gi,
      /Ref(?:erence)?\s+(?:No\.?|Number)[\s:#]*(\d{10,20})/gi,
    ],
  },
  {
    type: 'TRANSACTION_ID',
    patterns: [
      /Transaction\s+ID[\s:#]*([A-Z0-9]{6,30})/gi,
      /Txn[\s:#]*([A-Z0-9]{6,30})/gi,
    ],
  },
  {
    type: 'REFERENCE_NUMBER',
    patterns: [
      /Reference\s+(?:No\.?|Number)[\s:#]*([A-Z0-9]{6,30})/gi,
    ],
  },
]

function extractReferences(text: string): ITransactionReference[] {
  const results: ITransactionReference[] = []
  const seenValues = new Set<string>()

  for (const { type, patterns } of REFERENCE_PATTERNS) {
    for (const pattern of patterns) {
      // Reset lastIndex because we reuse RegExp objects
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(text)) !== null) {
        const value = m[1].trim()
        // Deduplicate across reference types
        if (!seenValues.has(value) && value.length >= 6) {
          seenValues.add(value)
          results.push({ value, type })
        }
      }
    }
  }

  return results
}

// ─── Party extraction ─────────────────────────────────────────────────────────

/**
 * Extract the person or merchant name from lines following "from:", "to:",
 * "paid to:", "received from:", "banking name:", etc.
 */
function extractParties(text: string): { paidTo?: string; receivedFrom?: string } {
  const result: { paidTo?: string; receivedFrom?: string } = {}

  // "Paid to / Transfer to / Sent to / To:"
  const toMatch = text.match(
    /(?:paid\s+to|transfer(?:red)?\s+to|sent\s+to|payment\s+to|to)\s*[:\-]?\s*\n?\s*([^\n₹\d][^\n]{1,80})/i
  )
  if (toMatch) {
    const name = clean(toMatch[1])
    if (name.length > 1 && !isReferenceNumber(name)) result.paidTo = name
  }

  // "Received from / From:"
  const fromMatch = text.match(
    /(?:received\s+from|money\s+from|from)\s*[:\-]?\s*\n?\s*([^\n₹\d][^\n]{1,80})/i
  )
  if (fromMatch) {
    const name = clean(fromMatch[1])
    if (name.length > 1 && !isReferenceNumber(name)) result.receivedFrom = name
  }

  // BHIM: "Banking Name:"
  const bankingName = text.match(/banking\s+name\s*[:\-]?\s*([^\n]{2,80})/i)
  if (bankingName) {
    const name = clean(bankingName[1])
    if (name.length > 1 && !isReferenceNumber(name)) {
      // Assign based on detected direction — fall through as paidTo for BHIM payments
      if (!result.paidTo && !result.receivedFrom) result.paidTo = name
    }
  }

  return result
}

/** Heuristic: reject a string that looks like a reference number as a name. */
function isReferenceNumber(s: string): boolean {
  return /^[A-Z0-9]{8,}$/.test(s.replace(/\s/g, ''))
}

// ─── UPI ID extraction ────────────────────────────────────────────────────────

function extractUpiId(text: string): string | undefined {
  // UPI IDs are of the form handle@provider, possibly masked with *
  const match = text.match(/([*\w.+-]{2,}@[a-z]{2,20}(?:\.[a-z]{2,10})?)/i)
  return match ? match[1].trim() : undefined
}

// ─── Phone number extraction ──────────────────────────────────────────────────

function extractPhone(text: string): string | undefined {
  // Indian mobile: 10 digits starting with 6-9, possibly masked with *
  const match = text.match(/(?:\+91[-\s]?)?([6-9\*][\d\*]{9})/i)
  if (!match) return undefined
  const phone = match[1].replace(/\s/g, '')
  // Must have at least some real digits (not fully masked)
  if (/^\*+$/.test(phone)) return undefined
  return phone
}

// ─── Bank extraction ──────────────────────────────────────────────────────────

const KNOWN_BANKS = [
  'State Bank of India', 'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank',
  'Kotak Mahindra Bank', 'Kotak Bank', 'Punjab National Bank', 'PNB',
  'Bank of Baroda', 'BOB', 'Canara Bank', 'Union Bank', 'Indian Bank',
  'Bank of India', 'Central Bank', 'UCO Bank', 'Indian Overseas Bank',
  'IDBI Bank', 'YES Bank', 'Federal Bank', 'South Indian Bank',
  'Karnataka Bank', 'IndusInd Bank', 'RBL Bank', 'City Union Bank',
  'BHIM', 'GPay', 'Google Pay', 'PhonePe', 'Paytm', 'Razorpay', 'Juspay',
]

function extractBank(text: string): string | undefined {
  for (const bank of KNOWN_BANKS) {
    if (new RegExp(`\\b${bank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
      return bank
    }
  }

  // Generic: "Debited from <Bank Name>" or "Credited to <Bank Name>"
  const debitMatch = text.match(
    /(?:debited\s+(?:from|account)|credited\s+to|debited\s+account)\s*[:\-]?\s*([^\n\d₹]{3,60})/i
  )
  if (debitMatch) {
    const candidate = clean(debitMatch[1])
    if (candidate.length > 2) return candidate
  }

  return undefined
}

// ─── Date / time extraction ───────────────────────────────────────────────────

/**
 * Attempt to parse a transaction date from any of the common formats found
 * in payment app screenshots.
 *
 * Returns YYYY-MM-DD or undefined.
 */
function extractDate(text: string): string | undefined {
  const patterns: Array<{ re: RegExp; parse: (m: RegExpMatchArray) => Date | null }> = [
    // "02 Sep 2026", "2nd Sep 2026", "9th Sep 26"
    {
      re: /(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/gi,
      parse: (m) => {
        const day = parseInt(m[1], 10)
        const mon = MONTH_MAP[m[2].toLowerCase().slice(0, 3)]
        let year = parseInt(m[3], 10)
        if (year < 100) year += 2000
        if (mon === undefined) return null
        return new Date(year, mon, day)
      },
    },
    // "Sep 2, 2026" / "Sep 02 2026"
    {
      re: /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/gi,
      parse: (m) => {
        const mon = MONTH_MAP[m[1].toLowerCase().slice(0, 3)]
        const day = parseInt(m[2], 10)
        let year = parseInt(m[3], 10)
        if (year < 100) year += 2000
        if (mon === undefined) return null
        return new Date(year, mon, day)
      },
    },
    // "2026-09-02" ISO
    {
      re: /(\d{4})-(\d{2})-(\d{2})/g,
      parse: (m) => new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])),
    },
    // "02/09/2026" or "02-09-2026" (DD/MM/YYYY)
    {
      re: /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g,
      parse: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])),
    },
  ]

  for (const { re, parse } of patterns) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) {
      const d = parse(m)
      if (d && !isNaN(d.getTime())) {
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}`
      }
    }
  }

  return undefined
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/**
 * Extract time in HH:MM format (24h or 12h, normalised to HH:MM).
 */
function extractTime(text: string): string | undefined {
  // 12h with AM/PM: "01:51 PM"
  const ampm = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (ampm) {
    let hours = parseInt(ampm[1], 10)
    const mins = ampm[2]
    const meridiem = ampm[3].toUpperCase()
    if (meridiem === 'PM' && hours !== 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0
    return `${String(hours).padStart(2, '0')}:${mins}`
  }
  // 24h: "09:25"
  const h24 = text.match(/\b(\d{2}):(\d{2})(?::\d{2})?\b/)
  if (h24) return `${h24[1]}:${h24[2]}`
  return undefined
}

// ─── Remarks ──────────────────────────────────────────────────────────────────

function extractRemarks(text: string): string | undefined {
  const m = text.match(/(?:remarks?|note|description|purpose)\s*[:\-]?\s*([^\n]{1,200})/i)
  if (!m) return undefined
  const r = clean(m[1])
  // "NO REMARK" / "N/A" / "-" → treat as absent
  if (/^(?:no\s+remark|none|n\/a|nil|-+|null)$/i.test(r)) return undefined
  return r
}

// ─── Multiple transaction detection ──────────────────────────────────────────

/**
 * Heuristic: if the text contains more than 2 distinct currency amounts on
 * separate lines, there may be multiple transactions.
 */
function detectMultiple(text: string): boolean {
  const amounts = [...text.matchAll(/(?:₹|Rs\.?)\s*[\d,]+(?:\.\d{1,2})?/gi)]
  return amounts.length > 2
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function scoreConfidence(parsed: ParsedTransaction): 'high' | 'partial' | 'low' {
  let score = 0
  if (parsed.amountRupees !== undefined) score += 3
  if (parsed.transactionDate) score += 2
  if (parsed.direction) score += 2
  if (parsed.references.length > 0) score += 2
  if (parsed.paidTo || parsed.receivedFrom) score += 1

  if (score >= 8) return 'high'
  if (score >= 4) return 'partial'
  return 'low'
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Parse raw OCR text extracted from a payment screenshot.
 *
 * This function receives plain text (already extracted from the image by the
 * caller's OCR layer) and returns structured transaction data for user review.
 *
 * IMPORTANT: The returned data is a best-effort extraction. The caller MUST
 * present it to the user for review and confirmation before using any values.
 */
export function parseTransactionText(ocrText: string): ParseResult {
  // Empty string means the OCR layer returned nothing at all — this is
  // distinct from "OCR ran but found no transaction text" and should not
  // be described as "blank or unreadable" to the user.
  if (!ocrText || ocrText.trim().length < 5) {
    return {
      ok: false,
      message: "I couldn't find readable transaction text in this image.",
    }
  }

  const text = ocrText

  const amountResult = extractAmount(text)
  const parties = extractParties(text)
  const direction = detectDirection(text)
  const status = detectStatus(text)
  const references = extractReferences(text)
  const upiId = extractUpiId(text)
  const phoneNumber = extractPhone(text)
  const bank = extractBank(text)
  const transactionDate = extractDate(text)
  const transactionTime = extractTime(text)
  const remarks = extractRemarks(text)
  const multipleDetected = detectMultiple(text)

  const parsed: ParsedTransaction = {
    amountRaw:       amountResult?.raw,
    amountRupees:    amountResult?.rupees,
    currency:        'INR',
    direction,
    status,
    paidTo:          parties.paidTo,
    receivedFrom:    parties.receivedFrom,
    upiId,
    phoneNumber,
    bank,
    references,
    transactionDate,
    transactionTime,
    remarks,
    multipleDetected,
    lowConfidence:   false,
    confidence:      'low', // filled below
  }

  parsed.confidence = scoreConfidence(parsed)
  parsed.lowConfidence = parsed.confidence === 'low'

  // Require at least an amount to consider parsing successful
  if (parsed.amountRupees === undefined) {
    return {
      ok: true,
      parsed: { ...parsed, lowConfidence: true, confidence: 'low' },
      message: 'Could not detect a transaction amount. Please enter the amount manually.',
    }
  }

  return { ok: true, parsed }
}

// ─── Text extraction from image (client-side, no OCR library) ────────────────

/**
 * Extracts OCR text from an image file using the browser's native
 * window.Tesseract API if available, or returns null to fall back
 * to the server-side scan route.
 *
 * This function is intentionally minimal — the real OCR is delegated
 * to the /api/expenses/scan-upload server route which can use
 * any server-side OCR service.
 */
export async function extractTextClientSide(_file: File): Promise<string | null> {
  // No browser OCR library installed — always delegate to server route.
  // If a future OCR library (e.g. tesseract.js) is added, implement here.
  return null
}
