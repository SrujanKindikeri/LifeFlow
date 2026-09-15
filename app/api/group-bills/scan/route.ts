/**
 * POST /api/group-bills/scan
 *
 * Context-aware receipt scanner for Group Bills.
 * Accepts multipart/form-data with field name "image".
 *
 * Three-tier provider pipeline:
 *   Tier 1 — AI Vision API   (GROUP_BILL_AI_* env vars)
 *   Tier 2 — Ollama           (OLLAMA_BASE_URL env var)
 *   Tier 3 — Tesseract        (always available)
 *
 * Full pipeline per request:
 *   1.  Validate authentication
 *   2.  Validate image file (MIME, extension, size)
 *   3.  Magic-byte check on buffer
 *   4.  Primary extraction:
 *         a. Try Tier 1/2/3 provider from factory
 *         b. If Tier 1 fails with a recoverable error (unavailable / timeout /
 *            rate-limited / extraction failure), fall through to Tier 3 and
 *            attach a user-visible fallback message
 *   5.  Financial reconciliation (integer paise arithmetic)
 *   6.  Recovery pass (Tesseract PSM 3) when primary result is weak
 *   7.  Build review flags
 *   8.  Return ScanPipelineResult — NO database writes
 *
 * Response shape:
 *   {
 *     ok:              boolean
 *     message:         string | null   — review warning or fallback notice
 *     fallbackMessage: string | null   — set when AI was bypassed
 *     result:          ScanPipelineResult | null
 *     provider:        string
 *   }
 *
 * Security:
 *   - Requires authenticated session (requireAuth).
 *   - userId is sourced from the session only — never from the request body.
 *   - OCR text and image data are NEVER returned or logged.
 *   - AI/Ollama configuration (URLs, model names) is never returned to the client.
 *   - The AI API key is never logged, stored, or included in any response.
 *   - Max file size: 10 MB.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/session'
import {
  getReceiptVisionProvider,
  getTesseractProvider,
  validateImageFile,
  reconcileExtraction,
  shouldAttemptRecovery,
  pickBetterExtraction,
  buildReviewFlags,
  ReceiptVisionError,
  isValidImageBuffer,
  isAiProviderConfigured,
  RECOVERY_PSM,
  RECOVERY_OEM,
  PROVIDER_NAMES,
  type ReceiptExtraction,
  type ReconciliationResult,
  type ScanPipelineResult,
  type ScanStatus,
} from '@/lib/receiptVision'

// ─── Fallback message shown to the user when AI was bypassed ──────────────────

const AI_FALLBACK_MESSAGE =
  'AI receipt reading is unavailable. We used basic receipt scanning instead.'

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await requireAuth()

    // ── Parse multipart ───────────────────────────────────────────────────────
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json(
        { ok: false, message: 'Invalid request — expected multipart/form-data.', fallbackMessage: null, result: null, provider: null },
        { status: 400 },
      )
    }

    const imageEntry = formData.get('image')
    if (!imageEntry || typeof imageEntry === 'string') {
      return Response.json(
        { ok: false, message: 'No image provided. Use field name "image".', fallbackMessage: null, result: null, provider: null },
        { status: 400 },
      )
    }

    const file = imageEntry as File

    // ── File validation ────────────────────────────────────────────────────────
    const validation = validateImageFile(file)
    if (!validation.ok) {
      return Response.json(
        { ok: false, message: validation.reason, fallbackMessage: null, result: null, provider: null },
        { status: validation.status },
      )
    }

    // ── Buffer + magic bytes ───────────────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer())
    if (!isValidImageBuffer(buffer)) {
      return Response.json(
        { ok: false, message: 'The uploaded file does not appear to be a valid image.', fallbackMessage: null, result: null, provider: null },
        { status: 415 },
      )
    }

    // ── Primary extraction pass ────────────────────────────────────────────────
    //
    // getReceiptVisionProvider() returns whichever tier is configured and ready.
    // If the primary provider then fails at runtime with a recoverable error
    // (e.g. AI API unreachable, timeout, rate-limited), we fall through to
    // Tesseract rather than returning an error to the user.
    const { provider, name: providerName } = await getReceiptVisionProvider()

    let primaryExtraction: ReceiptExtraction
    let actualProviderName = providerName
    let fallbackMessage: string | null = null

    try {
      if ('extractFromBuffer' in provider) {
        // TesseractReceiptProvider exposes extractFromBuffer (avoids base64 round-trip)
        primaryExtraction = await (provider as {
          extractFromBuffer: (b: Buffer) => Promise<ReceiptExtraction>
        }).extractFromBuffer(buffer)
      } else {
        const mime = normaliseMime(file.type)
        const b64  = buffer.toString('base64')
        primaryExtraction = await provider.extractReceipt(b64, mime)
      }
    } catch (err) {
      // ── Decide whether to fall through or surface the error ─────────────────
      //
      // Fall through to Tesseract when:
      //   - The error is recoverable (service unavailable, timeout, rate limit,
      //     extraction failure) AND the primary provider was not Tesseract.
      //   - Image-rejected errors are NOT recoverable — the image itself is the
      //     problem; running Tesseract won't help.
      //
      // Surface the error immediately when:
      //   - The primary provider was already Tesseract (no lower tier to fall to).
      //   - The image was explicitly rejected by the provider.

      const isRecoverable =
        err instanceof ReceiptVisionError &&
        err.code !== 'image_rejected' &&
        providerName !== PROVIDER_NAMES.TESSERACT

      if (!isRecoverable) {
        return Response.json(
          {
            ok: false,
            message: ocrErrorMessage(err),
            fallbackMessage: null,
            result: null,
            provider: providerName,
          },
          { status: ocrErrorStatus(err) },
        )
      }

      // Log the tier failure at warn level — never log the image, key, or raw error body
      console.warn(
        '[group-bills/scan] Primary provider failed, falling through to Tesseract.',
        err instanceof ReceiptVisionError ? `[${err.code}]` : '[unknown]',
      )

      // Fall through: run Tesseract as the actual primary
      try {
        const tesseract = getTesseractProvider()
        primaryExtraction = await tesseract.extractFromBuffer(buffer)
        actualProviderName = PROVIDER_NAMES.TESSERACT
        // Attach fallback notice only when AI was configured — if neither AI
        // nor Ollama were set up, Tesseract is the expected path, not a fallback.
        fallbackMessage = isAiProviderConfigured() ? AI_FALLBACK_MESSAGE : null
      } catch (tessErr) {
        // Tesseract itself failed — nothing left to fall back to
        return Response.json(
          {
            ok: false,
            message: ocrErrorMessage(tessErr),
            fallbackMessage: null,
            result: null,
            provider: PROVIDER_NAMES.TESSERACT,
          },
          { status: ocrErrorStatus(tessErr) },
        )
      }
    }

    // ── Primary reconciliation ─────────────────────────────────────────────────
    let extraction = primaryExtraction
    let recon      = reconcileExtraction(primaryExtraction)
    let pass: 'primary' | 'recovery' = 'primary'

    // ── Recovery pass (Tesseract PSM 3 only) ──────────────────────────────────
    //
    // A second Tesseract pass with different segmentation always makes sense
    // as a recovery strategy regardless of which provider ran first.
    // Skip when the primary provider was already Tesseract with the recovery
    // settings to avoid an identical duplicate pass.
    if (shouldAttemptRecovery(primaryExtraction, recon)) {
      try {
        const tesseract = getTesseractProvider()
        const recoveryExtraction = await tesseract.extractFromBuffer(
          buffer,
          RECOVERY_PSM,
          RECOVERY_OEM,
        )
        const recoveryRecon = reconcileExtraction(recoveryExtraction)
        const winner = pickBetterExtraction(
          primaryExtraction, recon,
          recoveryExtraction, recoveryRecon,
        )
        if (winner === 'b') {
          extraction = recoveryExtraction
          recon      = recoveryRecon
          pass       = 'recovery'
        }
      } catch {
        // Recovery is best-effort — never crash the primary flow
      }
    }

    // ── Hard failure guard ─────────────────────────────────────────────────────
    if (extraction.items.length === 0 && extraction.grandTotalMinor === null) {
      return Response.json(
        {
          ok: false,
          message:
            'Unable to extract any items from this receipt. ' +
            'Try a clearer photo with better lighting.',
          fallbackMessage,
          result: null,
          provider: actualProviderName,
        },
        { status: 422 },
      )
    }

    // ── Build review flags ─────────────────────────────────────────────────────
    const reviewFlags = buildReviewFlags(extraction, recon)

    // ── Determine scan status ──────────────────────────────────────────────────
    const status = deriveScanStatus(extraction, recon, reviewFlags)

    // ── Build pipeline result ──────────────────────────────────────────────────
    const pipelineResult: ScanPipelineResult = {
      status,
      extraction,
      reconciliation: recon,
      pass,
      reviewMessages: buildReviewMessages(status, reviewFlags, fallbackMessage),
      reviewFlags,
    }

    // Primary user message: fallback notice takes priority over generic review
    // messages so the user knows why AI was not used.
    const userMessage =
      fallbackMessage ??
      (pipelineResult.reviewMessages.length > 0 ? pipelineResult.reviewMessages[0] : null)

    return Response.json({
      ok:              true,
      message:         userMessage,
      fallbackMessage,
      result:          pipelineResult,
      provider:        actualProviderName,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json(
        { ok: false, message: 'Unauthorized', fallbackMessage: null, result: null, provider: null },
        { status: 401 },
      )
    }
    // Log only the error type and message — never the image or API key
    console.error(
      '[group-bills/scan POST]',
      error instanceof Error ? error.message : String(error),
    )
    return Response.json(
      { ok: false, message: 'Failed to scan receipt. Please try again.', fallbackMessage: null, result: null, provider: null },
      { status: 500 },
    )
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normaliseMime(mime: string): string {
  const m = mime.toLowerCase()
  return m === 'image/jpg' ? 'image/jpeg' : m
}

function deriveScanStatus(
  e:     ReceiptExtraction,
  r:     ReconciliationResult,
  flags: string[],
): ScanStatus {
  if (e.items.length === 0)       return 'failed'
  if (e.grandTotalMinor === null) return 'grand_total_missing'

  const hasProblems =
    !r.itemsMatchLinetotals ||
    r.linetoalsSumToSubtotal === false ||
    r.totalsReconcile === false ||
    e.overallConfidence < 0.60 ||
    flags.length > 0

  return hasProblems ? 'review_required' : 'verified'
}

function buildReviewMessages(
  status:          ScanStatus,
  flags:           string[],
  fallbackMessage: string | null,
): string[] {
  const messages: string[] = []

  // Fallback notice is prepended first so it's the most visible
  if (fallbackMessage) {
    messages.push(fallbackMessage)
  }

  if (status === 'review_required' || flags.length > 0) {
    messages.push('Please review the highlighted values before continuing.')
  }
  if (status === 'grand_total_missing') {
    messages.push('Grand total could not be read from this receipt.')
  }
  return messages
}

function ocrErrorMessage(err: unknown): string {
  if (err instanceof ReceiptVisionError) {
    switch (err.code) {
      case 'timeout':
        return 'Scanning took too long. Try a smaller or clearer image.'
      case 'image_rejected':
        return 'This image could not be opened. Please try a different photo.'
      case 'provider_unavailable':
        return 'Receipt scanner is temporarily unavailable. Please try again.'
      case 'rate_limited':
        return 'Receipt scanner is busy. Please try again in a moment.'
      case 'extraction_failed':
        return err.message.length > 0
          ? err.message
          : "Couldn't read this receipt. Try a clearer photo with better lighting."
      default:
        return 'Receipt scanning failed. Please try again.'
    }
  }
  return 'Failed to scan receipt. Please try again.'
}

function ocrErrorStatus(err: unknown): number {
  if (err instanceof ReceiptVisionError) {
    switch (err.code) {
      case 'timeout':              return 504
      case 'image_rejected':       return 415
      case 'provider_unavailable': return 503
      case 'rate_limited':         return 429
      default:                     return 422
    }
  }
  return 500
}
