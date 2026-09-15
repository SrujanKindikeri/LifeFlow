/**
 * lib/receiptVision/ollama.provider.ts
 *
 * Self-hosted vision-language model provider via Ollama.
 *
 * Communicates with a locally-running Ollama instance (e.g. llava, llava:13b,
 * moondream, minicpm-v, etc.) that can analyse receipt images and return
 * structured JSON.
 *
 * Configuration (server-side only — NEVER NEXT_PUBLIC_*):
 *   OLLAMA_BASE_URL  e.g. http://localhost:11434   (default)
 *   OLLAMA_MODEL     e.g. llava:7b                 (default: llava)
 *
 * The model is instructed via a system prompt to return strict JSON that
 * maps to the ReceiptExtraction schema. It MUST NOT invent values — missing
 * fields must be null.
 *
 * Graceful degradation:
 *   - If OLLAMA_BASE_URL is not reachable, throws ReceiptVisionError
 *     with code 'provider_unavailable'. The scan route catches this and
 *     falls back to TesseractReceiptProvider automatically.
 *   - If the model returns malformed JSON, throws code 'extraction_failed'.
 *   - Timeout after OLLAMA_TIMEOUT_MS (default 90s).
 *
 * Security:
 *   - OLLAMA_BASE_URL and OLLAMA_MODEL are read from process.env at runtime.
 *   - They are NEVER returned to the client.
 *   - Receipt images are never logged or stored.
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

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_MODEL     = 'llava'
const OLLAMA_TIMEOUT_MS = 90_000

/**
 * Return the Ollama base URL from the environment.
 *
 * OLLAMA_BASE_URL must be set explicitly — there is intentionally no
 * localhost default. Hardcoding http://localhost:11434 would break Docker
 * deployments where Ollama runs on the host or in a sibling container.
 *
 * Deployment examples (set in .env.local / .env / platform secrets):
 *   Native host:          OLLAMA_BASE_URL=http://localhost:11434
 *   Docker host machine:  OLLAMA_BASE_URL=http://host.docker.internal:11434
 *   Sibling container:    OLLAMA_BASE_URL=http://ollama:11434
 *   Remote server:        OLLAMA_BASE_URL=http://<host-or-ip>:11434
 *
 * Returns null when the variable is absent or blank — callers must guard
 * against null before making any network request.
 */
function getOllamaBaseUrl(): string | null {
  const url = process.env.OLLAMA_BASE_URL
  if (!url || !url.trim()) return null
  return url.trim().replace(/\/$/, '')
}

function getOllamaModel(): string {
  return (process.env.OLLAMA_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL
}

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt instructs the model to return ONLY structured JSON.
 *
 * Critical rules embedded in the prompt:
 *   1. ONLY items from the item table go into "items". Never address, phone,
 *      GSTIN, bill number, date, time, table number, token number, or totals.
 *   2. Tax lines (CGST, SGST, subtotal, grand total) go into "totals".
 *   3. Missing values must be null — never invented.
 *   4. All monetary values must be in PAISE (integer, × 100).
 */
const SYSTEM_PROMPT = `You are a receipt-parsing assistant. Analyse the receipt image and return ONLY a valid JSON object — no markdown, no explanation, no code blocks.

CRITICAL RULES:
1. The "items" array must contain ONLY food/product line items from the item table.
   NEVER put these into "items": restaurant name, address, phone number, GSTIN, FSSAI, 
   bill number, invoice number, date, time, order type, table number, token number,
   subtotal, tax amounts, CGST, SGST, grand total, service charge, discount, "thank you".
2. Multi-line item names (e.g. "Paneer\\nButter\\nMasala" across 3 lines) must be joined 
   into one item name: "Paneer Butter Masala".
3. ALL monetary values must be in PAISE (integer paise = rupees × 100). Example: ₹149 = 14900.
4. Missing or unreadable fields must be null — NEVER invented or guessed.
5. quantity × unitPriceMinor must equal lineTotalMinor (within 1 paise rounding tolerance).

Return exactly this JSON structure:
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
      "name": "item name as printed",
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

Tax type values: "cgst", "sgst", "igst", "gst", "vat", "service_charge", "packing", "delivery", "other".
If grand total is not visible in the image, set grandTotalMinor to null.`

// ─── Raw model response shape ─────────────────────────────────────────────────

interface RawOllamaResponse {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeMinor(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v) || v < 0) return 0
  return Math.round(v)
}

