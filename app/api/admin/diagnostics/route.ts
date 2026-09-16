/**
 * GET /api/admin/diagnostics
 *
 * Safe development/admin diagnostic endpoint.
 *
 * Returns aggregate statistics about the test.users collection:
 *   - total user count
 *   - 2FA adoption: enabled count, recovery-field presence, codes-remaining counts
 *   - emailNotifications field presence and per-category opt-in counts
 *
 * SECURITY INVARIANTS — this endpoint NEVER returns:
 *   ✗  passwordHash
 *   ✗  twoFactorSecretEncrypted
 *   ✗  twoFactorRecoveryCodeHashes values (only counts are reported)
 *   ✗  emailVerificationTokenHash
 *   ✗  passwordResetTokenHash
 *   ✗  SESSION_SECRET
 *   ✗  TOTP_ENCRYPTION_KEY
 *   ✗  SMTP_PASSWORD / SMTP credentials
 *   ✗  VAPID_PRIVATE_KEY
 *   ✗  Any API key
 *
 * AUTHENTICATION
 * ──────────────
 * Protected by DIAGNOSTIC_SECRET env var (checked against Authorization: Bearer header
 * or ?secret= query param).  If DIAGNOSTIC_SECRET is not set the endpoint returns 503
 * and is therefore not accidentally accessible in production.
 *
 * AVAILABILITY
 * ────────────
 * Intended for development and one-off production health checks only.
 * Never expose this route to untrusted clients.
 *
 * IDEMPOTENT — read-only, no writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getConfiguredSecret(): string | null {
  return process.env.DIAGNOSTIC_SECRET ?? null
}

function isAuthorized(req: NextRequest): boolean {
  const secret = getConfiguredSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader === `Bearer ${secret}`) return true

  const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
  if (querySecret === secret) return true

  return false
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Secret guard ───────────────────────────────────────────────────────────
  if (!getConfiguredSecret()) {
    logger.warn('[diagnostics] DIAGNOSTIC_SECRET not configured — endpoint disabled')
    return NextResponse.json(
      {
        error: {
          code:    'SERVICE_UNAVAILABLE',
          message: 'Diagnostic endpoint is not configured. Set DIAGNOSTIC_SECRET env var.',
        },
      },
      { status: 503 }
    )
  }

  if (!isAuthorized(req)) {
    logger.warn('[diagnostics] Unauthorized access attempt', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    })
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing diagnostic secret.' } },
      { status: 401 }
    )
  }

  try {
    await connectDB()

    // ── Aggregation pipeline ──────────────────────────────────────────────
    // All operations are COUNT-only — no field values are returned, just booleans/numbers.
    // MongoDB aggregation is used so no user documents hit the application layer.
    const [result] = await User.aggregate<{
      totalUsers: number
      twoFactorEnabled: number
      recoveryFieldPresent: number
      usersWithRecoveryCodes: number
      recoveryCodeCounts: Array<{ userId: string; count: number }>  // counts only, no values
      emailNotifFieldPresent: number
      emailNotifEnabled: number
      taskRemindersEnabled: number
      habitRemindersEnabled: number
      spendingAlertsEnabled: number
      dailySummaryEnabled: number
    }>([
      {
        $group: {
          _id: null,

          // ── Total ──────────────────────────────────────────────────────
          totalUsers: { $sum: 1 },

          // ── 2FA ───────────────────────────────────────────────────────
          twoFactorEnabled: {
            $sum: { $cond: [{ $eq: ['$twoFactorEnabled', true] }, 1, 0] },
          },

          // "recovery field present" = the array field exists in the document
          recoveryFieldPresent: {
            $sum: {
              $cond: [
                { $and: [
                  { $ne: ['$twoFactorRecoveryCodeHashes', null] },
                  { $isArray: '$twoFactorRecoveryCodeHashes' },
                ]},
                1,
                0,
              ],
            },
          },

          // "users with recovery codes" = array is present AND non-empty
          usersWithRecoveryCodes: {
            $sum: {
              $cond: [
                { $and: [
                  { $isArray: '$twoFactorRecoveryCodeHashes' },
                  { $gt: [{ $size: { $ifNull: ['$twoFactorRecoveryCodeHashes', []] } }, 0] },
                ]},
                1,
                0,
              ],
            },
          },

          // ── emailNotifications ────────────────────────────────────────

          // "field present" = the emailNotifications subdocument exists
          emailNotifFieldPresent: {
            $sum: {
              $cond: [
                { $and: [
                  { $ne: ['$emailNotifications', null] },
                  { $ne: ['$emailNotifications', undefined] },
                ]},
                1,
                0,
              ],
            },
          },

          emailNotifEnabled: {
            $sum: {
              $cond: [{ $eq: ['$emailNotifications.enabled', true] }, 1, 0],
            },
          },

          taskRemindersEnabled: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$emailNotifications.enabled', true] },
                  { $eq: ['$emailNotifications.taskReminders', true] },
                ]},
                1,
                0,
              ],
            },
          },

          habitRemindersEnabled: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$emailNotifications.enabled', true] },
                  { $eq: ['$emailNotifications.habitReminders', true] },
                ]},
                1,
                0,
              ],
            },
          },

          spendingAlertsEnabled: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$emailNotifications.enabled', true] },
                  { $eq: ['$emailNotifications.spendingAlerts', true] },
                ]},
                1,
                0,
              ],
            },
          },

          dailySummaryEnabled: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$emailNotifications.enabled', true] },
                  { $eq: ['$emailNotifications.dailySummary', true] },
                ]},
                1,
                0,
              ],
            },
          },
        },
      },
    ])

    // Handle empty collection (aggregation returns nothing when there are no documents)
    const stats = result ?? {
      totalUsers:             0,
      twoFactorEnabled:       0,
      recoveryFieldPresent:   0,
      usersWithRecoveryCodes: 0,
      emailNotifFieldPresent: 0,
      emailNotifEnabled:      0,
      taskRemindersEnabled:   0,
      habitRemindersEnabled:  0,
      spendingAlertsEnabled:  0,
      dailySummaryEnabled:    0,
    }

    // ── Recovery code count distribution ────────────────────────────────────
    // Per-user count only — values (hashes) are NEVER included.
    const perUserCounts = await User.aggregate<{ userId: string; recoveryCodeCount: number }>([
      {
        $match: {
          twoFactorEnabled: true,
          twoFactorRecoveryCodeHashes: { $exists: true, $ne: [] },
        },
      },
      {
        $project: {
          _id: 0,
          // Count only — never the hash values themselves
          recoveryCodeCount: {
            $size: { $ifNull: ['$twoFactorRecoveryCodeHashes', []] },
          },
        },
      },
    ])

    // Summarise count distribution without exposing individual user IDs
    const countDistribution: Record<number, number> = {}
    for (const { recoveryCodeCount } of perUserCounts) {
      countDistribution[recoveryCodeCount] = (countDistribution[recoveryCodeCount] ?? 0) + 1
    }

    logger.info('[diagnostics] Diagnostic report generated', {
      totalUsers: stats.totalUsers,
    })

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        database:    process.env.MONGODB_DB_NAME ?? 'test',
        collection:  'users',

        users: stats.totalUsers,

        twoFactor: {
          enabled:                stats.twoFactorEnabled,
          recoveryFieldPresent:   stats.recoveryFieldPresent,
          usersWithRecoveryCodes: stats.usersWithRecoveryCodes,
          // How many users have N codes remaining (e.g. { "10": 2, "9": 1 })
          // This reveals counts, never values.
          recoveryCodeCountDistribution: countDistribution,
        },

        emailNotifications: {
          fieldPresent:    stats.emailNotifFieldPresent,
          enabled:         stats.emailNotifEnabled,
          taskReminders:   stats.taskRemindersEnabled,
          habitReminders:  stats.habitRemindersEnabled,
          spendingAlerts:  stats.spendingAlertsEnabled,
          dailySummary:    stats.dailySummaryEnabled,
        },

        // Runtime environment checks (boolean flags only — never secret values)
        environment: {
          emailProvider:        process.env.EMAIL_PROVIDER ?? 'none',
          smtpConfigured:       !!(process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS)),
          totpEncryptionKeySet: !!(process.env.TOTP_ENCRYPTION_KEY),
          sessionSecretSet:     !!(process.env.SESSION_SECRET),
          vapidConfigured:      !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
          schedulerSecretSet:   !!(process.env.SCHEDULER_SECRET ?? process.env.CRON_SECRET),
          mongodbDbName:        process.env.MONGODB_DB_NAME ?? 'test',
          appUrl:               process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          nodeEnv:              process.env.NODE_ENV ?? 'development',
        },
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[diagnostics] Fatal error', { errorMessage })

    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Diagnostic query failed. Check server logs.' } },
      { status: 500 }
    )
  }
}
