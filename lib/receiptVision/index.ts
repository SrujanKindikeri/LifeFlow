/**
 * lib/receiptVision/index.ts
 *
 * Provider factory for the context-aware receipt scanner.
 *
 * Three-tier provider selection (each tier falls through on failure):
 *
 *   Tier 1 — External AI Vision API      (if GROUP_BILL_AI_* env vars are set)
 *   Tier 2 — Ollama local vision model   (if OLLAMA_BASE_URL is set and reachable)
 *   Tier 3 — Tesseract.js + HOCR parser  (always available — zero config)
 *
 * The factory tries each tier in order. A tier is skipped when:
 *   - Its configuration env vars are absent/blank (Tier 1, Tier 2).
 *   - An availability check fails (Tier 2: Ollama TCP check).
 *
 * All three providers return the same ReceiptExtraction type, so the scan
 * route does not need to know which provider was used.
 *
 * Security:
 *   - GROUP_BILL_AI_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL are server-side only.
 *   - They are NEVER returned to the client or logged.
 *   - The API key is read by the AiReceiptProvider at call time and never
 *     stored in any exported value.
 */

import { AiReceiptProvider, isAiProviderConfigured } from './aiProvider.provider'
import { OllamaReceiptProvider, isOllamaAvailable } from './ollama.provider'
import { TesseractReceiptProvider } from './tesseract.provider'
import type { ReceiptVisionProvider } from './types'

// Re-export everything consumers need
export * from './types'
export * from './validator'
export * from './reconciler'
export * from './imagePreprocessor'
export * from './server-preprocess'
export { TesseractReceiptProvider }
export { OllamaReceiptProvider, isOllamaAvailable }
export { AiReceiptProvider, isAiProviderConfigured }
export { runTesseract, runTesseractHocr, RECOVERY_PSM, RECOVERY_OEM } from './tesseract.provider'

// ─── Provider names ────────────────────────────────────────────────────────────

export const PROVIDER_NAMES = {
  AI:        'ai',
  OLLAMA:    'ollama',
  TESSERACT: 'tesseract',
} as const

// ─── Provider factory ──────────────────────────────────────────────────────────

export interface ProviderSelection {
  provider:           ReceiptVisionProvider
  /** Short name for the response payload — never includes config details. */
  name:               string
  /**
   * Human-readable message shown to the user when a higher-priority tier was
   * bypassed and a fallback was used instead.
   * null when the preferred / only available provider was used directly.
   */
  fallbackMessage:    string | null
}

/**
 * Get the best available receipt vision provider.
 *
 * Selection order:
 *   1. AI Vision API  — used when GROUP_BILL_AI_API_KEY, GROUP_BILL_AI_MODEL,
 *                       and GROUP_BILL_AI_BASE_URL are all non-empty.
 *   2. Ollama         — used when OLLAMA_BASE_URL is set and the server responds
 *                       with the configured model available (5-second probe).
 *   3. Tesseract      — always available, no configuration required.
 *
 * Returns a ProviderSelection so the scan route can:
 *   - Call the provider without knowing its implementation.
 *   - Surface a human-readable fallbackMessage to the user when appropriate.
 *   - Report the provider tier name without exposing config secrets.
 */
export async function getReceiptVisionProvider(): Promise<ProviderSelection> {
  // ── Tier 1: AI Vision API ──────────────────────────────────────────────────
  if (isAiProviderConfigured()) {
    return {
      provider:        new AiReceiptProvider(),
      name:            PROVIDER_NAMES.AI,
      fallbackMessage: null,
    }
  }

  // Tier 1 is not configured — log once per request so operators know which
  // path is active. Safe: does NOT print the key value.
  console.info(
    '[receiptVision] Group Bill AI provider not configured ' +
    '(GROUP_BILL_AI_API_KEY / MODEL / BASE_URL missing or blank); ' +
    'using OCR fallback.',
  )

  // ── Tier 2: Ollama (local self-hosted vision model) ────────────────────────
  //
  // OLLAMA_BASE_URL must be set explicitly — never default to localhost so the
  // same code works identically inside Docker containers and on remote hosts.
  // Set OLLAMA_BASE_URL=http://host.docker.internal:11434  when Ollama runs on
  // the Docker host machine, or http://<container-name>:11434 when it runs in
  // a sibling container.
  const ollamaConfigured = !!process.env.OLLAMA_BASE_URL

  if (ollamaConfigured) {
    try {
      const available = await isOllamaAvailable()
      if (available) {
        return {
          provider:        new OllamaReceiptProvider(),
          name:            PROVIDER_NAMES.OLLAMA,
          fallbackMessage: null,
        }
      }
      // Ollama URL was set but the probe failed — note in log, fall through.
      console.warn(
        '[receiptVision] OLLAMA_BASE_URL is set but Ollama is not reachable ' +
        'or the configured model is unavailable; falling through to Tesseract.',
      )
    } catch {
      // isOllamaAvailable never throws, but be defensive
    }
  }

  // ── Tier 3: Tesseract (always available) ───────────────────────────────────
  return {
    provider:        new TesseractReceiptProvider(),
    name:            PROVIDER_NAMES.TESSERACT,
    // The scan route will decide whether to surface a fallback message to the
    // user based on whether a higher tier was configured at all.
    fallbackMessage: null,
  }
}

/**
 * Get the Tesseract provider directly, bypassing the tier check.
 * Used for recovery passes when the primary provider already ran.
 */
export function getTesseractProvider(): TesseractReceiptProvider {
  return new TesseractReceiptProvider()
}
