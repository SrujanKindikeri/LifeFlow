/**
 * lib/startup.ts — One-time application startup tasks.
 *
 * Import this module from the health check route or any long-lived
 * server entry point so it runs once per process instance.
 *
 * Tasks:
 *   1. Validate environment variables (via getServerEnv())
 *   2. Ensure MongoDB indexes exist
 *
 * This runs lazily (once per process, not per request) using a module-level
 * promise so concurrent cold-starts don't double-execute.
 */

import { getServerEnv } from '@/lib/env'
import { ensureIndexes } from '@/lib/db/indexes'
import logger from '@/lib/logger'

// Guarantee the promise runs at most once per process
let startupPromise: Promise<void> | null = null

export async function runStartup(): Promise<void> {
  if (startupPromise) return startupPromise

  startupPromise = (async () => {
    try {
      // Validate required env vars at runtime (throws clearly if any are missing)
      const env = getServerEnv()

      // Warn early if TOTP_ENCRYPTION_KEY is absent — 2FA operations will fail
      // at runtime for any user who tries to enable/use Google Authenticator.
      if (!env.TOTP_ENCRYPTION_KEY || env.TOTP_ENCRYPTION_KEY.trim() === '') {
        logger.warn(
          '[startup] TOTP_ENCRYPTION_KEY is not set. ' +
          '2FA setup and authentication will fail. ' +
          'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        )
      }

      // Warn early if SCHEDULER_SECRET is absent — the jobs endpoint will return 503
      if (!env.SCHEDULER_SECRET && !env.CRON_SECRET) {
        logger.warn(
          '[startup] SCHEDULER_SECRET / CRON_SECRET is not set. ' +
          'The subscription scheduler endpoint will return 503 until a secret is configured.'
        )
      }

      // Log SMTP configuration status — confirms email is set up without
      // ever printing the password.
      const smtpConfigured =
        env.EMAIL_PROVIDER === 'smtp' &&
        !!env.SMTP_HOST &&
        !!env.SMTP_USER &&
        !!env.SMTP_PASSWORD

      if (env.EMAIL_PROVIDER === 'smtp') {
        if (smtpConfigured) {
          logger.info('[startup] SMTP configured: yes', {
            smtpHost: env.SMTP_HOST,
            smtpPort: env.SMTP_PORT,
            // smtpUser logged for diagnostics — not a secret
            smtpUser: env.SMTP_USER,
          })
        } else {
          logger.warn(
            '[startup] SMTP configured: no — EMAIL_PROVIDER=smtp but ' +
            'SMTP_HOST, SMTP_USER, or SMTP_PASSWORD is missing. ' +
            'Email delivery will fail until all three are set.'
          )
        }
      } else {
        logger.info(`[startup] Email provider: ${env.EMAIL_PROVIDER || 'none'}`)
      }

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
