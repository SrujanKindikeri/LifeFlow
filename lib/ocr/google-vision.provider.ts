/**
 * lib/ocr/google-vision.provider.ts — Google Cloud Vision OCR provider.
 *
 * Uses the Vision REST API with an API key.
 * Set GOOGLE_VISION_API_KEY (or OCR_API_KEY) to activate.
 *
 * Docs: https://cloud.google.com/vision/docs/ocr
 */

import type { OcrProvider, OcrResult } from './index'
import logger from '@/lib/logger'

export class GoogleVisionProvider implements OcrProvider {
  private apiKey: string

  constructor() {
    const key = process.env.GOOGLE_VISION_API_KEY ?? process.env.OCR_API_KEY ?? ''
    if (!key) {
      throw new Error(
        '[GoogleVision] GOOGLE_VISION_API_KEY environment variable is required'
      )
    }
    this.apiKey = key
  }

  async extract(buffer: Buffer, _mimeType: string, _filename: string): Promise<OcrResult> {
    const base64 = buffer.toString('base64')

    try {
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image:    { content: base64 },
              features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
            }],
          }),
          // Abort if Vision API takes > 20 seconds
          signal: AbortSignal.timeout(20_000),
        }
      )

      if (!res.ok) {
        logger.warn('[GoogleVision] API returned non-OK status', { status: res.status })
        return { ok: false, message: "Couldn't analyze the screenshot right now." }
      }

      const data = await res.json() as {
        responses?: Array<{
          fullTextAnnotation?: { text?: string }
          error?: { message?: string }
        }>
      }

      if (data.responses?.[0]?.error) {
        logger.warn('[GoogleVision] Vision API error in response')
        return { ok: false, message: "Couldn't analyze the screenshot right now." }
      }

      const text = data.responses?.[0]?.fullTextAnnotation?.text
      if (!text || text.trim().length === 0) {
        return { ok: false, message: "I couldn't find readable transaction text in this image." }
      }

      return { ok: true, text, engine: 'google_vision' }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        logger.warn('[GoogleVision] Request timed out')
        return { ok: false, message: "OCR request timed out. Please try again." }
      }
      logger.warn('[GoogleVision] Network or parse error', {
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
      })
      return { ok: false, message: "Couldn't analyze the screenshot right now." }
    }
  }
}
