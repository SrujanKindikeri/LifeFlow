/**
 * lib/startup.ts — One-time application startup tasks.
 *
 * Import this module from the health check route or any long-lived
 * server entry point so it runs once per process instance.
 *
 * Tasks:
 *   1. Validate environment variables (via lib/env.ts)
 *   2. Ensure MongoDB indexes exist
 *
 * This runs lazily (once per process, not per request) using a module-level
 * promise so concurrent cold-starts don't double-execute.
 */

import { ensureIndexes } from '@/lib/db/indexes'
import logger from '@/lib/logger'

// Guarantee the promise runs at most once per process
let startupPromise: Promise<void> | null = null

export async function runStartup(): Promise<void> {
  if (startupPromise) return startupPromise

  startupPromise = (async () => {
    try {
      // lib/env.ts validation runs on import (side-effect)
      await import('@/lib/env')

      // Ensure all MongoDB indexes are present
      await ensureIndexes()

      logger.info('[startup] Startup tasks complete')
    } catch (err) {
      logger.error('[startup] Startup task failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      // Re-throw so callers know startup failed
      throw err
    }
  })()

  return startupPromise
}
