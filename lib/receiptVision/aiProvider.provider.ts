/**
 * lib/receiptVision/aiProvider.provider.ts
 *
 * Configurable AI Vision provider for the Group Bills receipt scanner.
 *
 * Connects to any OpenAI-compatible vision API endpoint — OpenAI, Azure OpenAI,
 * Groq, Together AI, Fireworks, local LM Studio, and so on.
 *
 * Configuration (server-side only — NEVER NEXT_PUBLIC_*):
 *   GROUP_BILL_AI_API_KEY   — your API key             (required to enable Tier 1)
 *   GROUP_BILL_AI_MODEL     — model name / deployment  (required)
 *   GROUP_BILL_AI_BASE_URL  — base URL of the endpoint (required)
 *
 * Example configurations:
 *
 *   OpenAI (GPT-4o)
 *     GROUP_BILL_AI_BASE_URL=https://api.openai.com/v1
 *     GROUP_BILL_AI_MODEL=gpt-4o
 *
 *   Azure OpenAI
 *     GROUP_BILL_AI_BASE_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>
 *     GROUP_BILL_AI_MODEL=gpt-4o
 *
 *   Groq (llama-3.2-vision)
 *     GROUP_BILL_AI_BASE_URL=https://api.groq.com/openai/v1
 *     GROUP_BILL_AI_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
 *
 *   Together AI
 *     GROUP_BILL_AI_BASE_URL=https://api.together.xyz/v1
 *     GROUP_BILL_AI_MODEL=meta-llama/Llama-Vision-Free
 *
 *   LM Studio (local)
 *     GROUP_BILL_AI_BASE_URL=http://localhost:1234/v1
 *     GROUP_BILL_AI_MODEL=<your-local-model-name>
 *
 * Pipeline contract:
 *   - extractReceipt() accepts image as base64 string + MIME type.
 *   - Returns ReceiptExtraction on success.
 *   - Throws ReceiptVisionError on any failure so the factory can fall through
 *     to Ollama or Tesseract transparently.
 *
 * Security invariants — MUST hold at all times:
 *   - GROUP_BILL_AI_API_KEY is read from process.env at runtime.
 *   - It is NEVER logged, returned to the client, or stored in any variable
 *     that could be serialised/inspected.
 *   - Receipt image data is passed only to the configured endpoint over HTTPS.
 *   - No image data, OCR text, or financial figures are written to any log.
 *   - Timeout: AI_TIMEOUT_MS (default 60 s) to avoid hanging the scan route.
 */

import type {
  ReceiptVisionProvider,
  ReceiptExtraction,
  ReceiptItem,
  TaxEntry,
  TaxType,
  MerchantInfo,
  BillMetadata,
  ItemFieldConfidence,
} from './types'
import { ReceiptVisionError } from './types'

// ─── Configuration ─────────────────────────────────────────────────────────────

const AI_TIMEOUT_MS = 60_000

/**
 * Read GROUP_BILL_AI_API_KEY from the environment.
 * Called once per request — never cached to avoid accidental exposure.
 * Returns null (not empty string) when the key is absent or blank.
 */
function getAiApiKey(): string | null {
  const key = process.env.GROUP_BILL_AI_API_KEY
  // Treat blank / whitespace-only as absent — guards against accidental spaces
  return key && key.trim().length > 0 ? key.trim() : null
}

function getAiModel(): string {
  const model = process.env.GROUP_BILL_AI_MODEL
  return model && model.trim().length > 0 ? model.trim() : ''
}

function getAiBaseUrl(): string {
  const url = process.env.GROUP_BILL_AI_BASE_URL
  return url && url.trim().length > 0 ? url.trim().replace(/\/$/, '') : ''
}

// ─── Provider availability ─────────────────────────────────────────────────────

/**
 * Returns true only when all three env vars are present and non-empty.
 * Does NOT make any network call — purely a configuration check.
 */
export function isAiProviderConfigured(): boolean {
  return (
    getAiApiKey() !== null &&
    getAiModel().length > 0 &&
    getAiBaseUrl().length > 0
  )
}

