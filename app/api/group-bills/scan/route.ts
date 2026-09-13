/**
 * POST /api/group-bills/scan
 *
 * Receipt scanner for the Group Bill feature.
 * Accepts a multipart/form-data upload with one image (field name: "image").
 *
 * Pipeline:
 *   1. Validate file (MIME, extension, size)
 *   2. Run OCR  (Google Cloud Vision → Tesseract.js fallback)
 *   3. Quality-check the OCR text (is it actually a receipt?)
 *   4. Parse the text with receiptParser (items, GST, totals, reconciliation)
 *   5. Return structured result — NO database writes
 *
 * The caller MUST show a review screen before using the extracted data.
 * The Group Bill is only created after the user confirms.
 *
 * Security:
 *   - Requires authenticated session (requireAuth).
 *   - userId comes from session, never from the request body.
 *   - OCR text is NEVER returned or logged (financial data protection).
 *   - Max file size: 10 MB (receipts can be larger than UPI screenshots).
 *
 * Returns:
 *   {
 *     ok:          boolean        — false if OCR or parsing failed entirely
 *     message:     string | null  — user-facing error / warning
 *     receipt:     ParsedReceipt | null
 *     ocrEngine:   'google_vision' | 'tesseract' | null
 *   }
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { parseReceiptText, checkOcrQuality } from '@/lib/receiptParser'

// ─── Config ────────────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const ALLOWED_EXT  = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_BYTES    = 10 * 1024 * 1024  // 10 MB — receipts can be high-res photos

/** Hard ceiling on OCR wall-clock time. */
const OCR_TIMEOUT_MS = 30_000

// ─── OCR result types ───────────────────────────────────────────────────────

interface OcrSuccess {
  type: 'success'
  text: string
  engine: 'google_vision' | 'tesseract'
}
interface OcrError {
  type: 'error'
  message: string
}
type OcrResult = OcrSuccess | OcrError

// ─── POST ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await requireAuth()

    // ── Parse multipart ─────────────────────────────────────────────────────
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json(
        { ok: false, message: 'Invalid request — expected multipart/form-data.', receipt: null },
        { status: 400 }
      )
    }

    const imageEntry = formData.get('image')
    if (!imageEntry || typeof imageEntry === 'string') {
      return Response.json(
        { ok: false, message: 'No image provided. Use field name "image".', receipt: null },
        { status: 400 }
      )
    }

    const file = imageEntry as File

    // ── Validate MIME ───────────────────────────────────────────────────────
    const mimeType = file.type.toLowerCase()
    if (!ALLOWED_MIME.has(mimeType)) {
      return Response.json(
        { ok: false, message: `Unsupported file type: ${mimeType}. Use PNG, JPG, or WEBP.`, receipt: null },
        { status: 415 }
      )
    }

    // ── Validate extension ──────────────────────────────────────────────────
    const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) {
      return Response.json(
        { ok: false, message: `Unsupported file extension: ${ext}.`, receipt: null },
        { status: 415 }
      )
    }

    // ── Validate size ───────────────────────────────────────────────────────
    if (file.size > MAX_BYTES) {
      return Response.json(
        {
          ok: false,
          message: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
          receipt: null,
        },
        { status: 413 }
      )
    }
    if (file.size === 0) {
      return Response.json(
        { ok: false, message: 'The uploaded image is empty.', receipt: null },
        { status: 400 }
      )
    }

    // ── Read bytes ──────────────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')

    // ── OCR with timeout ────────────────────────────────────────────────────
    let ocrResult: OcrResult
    try {
      ocrResult = await Promise.race([
        runOcr(buffer, base64, mimeType),
        ocrTimeout(OCR_TIMEOUT_MS),
      ])
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'OCR_TIMEOUT'
      return Response.json(
        {
          ok: false,
          message: isTimeout
            ? 'Receipt scanning took too long. Try a smaller or clearer image.'
            : "Couldn't read the receipt right now. Please try again.",
          receipt: null,
          ocrEngine: null,
        },
        { status: isTimeout ? 504 : 500 }
      )
    }

    if (ocrResult.type === 'error') {
      return Response.json(
        { ok: false, message: ocrResult.message, receipt: null, ocrEngine: null },
        { status: 422 }
      )
    }

    const ocrText = ocrResult.text
    const engine  = ocrResult.engine

    // ── Quality check ───────────────────────────────────────────────────────
    const quality = checkOcrQuality(ocrText)

    if (!quality.looksLikeReceipt) {
      let msg: string
      if (quality.tooSparse) {
        msg = 'Receipt is difficult to read. Please retake the photo with better lighting.'
      } else if (!quality.hasItemLines && !quality.hasTotalLine) {
        msg = 'Unable to read this receipt. Try a clearer photo.'
      } else {
        msg = 'Some receipt information could not be read. Please review carefully.'
      }

      // Still attempt to parse — return with a warning rather than hard-fail
      const receipt = parseReceiptText(ocrText)
      const hasAnyData = receipt.items.length > 0 || receipt.grandTotal !== null
      if (!hasAnyData) {
        return Response.json(
          { ok: false, message: msg, receipt: null, ocrEngine: engine },
          { status: 422 }
        )
      }
      return Response.json({
        ok: true,
        message: msg,
        receipt,
        ocrEngine: engine,
      })
    }

    // ── Parse the receipt ───────────────────────────────────────────────────
    const receipt = parseReceiptText(ocrText)

    // Hard failure: no items AND no total found
    if (receipt.items.length === 0 && receipt.grandTotal === null) {
      return Response.json(
        {
          ok: false,
          message: 'Unable to extract items from this receipt. Try a clearer photo.',
          receipt: null,
          ocrEngine: engine,
        },
        { status: 422 }
      )
    }

    return Response.json({
      ok: true,
      message: receipt.requiresReview
        ? 'Please review the highlighted values before continuing.'
        : null,
      receipt,
      ocrEngine: engine,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ ok: false, message: 'Unauthorized', receipt: null }, { status: 401 })
    }
    console.error('[group-bills/scan POST]', error instanceof Error ? error.message : String(error))
    return Response.json(
      { ok: false, message: 'Failed to scan receipt.', receipt: null },
      { status: 500 }
    )
  }
}