function safeNullMinor(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (v < 0) return null
  return Math.round(v)
}

function safeStr(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

const VALID_TAX_TYPES: TaxType[] = [
  'cgst', 'sgst', 'igst', 'gst', 'vat',
  'service_charge', 'packing', 'delivery', 'other',
]

function coerceTaxType(raw: string | null | undefined): TaxType {
  if (!raw) return 'other'
  const norm = raw.toLowerCase().trim().replace(/[\s-]/g, '_')
  return (VALID_TAX_TYPES as string[]).includes(norm)
    ? (norm as TaxType)
    : 'other'
}

/** High confidence for model-extracted items — model has already parsed structure. */
const HIGH_CONF: ItemFieldConfidence = {
  name:      0.90,
  quantity:  0.90,
  unitPrice: 0.90,
  lineTotal: 0.90,
}

/** Lower confidence when we had to repair a value. */
const MEDIUM_CONF: ItemFieldConfidence = {
  name:      0.75,
  quantity:  0.75,
  unitPrice: 0.75,
  lineTotal: 0.75,
}

/**
 * Extract a JSON object from the model response string.
 * Handles: pure JSON, markdown code fences, leading/trailing text.
 */
function extractJson(raw: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(raw)
  } catch {
    /* fall through */
  }

  // Strip markdown code fence: ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
  }

  // Find the outermost { ... } block
  const first = raw.indexOf('{')
  const last  = raw.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)) } catch { /* fall through */ }
  }

  throw new ReceiptVisionError(
    'extraction_failed',
    'Model response did not contain valid JSON.',
  )
}

/**
 * Convert the raw Ollama JSON response into a typed ReceiptExtraction.
 * Validates all fields and uses safe defaults for missing/invalid values.
 */
function parseOllamaResponse(raw: unknown): ReceiptExtraction {
  const r = raw as RawOllamaResponse

  // ── Merchant ──────────────────────────────────────────────────────────────
  const merchant: MerchantInfo = {
    name:    safeStr(r.merchant?.name),
    address: safeStr(r.merchant?.address),
    phone:   safeStr(r.merchant?.phone),
    gstin:   safeStr(r.merchant?.gstin),
    fssai:   safeStr(r.merchant?.fssai),
  }

  // ── Bill metadata ──────────────────────────────────────────────────────────
  const bill: BillMetadata = {
    number:      safeStr(r.bill?.number),
    date:        validateDate(safeStr(r.bill?.date)),
    time:        safeStr(r.bill?.time),
    orderType:   safeStr(r.bill?.orderType),
    tableNumber: safeStr(r.bill?.tableNumber),
    tokenNumber: safeStr(r.bill?.tokenNumber),
    cashier:     safeStr(r.bill?.cashier),
  }

  // ── Items ──────────────────────────────────────────────────────────────────
  const items: ReceiptItem[] = []
  for (const raw of (r.items ?? [])) {
    const name = safeStr(raw.name)
    if (!name) continue  // skip empty names

    const quantity      = (Number.isFinite(raw.quantity) && raw.quantity! > 0)
      ? Math.round(raw.quantity!)
      : 1
    const unitPriceMinor = safeMinor(raw.unitPriceMinor)
    const lineTotalMinor = safeMinor(raw.lineTotalMinor)

    // Repair lineTotalMinor if it's 0 but unitPrice and qty are valid
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

  // ── Taxes ──────────────────────────────────────────────────────────────────
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

  // ── Totals ─────────────────────────────────────────────────────────────────
  const serviceChargeMinor = safeMinor(r.totals?.serviceChargeMinor)
  const discountMinor      = safeMinor(r.totals?.discountMinor)
  const roundOffMinor      = Math.round(r.totals?.roundOffMinor ?? 0)
  const subtotalMinor      = safeNullMinor(r.totals?.subtotalMinor)
  const grandTotalMinor    = safeNullMinor(r.totals?.grandTotalMinor)

  // ── Overall confidence ─────────────────────────────────────────────────────
  // Ollama models generally produce high-quality structured output.
  // Lower confidence if we have items but no grand total.
  const overallConfidence = items.length > 0 && grandTotalMinor !== null
    ? 0.88
    : items.length > 0
      ? 0.72
      : 0.40

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
    provider: 'ollama',
  }
}