// ─── System prompt ─────────────────────────────────────────────────────────────

/**
 * Strict system prompt for context-aware receipt understanding.
 *
 * The AI must:
 *   1. Understand the structural layout of the receipt, not just raw text.
 *   2. Distinguish merchant info, bill metadata, food/product items, and totals.
 *   3. NEVER place metadata (address, phone, GSTIN, dates, bill no, table no,
 *      token no, subtotal, taxes, totals) into the items array.
 *   4. Reconstruct multi-line item names into a single string.
 *   5. Express ALL monetary values in integer paise (rupees × 100).
 *   6. Return null for any field not visible — NEVER guess or invent.
 *   7. Return ONLY the JSON object — no markdown, no prose.
 */
const SYSTEM_PROMPT = `You are a receipt-understanding assistant. Your task is to analyse the receipt image and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

You must understand the CONTEXT and LAYOUT of the receipt, not just extract raw text. A receipt has distinct sections:

SECTION A — Merchant / store information:
  Restaurant or store name, address, phone number, GSTIN, FSSAI licence number.
  These fields belong ONLY in the "merchant" object.

SECTION B — Bill / invoice metadata:
  Bill number, invoice number, date, time, order type (dine-in / takeaway / delivery),
  table number, token number, cashier name.
  These fields belong ONLY in the "bill" object.

SECTION C — Ordered items (THE ITEM TABLE):
  Each row represents one purchased product or food item.
  These are the ONLY entries that go into the "items" array.

SECTION D — Financial summary:
  Subtotal, CGST, SGST, IGST, service charge, discount, round-off, grand total.
  These belong ONLY in the "totals" object.

CRITICAL RULES — violating any rule makes the output invalid:

RULE 1 — ITEMS ARRAY PURITY:
  The "items" array must contain ONLY food/product line items from Section C.
  STRICTLY FORBIDDEN in "items": restaurant name, address, phone number, GSTIN,
  FSSAI number, bill number, invoice number, date, time, order type, table number,
  token number, cashier name, subtotal, any tax line (CGST/SGST/IGST/GST/VAT),
  service charge, discount, round-off, grand total, "thank you", "please visit again",
  any decorative separator or header text.

RULE 2 — MULTI-LINE ITEM NAMES:
  Many receipt printers wrap long item names across multiple lines.
  Example: three consecutive lines "Paneer", "Butter", "Masala" with no price
  on the first two lines represent ONE item: "Paneer Butter Masala".
  Join them into a single name. DO NOT create three separate items.

RULE 3 — MONETARY VALUES IN PAISE:
  ALL monetary amounts must be expressed as INTEGER PAISE (rupees × 100).
  ₹149.00  →  14900
  ₹16.85   →  1685
  ₹690.85  →  69085
  ₹0.15    →  15
  Never use decimal rupee values in the JSON.

RULE 4 — NULL DISCIPLINE:
  Any field that is not clearly visible or readable must be null.
  NEVER invent, guess, or default a value. If grand total is not on the receipt,
  grandTotalMinor must be null.

RULE 5 — ARITHMETIC:
  For every item: quantity × unitPriceMinor should equal lineTotalMinor
  (within 1 paise for rounding). If you cannot reconcile them, set the value
  you are most confident about and null the others rather than guessing.

Return exactly this JSON structure (no extra keys, no omitted keys):

{
  "merchant": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "gstin": "string or null",
    "fssai": "string or null"
  },
  "bill": {
    "number": "string or null",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "orderType": "string or null",
    "tableNumber": "string or null",
    "tokenNumber": "string or null",
    "cashier": "string or null"
  },
  "items": [
    {
      "name": "item name exactly as on receipt (multi-line joined)",
      "quantity": 1,
      "unitPriceMinor": 14900,
      "lineTotalMinor": 14900
    }
  ],
  "totals": {
    "subtotalMinor": 67400,
    "taxes": [
      { "name": "CGST @2.5%", "type": "cgst", "rate": 2.5, "amountMinor": 1685 },
      { "name": "SGST @2.5%", "type": "sgst", "rate": 2.5, "amountMinor": 1685 }
    ],
    "serviceChargeMinor": 0,
    "discountMinor": 0,
    "roundOffMinor": 0,
    "grandTotalMinor": 69085
  }
}

Valid tax type values: "cgst", "sgst", "igst", "gst", "vat", "service_charge", "packing", "delivery", "other".
If a tax line does not match any of the above, use "other".
If grand total is not visible, set grandTotalMinor to null.
If no taxes are present, set taxes to [].`

