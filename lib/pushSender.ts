/**
 * lib/pushSender.ts — Server-side Web Push delivery utility.
 *
 * Sends push notifications to all registered devices for a given user
 * (or a specific list of subscriptions).  Uses the `web-push` package
 * with VAPID authentication.
 *
 * USAGE
 * ─────
 *   import { sendPushToUser } from '@/lib/pushSender'
 *
 *   await sendPushToUser(userId, {
 *     title: 'Tomorrow: 3 tasks scheduled',
 *     body:  '• Complete report\n• Submit application\n• Team meeting',
 *     url:   '/app/tasks',
 *     tag:   'TASK_TOMORROW',
 *   })
 *
 * VAPID CONFIGURATION
 * ───────────────────
 * Reads from environment variables:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — the public VAPID key (also used by the browser)
 *   VAPID_PRIVATE_KEY             — the private VAPID key (server-only, never logged)
 *   VAPID_SUBJECT                 — mailto: or https: URI identifying the sender
 *
 * If VAPID keys are not configured, push is silently skipped and the function
 * returns immediately.  This means in-app + email notifications still work
 * even without push keys configured.
 *
 * STALE SUBSCRIPTION CLEANUP
 * ──────────────────────────
 * When the push provider returns 404 or 410 (gone / expired), the subscription
 * is permanently invalid and is deleted from MongoDB automatically.
 *
 * PRIVACY
 * ───────
 * Payload bodies must contain only non-sensitive summaries — they can appear
 * on device lock screens.  Never include financial amounts, task descriptions,
 * tokens, or any PII in push payloads.
 */

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import PushSubscription from '@/models/PushSubscription'
import logger from '@/lib/logger'

// ─── Payload type ─────────────────────────────────────────────────────────────

export interface PushPayload {
  /** Notification title — keep under ~50 chars for reliable OS display. */
  title: string
  /** Notification body — keep under ~100 chars; avoid sensitive data. */
  body: string
  /**
   * Relative path to open when the notification is clicked.
   * The service worker resolves this against the app origin.
   * Example: '/app/tasks'  '/app/notifications'
   */
  url?: string
  /**
   * Notification tag — groups notifications so only the latest with the same
   * tag is shown.  Use the notification type as the tag.
   * Example: 'TASK_TOMORROW'  'DAILY_SUMMARY'
   */
  tag?: string
}

// ─── VAPID initialisation (singleton) ────────────────────────────────────────

let vapidInitialised = false

function ensureVapid(): boolean {
  if (vapidInitialised) return true

  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
  const subject    = process.env.VAPID_SUBJECT
    ?? `mailto:${process.env.EMAIL_FROM ?? 'noreply@lifeflow.app'}`

  if (!publicKey || !privateKey) {
    // Push is disabled — missing VAPID keys.  Callers will skip push.
    return false
  }

  try {
    // Dynamic import so web-push is only loaded server-side and is not
    // bundled into client chunks.
    const webpush = require('web-push') // eslint-disable-line @typescript-eslint/no-require-imports
    webpush.setVapidDetails(subject, publicKey, privateKey)
    vapidInitialised = true
    return true
  } catch (err) {
    logger.error('[pushSender] Failed to initialise VAPID', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// Reset initialisation state (needed when env vars change between requests in dev).
export function resetVapidInit(): void {
  vapidInitialised = false
}

// ─── Core sender ──────────────────────────────────────────────────────────────

/**
 * Result for a single subscription delivery attempt.
 */
interface SendResult {
  endpoint: string   // first 60 chars only — avoid logging full endpoints
  ok: boolean
  statusCode?: number
  removed?: boolean  // true if subscription was deleted (stale)
}

/**
 * Send a push notification to all registered subscriptions for a given user.
 *
 * Returns a summary of delivery results.  Never throws — failures are logged
 * and returned but do not abort the caller.
 *
 * @param userId  MongoDB ObjectId string of the target user.
 * @param payload Notification content.
 */
export async function sendPushToUser(
  userId: string | mongoose.Types.ObjectId,
  payload: PushPayload
): Promise<{ sent: number; failed: number; removed: number }> {
  const summary = { sent: 0, failed: 0, removed: 0 }

  if (!ensureVapid()) {
    // VAPID not configured — push silently disabled.
    return summary
  }

  try {
    await connectDB()
    const subs = await PushSubscription.find({ userId }).lean()

    if (subs.length === 0) return summary

    const webpush = require('web-push') // eslint-disable-line @typescript-eslint/no-require-imports

    const payloadString = JSON.stringify({
      title: payload.title,
      body:  payload.body,
      url:   payload.url ?? '/app/notifications',
      tag:   payload.tag ?? 'lifeflow-general',
    })

    const results: SendResult[] = await Promise.all(
      subs.map(async (sub): Promise<SendResult> => {
        const shortEndpoint = sub.endpoint.slice(0, 60)
        try {
          await webpush.sendNotification(
            {
              endpoint:       sub.endpoint,
              expirationTime: sub.expirationTime ?? null,
              keys: {
                p256dh: sub.keys.p256dh,
                auth:   sub.keys.auth,
              },
            },
            payloadString
          )
          return { endpoint: shortEndpoint, ok: true }
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode
          const isGone     = statusCode === 410 || statusCode === 404

          if (isGone) {
            // Stale subscription — remove it so we don't keep trying.
            await PushSubscription.deleteOne({ _id: sub._id }).catch(() => undefined)
            logger.info('[pushSender] Removed stale subscription', {
              userId: userId.toString(),
              statusCode,
            })
            return { endpoint: shortEndpoint, ok: false, statusCode, removed: true }
          }

          logger.warn('[pushSender] Delivery failed for subscription', {
            userId:       userId.toString(),
            statusCode,
            errorMessage: err instanceof Error ? err.message : String(err),
          })
          return { endpoint: shortEndpoint, ok: false, statusCode }
        }
      })
    )

    for (const r of results) {
      if (r.ok)      summary.sent++
      else if (r.removed) summary.removed++
      else           summary.failed++
    }

    logger.info('[pushSender] Push delivery complete', {
      userId:  userId.toString(),
      tag:     payload.tag,
      ...summary,
    })
  } catch (err) {
    logger.error('[pushSender] Unexpected error', {
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }

  return summary
}

/**
 * Convenience: check whether push is available (VAPID keys configured).
 * Use this to skip push-related work when keys are not set.
 */
export function isPushConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  )
}
