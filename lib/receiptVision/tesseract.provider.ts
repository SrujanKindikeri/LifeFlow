/**
 * lib/receiptVision/tesseract.provider.ts
 *
 * Self-hosted receipt OCR provider using Tesseract.js.
 *
 * Pipeline:
 *   1. Receive image as Buffer.
 *   2. Run Tesseract with HOCR output to get word-level bounding boxes
 *      and per-word confidence scores.
 *   3. Feed HOCR XML to parseReceiptHocr() — the spatial zone-aware parser.
 *      This uses bounding-box geometry to determine WHAT each line IS
 *      (header / column header / item row / totals / footer) before
 *      extracting any values.
 *   4. Convert ParsedReceipt → ReceiptExtraction (paise units, 0-1 confidence).
 *   5. Return ReceiptExtraction.
 *
 * HOCR vs plain text:
 *   Tesseract can return either plain text (--psm 6 -c tessedit_create_hocr=1)
 *   or raw text. We request HOCR so the parser has word coordinates and
 *   per-word confidence, enabling spatial zone classification.
 *
 * Recovery pass:
 *   PSM 3 (fully automatic page segmentation) is tried when primary PSM 6
 *   extraction is incomplete. Both passes use HOCR output.
 *
 * Docker / deployment notes:
 *   tesseract.js downloads the "eng" traineddata on first use and caches
 *   it in $TESSDATA_DIR or OS temp. Mount /tmp as a Docker volume to avoid
 *   re-downloads across container restarts.
 *
 * OCR configuration:
 *   PSM 6  — single uniform block. Best for thermal receipt layouts where
 *             the receipt is captured straight-on.
 *   OEM 1  — LSTM neural network only (most accurate for modern fonts).
 *
 * Recovery:
 *   PSM 3  — fully automatic page segmentation.
 *   OEM 3  — LSTM + legacy Tesseract combined.
 */

import {
  parseReceiptHocr,
  parseReceiptText,
  checkOcrQuality,
  type ParsedReceipt,
  type ScannedItem,
} from '@/lib/receiptParser'
import type {
  ReceiptVisionProvider,
  ReceiptExtraction,
  ReceiptItem,
  TaxEntry,
  TaxType,
  ItemFieldConfidence,
  MerchantInfo,
  BillMetadata,
} from './types'
import { ReceiptVisionError } from './types'

// ─── OCR configuration ────────────────────────────────────────────────────────

const DEFAULT_PSM  = 6   // single uniform block
const DEFAULT_OEM  = 1   // LSTM only

export const RECOVERY_PSM = 3   // automatic page segmentation
export const RECOVERY_OEM = 3   // LSTM + legacy combined

const OCR_TIMEOUT_MS = 60_000

// ─── String-confidence → 0-1 score ───────────────────────────────────────────

function bucketToScore(bucket: 'high' | 'medium' | 'low'): number {
  switch (bucket) {
    case 'high':   return 0.90
    case 'medium': return 0.70
    case 'low':    return 0.38
  }
}

// ─── ParsedReceipt → ReceiptExtraction conversion ────────────────────────────

function parsedToExtraction(parsed: ParsedReceipt): ReceiptExtraction {
  // ── Items ──────────────────────────────────────────────────────────────────
  const items: ReceiptItem[] = parsed.items
    .filter((it) => it.name.trim().length > 0)
    .map((it: ScannedItem): ReceiptItem => {
      const fc: ItemFieldConfidence = {
        name:      bucketToScore(it.fieldConfidence?.name      ?? it.confidence),
        quantity:  bucketToScore(it.fieldConfidence?.quantity  ?? it.confidence),
        unitPrice: bucketToScore(it.fieldConfidence?.unitPrice ?? it.confidence),
        lineTotal: bucketToScore(it.fieldConfidence?.lineTotal ?? it.confidence),
      }
      return {
        name:           it.name,
        quantity:       it.quantity,
        unitPriceMinor: Math.round(it.unitPrice * 100),
        lineTotalMinor: Math.round(it.lineTotal * 100),
        confidence:     fc,
      }
    })

  // ── Taxes ──────────────────────────────────────────────────────────────────
  const taxes: TaxEntry[] = parsed.taxes
    .filter((t) => t.amount > 0)
    .map((t): TaxEntry => ({
      name:        t.label,
      type:        mapTaxType(t.type),
      rate:        t.rate,
      amountMinor: Math.round(t.amount * 100),
    }))

  // ── Charges ────────────────────────────────────────────────────────────────
  const serviceChargeMinor = parsed.serviceCharge != null
    ? Math.round(parsed.serviceCharge * 100)
    : 0
  const discountMinor = parsed.discount != null
    ? Math.round(parsed.discount * 100)
    : 0

  // ── Totals ─────────────────────────────────────────────────────────────────
  const subtotalMinor  = parsed.subtotal  != null ? Math.round(parsed.subtotal  * 100) : null
  const grandTotalMinor = parsed.grandTotal != null ? Math.round(parsed.grandTotal * 100) : null

  // ── Overall confidence ─────────────────────────────────────────────────────
  const overallConfidence = bucketToScore(parsed.overallConfidence)

  // ── Merchant (from metadata) ───────────────────────────────────────────────
  const merchant: MerchantInfo = {
    name:    parsed.restaurantName ?? null,
    address: null,
    phone:   null,
    gstin:   null,
    fssai:   null,
  }

  // ── Bill metadata ──────────────────────────────────────────────────────────
  const bill: BillMetadata = {
    number:      parsed.invoiceNumber ?? null,
    date:        parsed.receiptDate   ?? null,
    time:        null,
    orderType:   null,
    tableNumber: null,
    tokenNumber: null,
    cashier:     null,
  }

  return {
    merchant,
    bill,
    items,
    subtotalMinor,
    taxes,
    serviceChargeMinor,
    discountMinor,
    roundOffMinor: 0,
    grandTotalMinor,
    overallConfidence,
    provider: 'tesseract',
  }
}