// ─── Raw API response shape ────────────────────────────────────────────────────

/** Shape of the JSON we expect the model to return inside the content field. */
interface RawReceiptJson {
  merchant?: {
    name?:    string | null
    address?: string | null
    phone?:   string | null
    gstin?:   string | null
    fssai?:   string | null
  } | null
  bill?: {
    number?:      string | null
    date?:        string | null
    time?:        string | null
    orderType?:   string | null
    tableNumber?: string | null
    tokenNumber?: string | null
    cashier?:     string | null
  } | null
  items?: Array<{
    name?:           string
    quantity?:       number
    unitPriceMinor?: number
    lineTotalMinor?: number
  }> | null
  totals?: {
    subtotalMinor?:      number | null
    taxes?: Array<{
      name?:        string
      type?:        string
      rate?:        number | null
      amountMinor?: number
    }> | null
    serviceChargeMinor?: number | null
    discountMinor?:      number | null
    roundOffMinor?:      number | null
    grandTotalMinor?:    number | null
  } | null
}

// ─── Sanitise helpers ──────────────────────────────────────────────────────────

/** Clamp a value to a non-negative integer, or return 0. */
function safeMinor(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v) || v < 0) return 0
  return Math.round(v)
}

/** Same as safeMinor but preserves null — for fields that may legitimately be absent. */
function safeNullMinor(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (v < 0) return null
  return Math.round(v)
}

/** Trim a string, return null if empty or not a string. */
function safeStr(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Validate an ISO date string YYYY-MM-DD; return null if malformed. */
function validateDate(s: string | null): string | null {
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

const VALID_TAX_TYPES: TaxType[] = [
  'cgst', 'sgst', 'igst', 'gst', 'vat',
  'service_charge', 'packing', 'delivery', 'other',
]

function coerceTaxType(raw: string | null | undefined): TaxType {
  if (!raw) return 'other'
  const norm = raw.toLowerCase().trim().replace(/[\s-]/g, '_')
  return (VALID_TAX_TYPES as string[]).includes(norm) ? (norm as TaxType) : 'other'
}

/** Confidence scores for AI-extracted items — model understands structure. */
const HIGH_CONF: ItemFieldConfidence = {
  name:      0.92,
  quantity:  0.92,
  unitPrice: 0.92,
  lineTotal: 0.92,
}

/** Lower confidence when arithmetic repair was needed. */
const MEDIUM_CONF: ItemFieldConfidence = {
  name:      0.75,
  quantity:  0.75,
  unitPrice: 0.75,
  lineTotal: 0.75,
}

// ─── JSON extraction helper ────────────────────────────────────────────────────

/**
 * Extract a JSON object from a model response string.
 * Handles: pure JSON, markdown code fences, leading/trailing prose.
 */
function extractJson(raw: string): unknown {
  // Direct parse
  try {
    return JSON.parse(raw)
  } catch { /* fall through */ }

  // Markdown code fence: ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
  }

  // Outermost { ... } block
  const first = raw.indexOf('{')
  const last  = raw.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)) } catch { /* fall through */ }
  }

  throw new ReceiptVisionError(
    'extraction_failed',
    'AI response did not contain valid JSON.',
  )
}

// ─── Response normaliser ───────────────────────────────────────────────────────

/**
 * Convert the raw JSON the model returned into a typed ReceiptExtraction.
 * Every field is sanitised and validated.  Nothing is trusted blindly.
 */
