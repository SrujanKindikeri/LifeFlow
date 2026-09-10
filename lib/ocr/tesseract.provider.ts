/**
 * lib/ocr/tesseract.provider.ts — Tesseract.js OCR provider.
 *
 * Runs Tesseract WASM in the Node.js process — no external API needed.
 * Works offline, suitable for development and self-hosted deployments.
 *
 * Memory note: Tesseract.js loads a ~10MB WASM binary per invocation.
 * On memory-constrained serverless platforms (Vercel Hobby, Lambda 128MB)
 * prefer the Google Vision provider instead.
 */

import type { OcrProvider, OcrResult } from './index'
import logger from '@/lib/logger'

export class TesseractProvider implements OcrProvider {
  async extract(buffer: Buffer, _mimeType: string, _filename: string): Promise<OcrResult> {
    if (!buffer || buffer.length < 100) {
      return { ok: false, message: 'This image could not be opened.' }
    }

    try {
      // Dynamic import — only loads when this path is reached.
      // Keeps cold-start overhead minimal for requests that use Google Vision.
      const { createWorker } = await import('tesseract.js')

      const worker = await createWorker('eng', 1, {
        logger:       () => {}, // silence partial-text output
        errorHandler: () => {},
      })

      try {
        // PSM 6 = "Assume a single uniform block of text"
        // Works well for payment app screenshot layouts.
        await worker.setParameters({
          tessedit_pageseg_mode: '6' as unknown as Tesseract.PSM,
        })

        const { data } = await worker.recognize(buffer)
        const text = data.text ?? ''

        if (!text || text.trim().length < 3) {
          return {
            ok: false,
            message: "I couldn't find readable transaction text in this image.",
          }
        }

        return { ok: true, text, engine: 'tesseract' }
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
        return { ok: false, message: 'This image could not be opened.' }
      }

      logger.warn('[Tesseract] Unexpected OCR error', {
        errorType: err instanceof Error ? err.constructor.name : 'unknown',
      })
      return { ok: false, message: "Couldn't analyze the screenshot right now." }
    }
  }
}
