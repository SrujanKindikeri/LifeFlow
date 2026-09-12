/**
 * POST /api/expenses/scan-upload
 *
 * Accepts a multipart/form-data upload with one image file (field name: "image").
 * Stores the image as a TransactionProof document (binary in MongoDB, owner-gated).
 * Extracts text from the image via OCR and parses transaction details.
 *
 * Returns:
 *   { fileId, filename, mimeType, sizeBytes, parsed, parseOk, parseMsg }
 *
 * OCR priority order:
 *   1. Google Cloud Vision API  — set GOOGLE_VISION_API_KEY in .env.local
 *   2. tesseract.js             — always available, works offline (fallback)
 *
 * The caller (client) presents parsed data to the user for review.
 * An expense is NOT created here — that happens only after user confirmation.
 *
 * Security:
 *   - userId is ALWAYS taken from the authenticated session, never req.body.
 *   - File MIME type and extension are validated server-side.
 *   - OCR text is NEVER logged to prevent leaking financial data.
 *   - rawText is NOT included in the HTTP response.
 *   - Max file size: 8 MB.
 */

import { NextRequest } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import TransactionProof from '@/models/TransactionProof'
import { parseTransactionText } from '@/lib/transactionParser'

// ─── Config ───────────────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const ALLOWED_EXT  = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_BYTES    = 8 * 1024 * 1024  // 8 MB

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()

    // ── Parse multipart ───────────────────────────────────────────────────────
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json({ error: 'Invalid request — expected multipart/form-data.' }, { status: 400 })
    }

    const imageEntry = formData.get('image')
    if (!imageEntry || typeof imageEntry === 'string') {
      return Response.json({ error: 'No image file provided. Use field name "image".' }, { status: 400 })
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
        { error: `Unsupported file extension: ${ext}. Use .png, .jpg, .jpeg, or .webp.` },
        { status: 415 }
      )
    }

    // ── Validate size ─────────────────────────────────────────────────────────
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 8 MB.` },
        { status: 413 }
      )
    }
    if (file.size === 0) {
      return Response.json({ error: 'The uploaded file is empty.' }, { status: 400 })
    }

    // ── Read image bytes ──────────────────────────────────────────────────────
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // ── OCR ───────────────────────────────────────────────────────────────────
    // Returns the raw extracted text, or an OcrError describing why it failed.
    const ocrResult = await extractTextFromImage(Buffer.from(buffer), base64, mimeType, file.name)

    // ── Parse transaction from extracted text ─────────────────────────────────
    let parseResult
    if (ocrResult.type === 'error') {
      parseResult = {
        ok: false,
        parsed: undefined,
        message: ocrResult.message,
      }
    } else {
      parseResult = parseTransactionText(ocrResult.text)
    }

    // ── Store proof in DB ─────────────────────────────────────────────────────
    await connectDB()

    const proof = await TransactionProof.create({
      userId,
      lifeFlowId,
      filename:  file.name,
      mimeType,
      sizeBytes: file.size,
      data:      base64,
    })

    return Response.json(
      {
        fileId:    proof._id.toString(),
        filename:  proof.filename,
        mimeType:  proof.mimeType,
        sizeBytes: proof.sizeBytes,
        parsed:    parseResult.parsed ?? null,
        parseOk:   parseResult.ok,
        parseMsg:  parseResult.message ?? null,
        // rawText intentionally NOT returned — never log or expose OCR text
        // containing UPI IDs, phone numbers, bank details, or transaction IDs.
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[scan-upload POST]', error instanceof Error ? error.message : String(error))
    return Response.json({ error: 'Failed to process screenshot.' }, { status: 500 })
  }
}

// ─── OCR result types ─────────────────────────────────────────────────────────

interface OcrSuccess {
  type: 'success'
  text: string
  /** Which OCR engine produced this result */
  engine: 'google_vision' | 'tesseract'
}

interface OcrError {
  type: 'error'
  /**
   * User-facing message — must distinguish between:
   *   A. Invalid/corrupted image       → "This image could not be opened."
   *   B. OCR service failure           → "Couldn't analyze the screenshot right now."
   *   C. OCR returned no readable text → "I couldn't find readable transaction text in this image."
   */
  message: string
}

type OcrResult = OcrSuccess | OcrError

// ─── OCR orchestrator ─────────────────────────────────────────────────────────

/**
 * Extract text from an image buffer using the best available OCR engine.
 *
 * Priority:
 *   1. Google Cloud Vision API  (set GOOGLE_VISION_API_KEY)
 *   2. tesseract.js             (always available, works offline)
 *
 * The raw buffer is passed to tesseract so it can decode the image itself
 * without any intermediate conversion that could corrupt pixel data.
 */
async function extractTextFromImage(
  imageBuffer: Buffer,
  base64: string,
  mimeType: string,
  filename: string,
): Promise<OcrResult> {
  // ── Option 1: Google Cloud Vision ─────────────────────────────────────────
  const googleApiKey = process.env.GOOGLE_VISION_API_KEY
  if (googleApiKey) {
    const result = await runGoogleVision(base64, googleApiKey)
    if (result.type === 'success') return result
    // Fall through to tesseract on Vision failure (network/quota/etc.)
  }

  // ── Option 2: tesseract.js (always-available offline fallback) ────────────
  return runTesseract(imageBuffer, mimeType, filename)
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
      // Don't surface the API key or quota details to the caller
      return { type: 'error', message: "Couldn't analyze the screenshot right now." }
    }

    const data = await res.json() as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string }
        error?: { message?: string }
      }>
    }

    const visionError = data.responses?.[0]?.error
    if (visionError) {
      return { type: 'error', message: "Couldn't analyze the screenshot right now." }
    }

    const text = data.responses?.[0]?.fullTextAnnotation?.text
    if (!text || text.trim().length === 0) {
      return { type: 'error', message: "I couldn't find readable transaction text in this image." }
    }

    return { type: 'success', text, engine: 'google_vision' }
  } catch {
    // Network or parse failure — fall through to tesseract
    return { type: 'error', message: "Couldn't analyze the screenshot right now." }
  }
}

// ─── tesseract.js ─────────────────────────────────────────────────────────────

/**
 * Run Tesseract OCR on the raw image buffer.
 *
 * We pass the Buffer directly — tesseract.js v5 accepts Buffer, Uint8Array,
 * base64 strings, or file paths. Using the Buffer avoids any re-encoding.
 *
 * Language: 'eng' covers all UPI/payment apps which use English for
 * amounts, dates, reference numbers, and status labels.
 */
async function runTesseract(
  imageBuffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<OcrResult> {
  // Validate the buffer is non-empty and has sane size before handing to OCR
  if (!imageBuffer || imageBuffer.length < 100) {
    return { type: 'error', message: 'This image could not be opened.' }
  }

  // Suppress unused-var warnings for params used for future logging/routing
  void mimeType
  void filename

  try {
    // Dynamic import so tesseract.js is only loaded when this path is reached.
    // This keeps the cold-start overhead minimal for requests that use Google Vision.
    const { createWorker } = await import('tesseract.js')

    const worker = await createWorker('eng', 1, {
      // Silence verbose tesseract logging — it can contain partial text snippets
      logger: () => {},
      errorHandler: () => {},
    })

    try {
      // PSM 6 = "Assume a single uniform block of text"
      // Works best for screenshot-style payment app layouts.
      // PSM 3 (auto) is the default but tends to miss numbers at the edges
      // of payment app screenshots.
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as unknown as Tesseract.PSM,
      })

      const { data } = await worker.recognize(imageBuffer)
      const text = data.text ?? ''

      if (!text || text.trim().length < 3) {
        return { type: 'error', message: "I couldn't find readable transaction text in this image." }
      }

      return { type: 'success', text, engine: 'tesseract' }
    } finally {
      // Always terminate the worker to free memory
      await worker.terminate()
    }
  } catch (err) {
    // Image decode failure (corrupt file, unsupported format, etc.)
    const msg = err instanceof Error ? err.message.toLowerCase() : ''
    if (
      msg.includes('could not initialize') ||
      msg.includes('failed to load') ||
      msg.includes('invalid image') ||
      msg.includes('unsupported image')
    ) {
      return { type: 'error', message: 'This image could not be opened.' }
    }
    return { type: 'error', message: "Couldn't analyze the screenshot right now." }
  }
}