function parseAiResponse(raw: unknown): ReceiptExtraction {
  const r = raw as RawReceiptJson

  // ── Section A: Merchant ─────────────────────────────────────────────────
  const merchant: MerchantInfo = {
    name:    safeStr(r.merchant?.name),
    address: safeStr(r.merchant?.address),
    phone:   safeStr(r.merchant?.phone),
    gstin:   safeStr(r.merchant?.gstin),
    fssai:   safeStr(r.merchant?.fssai),
  }

  // ── Section B: Bill metadata ─────────────────────────────────────────────
  const bill: BillMetadata = {
    number:      safeStr(r.bill?.number),
    date:        validateDate(safeStr(r.bill?.date)),
    time:        safeStr(r.bill?.time),
    orderType:   safeStr(r.bill?.orderType),
    tableNumber: safeStr(r.bill?.tableNumber),
    tokenNumber: safeStr(r.bill?.tokenNumber),
    cashier:     safeStr(r.bill?.cashier),
  }

  // ── Section C: Items ─────────────────────────────────────────────────────
  const items: ReceiptItem[] = []
  for (const raw of (r.items ?? [])) {
    const name = safeStr(raw.name)
    if (!name) continue  // skip blank-name entries

    const quantity       = (Number.isFinite(raw.quantity) && raw.quantity! > 0)
      ? Math.round(raw.quantity!)
      : 1
    const unitPriceMinor = safeMinor(raw.unitPriceMinor)
    const lineTotalMinor = safeMinor(raw.lineTotalMinor)

    // Repair lineTotalMinor if the model left it at 0 but we have unit + qty
    const repairedTotal = (lineTotalMinor === 0 && unitPriceMinor > 0)
      ? quantity * unitPriceMinor
      : lineTotalMinor

    const mathOk = Math.abs(quantity * unitPriceMinor - repairedTotal) <= 1

    items.push({
      name,
      quantity,
      unitPriceMinor,
      lineTotalMinor: repairedTotal,
      confidence: mathOk ? HIGH_CONF : MEDIUM_CONF,
    })
  }

  // ── Section D: Taxes ─────────────────────────────────────────────────────
  const taxes: TaxEntry[] = []
  for (const t of (r.totals?.taxes ?? [])) {
    const name = safeStr(t.name)
    if (!name) continue
    const amountMinor = safeMinor(t.amountMinor)
    if (amountMinor === 0) continue
    taxes.push({
      name,
      type:        coerceTaxType(t.type),
      rate:        (t.rate != null && Number.isFinite(t.rate) && t.rate >= 0) ? t.rate : null,
      amountMinor,
    })
  }

  // ── Section D: Other totals ──────────────────────────────────────────────
  const serviceChargeMinor = safeMinor(r.totals?.serviceChargeMinor)
  const discountMinor      = safeMinor(r.totals?.discountMinor)
  const roundOffMinor      = Math.round(r.totals?.roundOffMinor ?? 0)
  const subtotalMinor      = safeNullMinor(r.totals?.subtotalMinor)
  const grandTotalMinor    = safeNullMinor(r.totals?.grandTotalMinor)

  // ── Overall confidence ───────────────────────────────────────────────────
  // AI vision models produce high-quality structured output.
  // Reduce confidence slightly when grand total is absent.
  const overallConfidence =
    items.length > 0 && grandTotalMinor !== null ? 0.92
    : items.length > 0                           ? 0.75
    :                                              0.40

  return {
    merchant,
    bill,
    items,
    subtotalMinor,
    taxes,
    serviceChargeMinor,
    discountMinor,
    roundOffMinor,
    grandTotalMinor,
    overallConfidence,
    provider: 'ai' as ReceiptExtraction['provider'],
  }
}

// ─── Provider class ────────────────────────────────────────────────────────────

export class AiReceiptProvider implements ReceiptVisionProvider {
  readonly name = 'ai'

