/**
 * lib/receiptVision/imagePreprocessor.ts
 *
 * Server-side image validation and preprocessing for the receipt scanner.
 *
 * Responsibilities:
 *   - Validate image format, size, and basic quality.
 *   - Convert the image buffer to base64 for the vision API.
 *   - Enforce hard limits that protect against oversized payloads.
 *
 * What this module does NOT do (handled client-side in BillScannerModal):
 *   - Resize / scale down (canvas-based, runs in the browser before upload)
 *   - Perspective correction / deskew (requires heavy CV libs not worth
 *     bundling server-side — modern vision models handle skew well)
 *
 * Note on image enhancement:
 *   GPT-4o and Gemini 1.5 have strong built-in image understanding and
 *   handle typical receipt conditions (slight blur, rotation, shadows)
 *   reliably.  Heavy server-side preprocessing (contrast, sharpening) only
 *   adds latency without meaningful accuracy gains for these models.
 *   The client resize (max 2000px) is the only preprocessing step needed.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

export const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
])

/** Hard server-side limit. Client resizes to ~500–700 KB before upload. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024  // 10 MB

/** Minimum size — empty or nearly-empty files are rejected immediately. */
export const MIN_FILE_BYTES = 1024  // 1 KB

// ─── Validation result ────────────────────────────────────────────────────────

export interface ImageValidationResult {
  ok:      boolean
  /** Human-readable rejection reason. null when ok=true. */
  reason:  string | null
  /** HTTP status code to return on rejection. */
  status:  number
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validate an uploaded image File (from FormData).
 * Returns immediately on first failure.
 */
export function validateImageFile(file: File): ImageValidationResult {
  const mimeType = file.type.toLowerCase()

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      ok:     false,
      reason: `Unsupported file type: ${mimeType}. Please use PNG, JPG, or WEBP.`,
      status: 415,
    }
  }

  const raw    = file.name.split('.').pop() ?? ''
  const ext    = ('.' + raw).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok:     false,
      reason: `Unsupported file extension: ${ext}. Please use .png, .jpg, or .webp.`,
      status: 415,
    }
  }

  if (file.size === 0) {
    return {
      ok:     false,
      reason: 'The uploaded image is empty.',
      status: 400,
    }
  }

  if (file.size < MIN_FILE_BYTES) {
    return {
      ok:     false,
      reason: 'The uploaded image is too small to be a valid receipt photo.',
      status: 400,
    }
  }

  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return {
      ok:     false,
      reason: `Image too large (${mb} MB). Maximum is 10 MB. Please use a smaller image.`,
      status: 413,
    }
  }

  return { ok: true, reason: null, status: 200 }
}

/**
 * Convert an ArrayBuffer / Buffer to a base64 string suitable for vision APIs.
 * This is the only transformation done server-side.
 */
export function toBase64(buffer: Buffer | ArrayBuffer): string {
  const buf = buffer instanceof Buffer
    ? buffer
    : Buffer.from(new Uint8Array(buffer))
  return buf.toString('base64')
}

/**
 * Prepare an image file for submission to the vision API.
 * Returns base64 string and normalised MIME type.
 *
 * Throws a plain Error with a user-friendly message on failure.
 */
export async function prepareImageForVision(file: File): Promise<{
  base64:   string
  mimeType: string
}> {
  const validation = validateImageFile(file)
  if (!validation.ok) {
    throw Object.assign(new Error(validation.reason!), { status: validation.status })
  }

  const arrayBuffer = await file.arrayBuffer()
  const base64      = toBase64(arrayBuffer)
  const mimeType    = file.type.toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : file.type.toLowerCase()

  return { base64, mimeType }
}