// ─── OCR timeout ────────────────────────────────────────────────────────────

function ocrTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('OCR_TIMEOUT')), ms)
  )
}

// ─── OCR orchestrator ────────────────────────────────────────────────────────

async function runOcr(
  buffer: Buffer,
  base64: string,
  mimeType: string,
): Promise<OcrResult> {
  const googleApiKey = process.env.GOOGLE_VISION_API_KEY
  if (googleApiKey) {
    const result = await runGoogleVision(base64, googleApiKey, mimeType)
    if (result.type === 'success') return result
    // Fall through to Tesseract on Vision failure
  }
  return runTesseract(buffer)
}

// ─── Google Cloud Vision ─────────────────────────────────────────────────────

async function runGoogleVision(
  base64: string,
  apiKey: string,
  mimeType: string,
): Promise<OcrResult> {
  try {
    // Use DOCUMENT_TEXT_DETECTION for receipts — better at dense text layouts.
    // TEXT_DETECTION is optimised for sparse text (signs, labels).
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64 },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
              imageContext: {
                languageHints: ['en', 'hi'],  // English + Hindi for Indian receipts
              },
            },
          ],
        }),
      }
    )

    if (!res.ok) {
      return { type: 'error', message: "Couldn't scan the receipt right now. Please try again." }
    }

    const data = (await res.json()) as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string }
        error?: { message?: string }
      }>
    }

    if (data.responses?.[0]?.error) {
      return { type: 'error', message: "Couldn't scan the receipt right now. Please try again." }
    }

    const text = data.responses?.[0]?.fullTextAnnotation?.text
    if (!text || text.trim().length === 0) {
      return { type: 'error', message: "No readable text was found in the image." }
    }

    return { type: 'success', text, engine: 'google_vision' }
  } catch {
    return { type: 'error', message: "Couldn't scan the receipt right now. Please try again." }
  }
}

// ─── Tesseract.js ────────────────────────────────────────────────────────────

async function runTesseract(imageBuffer: Buffer): Promise<OcrResult> {
  if (!imageBuffer || imageBuffer.length < 100) {
    return { type: 'error', message: 'This image could not be opened.' }
  }

  try {
    const { createWorker } = await import('tesseract.js')

    const worker = await createWorker('eng', 1, {
      logger:       () => {},
      errorHandler: () => {},
    })

    try {
      // PSM 4 = "Assume a single column of text of variable sizes"
      // Works better than PSM 6 for receipts which have multiple columns.
      await worker.setParameters({
        tessedit_pageseg_mode: '4' as unknown as Tesseract.PSM,
        // Preserve more characters that receipts use
        tessedit_char_whitelist: '',
      })

      const { data } = await worker.recognize(imageBuffer)
      const text = data.text ?? ''

      if (!text || text.trim().length < 10) {
        return { type: 'error', message: 'No readable text was found in the image.' }
      }

      return { type: 'success', text, engine: 'tesseract' }
    } finally {
      await worker.terminate()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : ''
    if (
      msg.includes('could not initialize') ||
      msg.includes('failed to load') ||
      msg.includes('invalid image') ||
      msg.includes('unsupported image')
    ) {
      return { type: 'error', message: 'This image could not be opened.' }
    }
    return { type: 'error', message: "Couldn't scan the receipt right now." }
  }
}