function validateDate(s: string | null): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

// ─── Availability check ───────────────────────────────────────────────────────

/**
 * Check whether the Ollama server is reachable and the configured model is
 * available.  Returns false (never throws) so the caller can gracefully fall
 * back to Tesseract.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const baseUrl = getOllamaBaseUrl()
  // If the env var is absent, Ollama is not configured — skip immediately.
  if (!baseUrl) return false

  const model = getOllamaModel()

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5_000)

    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (!res.ok) return false

    const data = await res.json() as { models?: Array<{ name: string }> }
    const models = data.models ?? []

    // Accept if the model name appears as a prefix in any listed model
    // e.g. "llava" matches "llava:7b", "llava:13b", etc.
    return models.some((m) => m.name === model || m.name.startsWith(model + ':'))
  } catch {
    return false
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class OllamaReceiptProvider implements ReceiptVisionProvider {
  readonly name = 'ollama'

  async extractReceipt(
    imageBase64: string,
    mimeType:    string,
  ): Promise<ReceiptExtraction> {
    const baseUrl = getOllamaBaseUrl()
    const model   = getOllamaModel()

    // Guard: OLLAMA_BASE_URL must be set — no localhost default in any environment.
    if (!baseUrl) {
      throw new ReceiptVisionError(
        'provider_unavailable',
        'Ollama is not configured. Set OLLAMA_BASE_URL in your environment ' +
        '(e.g. http://localhost:11434 for native, http://host.docker.internal:11434 inside Docker).',
      )
    }

    // Normalize MIME for Ollama (it prefers image/jpeg over image/jpg)
    const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType

    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)

    let responseText: string
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          system: SYSTEM_PROMPT,
          prompt: 'Parse this receipt image and return the structured JSON.',
          images: [imageBase64],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.0,   // deterministic — no creative guessing
            num_predict: 2048,  // enough tokens for a full receipt
          },
        }),
      })
      clearTimeout(timer)

      if (res.status === 404) {
        throw new ReceiptVisionError(
          'provider_unavailable',
          `Ollama model "${model}" not found. Run: ollama pull ${model}`,
        )
      }
      if (!res.ok) {
        throw new ReceiptVisionError(
          'provider_unavailable',
          `Ollama returned HTTP ${res.status}.`,
        )
      }

      const data = await res.json() as { response?: string; error?: string }

      if (data.error) {
        throw new ReceiptVisionError(
          'extraction_failed',
          `Ollama error: ${data.error}`,
        )
      }

      responseText = data.response ?? ''
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof ReceiptVisionError) throw err

      const msg = err instanceof Error ? err.message : String(err)

      if (
        msg.includes('fetch failed') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('AbortError') ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        throw new ReceiptVisionError(
          msg.includes('AbortError') ? 'timeout' : 'provider_unavailable',
          msg.includes('AbortError')
            ? `Ollama did not respond within ${OLLAMA_TIMEOUT_MS / 1000}s.`
            : `Ollama is not reachable at ${baseUrl}. Is Ollama running?`,
          err,
        )
      }

      throw new ReceiptVisionError('extraction_failed', msg, err)
    }

    if (!responseText.trim()) {
      throw new ReceiptVisionError(
        'extraction_failed',
        'Ollama returned an empty response.',
      )
    }

    let parsed: unknown
    try {
      parsed = extractJson(responseText)
    } catch {
      throw new ReceiptVisionError(
        'extraction_failed',
        'Ollama response could not be parsed as JSON.',
      )
    }

    try {
      return parseOllamaResponse(parsed)
    } catch (err) {
      if (err instanceof ReceiptVisionError) throw err
      throw new ReceiptVisionError(
        'extraction_failed',
        'Failed to interpret Ollama receipt output.',
        err,
      )
    }
  }
}
