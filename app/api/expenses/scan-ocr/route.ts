/**
 * POST /api/expenses/scan-ocr
 *
 * OCR-only endpoint — NO database writes.
 *
 * Accepts a multipart/form-data upload with one image file (field name: "image").
 * Runs OCR on the image and returns the parsed transaction fields.
 *
 * The image sent here should be a client-side resized version (max ~1600 px on
 * the longest side) to minimise upload time and OCR latency. The original file
 * is never sent here — it is only sent to /api/expenses/scan-upload at save
 * time so it can be persisted as permanent Transaction Proof.
 *
 * Returns:
 *   { parsed, parseOk, parseMsg }
 *
 * OCR priority order:
 *   1. Google Cloud Vision API  — set GOOGLE_VISION_API_KEY in .env.local
 *   2. tesseract.js             — always available, works offline (fallback)
 *
 * Security:
 *   - userId is always taken from the authenticated session, never req.body.
 *   - File MIME type and extension are validated server-side.
 *   - OCR text is NEVER logged to prevent leaking financial data.
 *   - rawText is NOT included in the HTTP response.
 *   - Max file size: 4 MB (OCR images are pre-shrunk on the client).
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import { parseTransactionText } from '@/lib/transactionParser'

// ─── Config ───────────────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const ALLOWED_EXT  = new Set(['.png', '.jpg', '.jpeg', '.webp'])
/** 4 MB — OCR images are pre-shrunk client-side so 8 MB is not needed here. */
const MAX_BYTES    = 4 * 1024 * 1024

/** Abort the OCR request if it takes longer than this. */
const OCR_TIMEOUT_MS = 25_000

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth — always required, even for OCR-only
    await requireAuth()

    // ── Parse multipart ───────────────────────────────────────────────────────
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json(
        { error: 'Invalid request — expected multipart/form-data.' },
        { status: 400 }
      )
    }

    const imageEntry = formData.get('image')
    if (!imageEntry || typeof imageEntry === 'string') {
      return Response.json(
        { error: 'No image file provided. Use field name "image".' },
        { status: 400 }
      )
    }

    const file = imageEntry as File

    // ── Validate MIME ─────────────────────────────────────────────────────────
    const mimeType = file.type.toLowerCase()
    if (!ALLOWED_MIME.has(mimeType)) {
      return Response.json(
        { error: `Unsupported file type: ${mimeType}. Use PNG, JPG, or WEBP.` },
        { status: 415 }
      )
    }

    // ── Validate extension ────────────────────────────────────────────────────
    const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) {
      return Response.json(
        { error: `Unsupported file extension: ${ext}.` },
        { status: 415 }
      )
    }

    // ── Validate size ─────────────────────────────────────────────────────────
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 4 MB.` },
        { status: 413 }
      )
    }
    if (file.size === 0) {
      return Response.json({ error: 'The uploaded file is empty.' }, { status: 400 })
    }

    // ── Read image bytes ──────────────────────────────────────────────────────
    const buffer  = Buffer.from(await file.arrayBuffer())
    const base64  = buffer.toString('base64')

    // ── OCR with timeout ──────────────────────────────────────────────────────
    const ocrResult = await Promise.race([
      extractTextFromImage(buffer, base64),
      timeout(OCR_TIMEOUT_MS),
    ])

    // ── Parse transaction ─────────────────────────────────────────────────────
    let parseResult
    if (ocrResult.type === 'error') {
      parseResult = { ok: false, parsed: undefined, message: ocrResult.message }
    } else {
      parseResult = parseTransactionText(ocrResult.text)
    }

    return Response.json(
      {
        parsed:   parseResult.parsed ?? null,
        parseOk:  parseResult.ok,
        parseMsg: parseResult.message ?? null,
        // rawText intentionally NOT returned — never expose financial OCR text.
      },
      { status: 200 }
    )
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (error.message === 'OCR_TIMEOUT') {
        return Response.json(
          {
            error:    'Transaction reading took too long.',
            timeout:  true,
            parsed:   null,
            parseOk:  false,
            parseMsg: 'Transaction reading took too long.',
          },
          { status: 504 }
        )
      }
    }
    console.error('[scan-ocr POST]', error instanceof Error ? error.message : String(error))
    return Response.json(
      { error: 'Transaction reading is temporarily unavailable.' },
      { status: 500 }
    )
  }
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('OCR_TIMEOUT')), ms)
  )
}

// ─── OCR result types ─────────────────────────────────────────────────────────

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

// ─── OCR orchestrator ─────────────────────────────────────────────────────────

async function extractTextFromImage(
  imageBuffer: Buffer,
  base64: string,
): Promise<OcrResult> {
  const googleApiKey = process.env.GOOGLE_VISION_API_KEY
  if (googleApiKey) {
    const result = await runGoogleVision(base64, googleApiKey)
    if (result.type === 'success') return result
    // Fall through to tesseract on Vision failure
  }
  return runTesseract(imageBuffer)
}

// ─── Google Cloud Vision ──────────────────────────────────────────────────────

async function runGoogleVision(base64: string, apiKey: string): Promise<OcrResult> {
  try {
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image:    { content: base64 },
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          }],
        }),
      }
    )

    if (!res.ok) {
      return { type: 'error', message: 'Transaction reading is temporarily unavailable.' }
    }

    const data = await res.json() as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string }
        error?: { message?: string }
      }>
    }

    if (data.responses?.[0]?.error) {
      return { type: 'error', message: 'Transaction reading is temporarily unavailable.' }
    }

    const text = data.responses?.[0]?.fullTextAnnotation?.text
    if (!text || text.trim().length === 0) {
      return { type: 'error', message: 'No readable transaction text was found.' }
    }

    return { type: 'success', text, engine: 'google_vision' }
  } catch {
    return { type: 'error', message: 'Transaction reading is temporarily unavailable.' }
  }
}

// ─── tesseract.js ─────────────────────────────────────────────────────────────

async function runTesseract(
  imageBuffer: Buffer,
): Promise<OcrResult> {
  if (!imageBuffer || imageBuffer.length < 100) {
    return { type: 'error', message: "This image couldn't be opened." }
  }

  try {
    const { createWorker } = await import('tesseract.js')

    const worker = await createWorker('eng', 1, {
      logger:       () => {},
      errorHandler: () => {},
    })

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as unknown as Tesseract.PSM,
      })

      const { data } = await worker.recognize(imageBuffer)
      const text = data.text ?? ''

      if (!text || text.trim().length < 3) {
        return { type: 'error', message: 'No readable transaction text was found.' }
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
      return { type: 'error', message: "This image couldn't be opened." }
    }
    return { type: 'error', message: 'Transaction reading is temporarily unavailable.' }
  }
}
