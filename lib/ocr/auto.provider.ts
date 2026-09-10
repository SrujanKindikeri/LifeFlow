/**
 * lib/ocr/auto.provider.ts — Auto-selecting OCR provider.
 *
 * Tries providers in priority order:
 *   1. Google Cloud Vision (if GOOGLE_VISION_API_KEY is set)
 *   2. Tesseract.js        (always-available fallback)
 *
 * This is the default when OCR_PROVIDER=auto (or is not set).
 */

import type { OcrProvider, OcrResult } from './index'
import { GoogleVisionProvider } from './google-vision.provider'
import { TesseractProvider }    from './tesseract.provider'

export class AutoOcrProvider implements OcrProvider {
  private googleVision: GoogleVisionProvider | null = null
  private tesseract: TesseractProvider

  constructor() {
    const googleKey = process.env.GOOGLE_VISION_API_KEY ?? process.env.OCR_API_KEY ?? ''
    if (googleKey) {
      try {
        this.googleVision = new GoogleVisionProvider()
      } catch {
        // Missing key — skip Google Vision
        this.googleVision = null
      }
    }
    this.tesseract = new TesseractProvider()
  }

  async extract(buffer: Buffer, mimeType: string, filename: string): Promise<OcrResult> {
    // Try Google Vision first if configured
    if (this.googleVision) {
      const result = await this.googleVision.extract(buffer, mimeType, filename)
      if (result.ok) return result
      // Fall through to tesseract on any Vision failure
    }

    // Fallback to Tesseract
    return this.tesseract.extract(buffer, mimeType, filename)
  }
}