function mapTaxType(
  t: 'cgst' | 'sgst' | 'igst' | 'gst' | 'service' | 'discount' | 'packing' | 'other',
): TaxType {
  switch (t) {
    case 'cgst':    return 'cgst'
    case 'sgst':    return 'sgst'
    case 'igst':    return 'igst'
    case 'gst':     return 'gst'
    case 'service': return 'service_charge'
    case 'packing': return 'packing'
    default:        return 'other'
  }
}

// ─── Tesseract OCR runner ─────────────────────────────────────────────────────

/**
 * Run Tesseract.js on the given buffer, returning HOCR XML.
 *
 * HOCR provides word-level bounding boxes and per-word confidence scores
 * which the parser uses for spatial zone classification.
 *
 * Falls back to plain text if HOCR output is empty or malformed.
 *
 * @param imageBuffer  Raw image bytes (PNG / JPEG / WEBP).
 * @param psm          Page-segmentation mode (default 6).
 * @param oem          OCR engine mode (default 1).
 */
export async function runTesseractHocr(
  imageBuffer: Buffer,
  psm: number = DEFAULT_PSM,
  oem: number = DEFAULT_OEM,
): Promise<{ hocr: string; text: string }> {
  if (!imageBuffer || imageBuffer.length < 512) {
    throw new ReceiptVisionError(
      'image_rejected',
      'The image is too small or empty to process.',
    )
  }

  try {
    const { createWorker } = await import('tesseract.js')

    const worker = await createWorker('eng', oem, {
      logger:       () => {},
      errorHandler: () => {},
    })

    let hocr = ''
    let text = ''

    try {
      await worker.setParameters({
        tessedit_pageseg_mode:   String(psm) as unknown as Tesseract.PSM,
        tessedit_create_hocr:    '1',   // enable HOCR output
        tessedit_create_tsv:     '0',   // don't need TSV
        tessedit_create_pdf:     '0',
        hocr_font_info:          '0',   // smaller HOCR output
      })

      const result = await worker.recognize(imageBuffer)
      text = result.data.text ?? ''
      hocr = (result.data as unknown as { hocr?: string }).hocr ?? ''
    } finally {
      await worker.terminate()
    }

    return { hocr, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : ''
    if (
      msg.includes('could not initialize') ||
      msg.includes('failed to load') ||
      msg.includes('invalid image') ||
      msg.includes('unsupported image') ||
      msg.includes('not enough memory')
    ) {
      throw new ReceiptVisionError(
        'image_rejected',
        'This image format could not be processed. Please try a clearer photo.',
        err,
      )
    }
    throw new ReceiptVisionError(
      'extraction_failed',
      'OCR engine encountered an error. Please try again.',
      err,
    )
  }
}

/**
 * Run Tesseract and return plain text only (no HOCR).
 * Used when a quick text quality check is needed.
 */
export async function runTesseract(
  imageBuffer: Buffer,
  psm: number = DEFAULT_PSM,
  oem: number = DEFAULT_OEM,
): Promise<string> {
  const { text } = await runTesseractHocr(imageBuffer, psm, oem)
  return text
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class TesseractReceiptProvider implements ReceiptVisionProvider {
  readonly name = 'tesseract'

  /**
   * Extract receipt data from an image using Tesseract OCR + HOCR parsing.
   *
   * The interface accepts base64 + mimeType for API provider compatibility;
   * Tesseract works on raw Buffer, so we decode base64 here.
   *
   * For internal use from the scan route, call extractFromBuffer() directly
   * to avoid the base64 round-trip.
   */
  async extractReceipt(
    imageBase64: string,
    _mimeType:   string,
  ): Promise<ReceiptExtraction> {
    const buffer = Buffer.from(imageBase64, 'base64')
    return this.extractFromBuffer(buffer)
  }

  /**
   * Extract receipt data directly from a Buffer.
   * This is the primary internal path used by the scan route.
   */
  async extractFromBuffer(
    imageBuffer: Buffer,
    psm: number = DEFAULT_PSM,
    oem: number = DEFAULT_OEM,
  ): Promise<ReceiptExtraction> {
    const timeoutId = setTimeout(() => {
      throw new ReceiptVisionError(
        'timeout',
        `Tesseract OCR timed out after ${OCR_TIMEOUT_MS / 1000}s.`,
      )
    }, OCR_TIMEOUT_MS)

    try {
      const { hocr, text } = await runTesseractHocr(imageBuffer, psm, oem)

      // Quality check on plain text
      const quality = checkOcrQuality(text)
      if (quality.tooSparse || (!quality.hasItemLines && !quality.hasTotalLine)) {
        if (text.trim().length < 20) {
          throw new ReceiptVisionError(
            'extraction_failed',
            'No readable text was found in the image. Try a clearer photo with better lighting.',
          )
        }
      }

      // Parse using HOCR if available, fall back to text
      const parsed: ParsedReceipt = (hocr && hocr.trim().length > 100)
        ? parseReceiptHocr(hocr)
        : parseReceiptText(text)

      clearTimeout(timeoutId)
      return parsedToExtraction(parsed)
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
  }
}