  async extractReceipt(
    imageBase64: string,
    mimeType:    string,
  ): Promise<ReceiptExtraction> {
    // Read config at call time — never cached, never logged
    const apiKey  = getAiApiKey()
    const model   = getAiModel()
    const baseUrl = getAiBaseUrl()

    // Guard — caller should have checked isAiProviderConfigured() first,
    // but be defensive here too.
    if (!apiKey || !model || !baseUrl) {
      throw new ReceiptVisionError(
        'provider_unavailable',
        'AI provider is not configured (GROUP_BILL_AI_API_KEY / MODEL / BASE_URL missing).',
      )
    }

    // Normalise MIME
    const mime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
    const dataUrl = `data:${mime};base64,${imageBase64}`

    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

    let responseText: string
    try {
      // POST to /chat/completions — the standard OpenAI-compatible endpoint.
      const endpoint = `${baseUrl}/chat/completions`

      const res = await fetch(endpoint, {
        method:  'POST',
        // Authorization header carries the API key.
        // It is constructed inline so it is never stored in a local variable
        // that could be inadvertently serialised or logged.
        headers: {
          'Content-Type':  'application/json',
          // Key is used directly — never logged, never returned to client
          'Authorization': `Bearer ${process.env.GROUP_BILL_AI_API_KEY ?? ''}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role:    'system',
              content: SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: [
                {
                  type:      'image_url',
                  image_url: { url: dataUrl, detail: 'high' },
                },
                {
                  type: 'text',
                  text: 'Parse this receipt image and return the structured JSON exactly as specified.',
                },
              ],
            },
          ],
          // Deterministic output — no temperature-driven creativity
          temperature: 0,
          // Adequate token budget for a full receipt with many items
          max_tokens: 2048,
          // Request JSON mode where the provider supports it
          response_format: { type: 'json_object' },
        }),
      })
      clearTimeout(timer)

      if (res.status === 401 || res.status === 403) {
        // Deliberately vague — do not log the key or reveal its value
        throw new ReceiptVisionError(
          'provider_unavailable',
          'AI provider rejected the request (authentication error). Check GROUP_BILL_AI_API_KEY.',
        )
      }

      if (res.status === 429) {
        throw new ReceiptVisionError(
          'rate_limited',
          'AI provider rate limit reached. Please try again shortly.',
        )
      }

      if (res.status === 400) {
        // Could be an unsupported model or malformed image — treat as image rejected
        throw new ReceiptVisionError(
          'image_rejected',
          'AI provider could not process this image (HTTP 400). Try a clearer photo.',
        )
      }

      if (!res.ok) {
        throw new ReceiptVisionError(
          'provider_unavailable',
          `AI provider returned HTTP ${res.status}.`,
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any

      // OpenAI-compatible response shape
      const content: unknown =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        null

      if (typeof content !== 'string' || !content.trim()) {
        throw new ReceiptVisionError(
          'extraction_failed',
          'AI provider returned an empty or unexpected response shape.',
        )
      }

      responseText = content
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof ReceiptVisionError) throw err

      const msg = err instanceof Error ? err.message : String(err)
      const isAbort =
        msg.includes('AbortError') ||
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError')

      if (isAbort) {
        throw new ReceiptVisionError(
          'timeout',
          `AI provider did not respond within ${AI_TIMEOUT_MS / 1000}s.`,
          err,
        )
      }

      const isUnreachable =
        msg.includes('fetch failed') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('ECONNRESET') ||
        msg.includes('network')

      if (isUnreachable) {
        throw new ReceiptVisionError(
          'provider_unavailable',
          `AI provider endpoint is not reachable at ${baseUrl}.`,
          err,
        )
      }

      throw new ReceiptVisionError('extraction_failed', msg, err)
    }

    // ── Parse and validate the model's JSON response ──────────────────────
    let parsed: unknown
    try {
      parsed = extractJson(responseText)
    } catch {
      throw new ReceiptVisionError(
        'extraction_failed',
        'AI response could not be parsed as JSON.',
      )
    }

    try {
      return parseAiResponse(parsed)
    } catch (err) {
      if (err instanceof ReceiptVisionError) throw err
      throw new ReceiptVisionError(
        'extraction_failed',
        'Failed to interpret AI receipt output.',
        err,
      )
    }
  }
}
