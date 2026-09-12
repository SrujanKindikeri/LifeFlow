/**
 * lib/service-worker.js — LifeFlow Web Push service worker.
 *
 * Registered via Next.js docs pattern:
 *   navigator.serviceWorker.register(
 *     new URL('../lib/service-worker.js', import.meta.url),
 *     { scope: '/', updateViaCache: 'none' }
 *   )
 *
 * This file is bundled by Next.js webpack as a Worker chunk — it runs in a
 * separate browser Worker context, NOT in the page context.
 *
 * RESPONSIBILITIES
 * ────────────────
 * 1. Receive push events from the server and display a notification.
 * 2. Handle notification clicks — open or focus the relevant LifeFlow page.
 * 3. Handle notification close events (no-op, just for browser compliance).
 *
 * PRIVACY
 * ───────
 * Push payloads must never contain sensitive data (financial amounts, full task
 * descriptions, tokens, etc.) — they appear on lock screens.
 * Server-side senders must use concise, non-sensitive summaries.
 *
 * DEDUPLICATION
 * ─────────────
 * The service worker does NOT deduplicate — that is handled server-side via
 * NotificationLog before the push is sent at all.
 *
 * NO PRIVATE CACHING
 * ──────────────────
 * This worker does not cache any responses.  Caching authenticated API
 * responses would expose private user data to the browser cache in ways
 * that are difficult to invalidate securely.
 */

/* global self, clients */

// ─── App URL resolution ───────────────────────────────────────────────────────

/**
 * Derive the LifeFlow origin from the service worker's own location.
 * self.location.origin is always set correctly regardless of how the SW
 * is registered, so this works on localhost, EC2, Azure, and custom domains.
 */
const APP_ORIGIN = self.location.origin

// Default path to open when the user clicks a notification with no deep link.
const DEFAULT_PATH = '/app/notifications'

// ─── Push event ───────────────────────────────────────────────────────────────

self.addEventListener('push', function (event) {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    // Malformed payload — show a generic notification rather than silently failing.
    payload = {
      title: 'LifeFlow',
      body:  event.data.text() || 'You have a new notification.',
    }
  }

  const title = payload.title ?? 'LifeFlow'
  const body  = payload.body  ?? ''

  /** URL to open when notification is clicked.  Must be same-origin. */
  const targetUrl = payload.url
    ? new URL(payload.url, APP_ORIGIN).href  // resolve relative paths safely
    : APP_ORIGIN + DEFAULT_PATH

  const options = {
    body,
    // Use the LifeFlow icon from /public (served at root by Next.js).
    icon:  APP_ORIGIN + '/icon-192.png',
    badge: APP_ORIGIN + '/badge-96.png',
    // tag groups notifications of the same type — replaces the previous one
    // instead of stacking, preventing notification flooding.
    tag:   payload.tag ?? 'lifeflow-general',
    // renotify: true means the device vibrates even when replacing a tagged notif
    renotify: false,
    // Store the target URL in notification data so the click handler can open it.
    data: { url: targetUrl },
    // Silent: false — allow OS-level sound/vibration (user controls via OS settings).
    silent: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ─── Notification click ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : APP_ORIGIN + DEFAULT_PATH

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windowClients) {
        // If a LifeFlow tab is already open, focus it and navigate.
        for (const client of windowClients) {
          if (client.url.startsWith(APP_ORIGIN) && 'focus' in client) {
            client.focus()
            client.navigate(targetUrl)
            return
          }
        }
        // No existing tab — open a new one.
        if (clients.openWindow) {
          return clients.openWindow(targetUrl)
        }
      })
  )
})

// ─── Notification close ───────────────────────────────────────────────────────

self.addEventListener('notificationclose', function (_event) {
  // No action needed — the OS dismissed the notification.
  // Some analytics platforms hook here; LifeFlow does not.
})

// ─── Activate — take control immediately ─────────────────────────────────────

self.addEventListener('activate', function (event) {
  // Claim all open clients so the new SW controls them without a page reload.
  event.waitUntil(clients.claim())
})
