/**
 * lib/ocr/index.ts — Provider-neutral OCR / transaction reader abstraction.
 *
 * The application calls transactionReader.extract(buffer, mimeType, filename).
 * The actual OCR provider is selected at runtime via OCR_PROVIDER:
 *
 *   auto          — try Google Vision first; fall back to Tesseract (default)
 *   google_vision — Google Cloud Vision API only (GOOGLE_VISION_API_KEY required)
 *   tesseract     — Tesseract.js only (no external API, works offline)
 *
 * Adding a new OCR provider:
 *   1. Create lib/ocr/<provider>.provider.ts implementing OcrProvider
 *   2. Register it in getOcrService() below
 *
 * Application code must only import getOcrService() / OcrResult from here —
 * never import tesseract.js or Google Vision SDK directly in route handlers.
 */

export interface OcrSuccess {
  ok: true
  text: string
  /** Which OCR engine produced this result */
  engine: 'google_vision' | 'tesseract' | string
}

export interface OcrFailure {
  ok: false
  /** User-safe error message (no secrets, no raw text) */
  message: string
}

export type OcrResult = OcrSuccess | OcrFailure

export interface OcrProvider {
  /**
   * Extract text from an image buffer.
   *
   * @param buffer    — raw image bytes
   * @param mimeType  — MIME type (e.g. 'image/jpeg')
   * @param filename  — original filename (for logging context only)
   */
  extract(buffer: Buffer, mimeType: string, filename: string): Promise<OcrResult>
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _instance: OcrProvider | null = null

export async function getOcrService(): Promise<OcrProvider> {
  if (_instance) return _instance

  const provider = (process.env.OCR_PROVIDER ?? 'auto').toLowerCase()

  switch (provider) {
    case 'google_vision': {
      const { GoogleVisionProvider } = await import('./google-vision.provider')
      _instance = new GoogleVisionProvider()
      break
    }
    case 'tesseract': {
      const { TesseractProvider } = await import('./tesseract.provider')
      _instance = new TesseractProvider()
      break
    }
    case 'auto':
    default: {
      const { AutoOcrProvider } = await import('./auto.provider')
      _instance = new AutoOcrProvider()
      break
    }
  }

  return _instance
}

/** Reset singleton (used in tests) */
export function resetOcrService(): void {
  _instance = null
}
