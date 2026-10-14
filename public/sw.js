/**
 * public/sw.js — LifeFlow service worker (app-shell + push notifications).
 *
 * SERVES TWO PURPOSES
 * ───────────────────
 * 1. APP SHELL CACHING — cache versioned static assets and the minimum HTML
 *    shell needed to reopen LifeFlow offline. Cache-first for static assets,
 *    network-first with offline fallback for navigation requests.
 *
 * 2. PUSH NOTIFICATIONS — receive and display web push notifications from
 *    the LifeFlow server (same logic as the previous lib/service-worker.js
 *    webpack Worker bundle, now consolidated here).
 *
 * SECURITY CONSTRAINTS
 * ─────────────────────
 * • NEVER cache authenticated API responses (/api/*).
 * • NEVER cache responses that vary by user (/app/* HTML pages that
 *   may include session-specific data).
 * • Cache only static assets: JS chunks, CSS, fonts, icons, images.
 * • User data lives exclusively in IndexedDB (Dexie) — not in cache storage.
 * • Cache names are versioned so a new deployment cleanly replaces the old one.
 *
 * UPDATE STRATEGY
 * ───────────────
 * On activate: delete ALL caches from previous versions, then claim clients.
 * This ensures new JS/CSS is served immediately without stale-asset bugs.
 * The PushRegistrar component sends a SKIP_WAITING message to prompt
 * an immediate update when the user confirms.
 *
 * BACKGROUND SYNC (PROGRESSIVE ENHANCEMENT)
 * ────────────────────────────────────────────
 * If the browser supports Background Sync, register 'lifeflow-sync' on
 * fetch failure. The sync engine in lib/sync/engine.ts is the authoritative
 * sync path — this is only a progressive enhancement, not a dependency.
 */

/* global self, clients, caches */

// ─── Cache versioning ─────────────────────────────────────────────────────────

/**
 * Bump CACHE_VERSION on every deployment.
 * In production this should be set to the git commit SHA or build ID.
 * The Next.js build injects NEXT_PUBLIC_BUILD_ID into the environment;
 * since service workers cannot use process.env directly, we rely on the
 * build-time replacement via a placeholder comment:
 */
const CACHE_VERSION  = 'v1'  // replaced by deployment pipeline
const SHELL_CACHE    = `lifeflow-shell-${CACHE_VERSION}`
const STATIC_CACHE   = `lifeflow-static-${CACHE_VERSION}`

// ─── App shell resources to pre-cache ────────────────────────────────────────

/**
 * Minimal offline shell — just enough to show the app skeleton.
 * Do NOT include /app/* page HTML here — those are user-specific.
 */
const SHELL_URLS = [
  '/',
  '/offline',           // dedicated offline fallback page (created below)
]

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        // Add the offline fallback page to the shell cache.
        // Other static assets (JS, CSS) are cached lazily on first fetch.
        return cache.addAll(SHELL_URLS).catch(function () {
          // Non-fatal: if the offline page doesn't exist yet, skip silently.
        })
      })
      .then(function () {
        // Do NOT call self.skipWaiting() automatically here.
        // Immediate activation could serve new JS with old HTML, causing
        // hydration errors. Instead, PushRegistrar sends SKIP_WAITING after
        // the user is shown an "Update available" prompt.
        // EXCEPTION: call skipWaiting immediately if activated from scratch
        // (no existing clients to break).
        return self.clients.matchAll({ type: 'window' })
          .then(function (windowClients) {
            if (windowClients.length === 0) {
              return self.skipWaiting()
            }
          })
      })
  )
})

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              // Delete any cache that doesn't belong to this version
              return key.startsWith('lifeflow-') &&
                key !== SHELL_CACHE &&
                key !== STATIC_CACHE
            })
            .map(function (key) { return caches.delete(key) })
        )
      })
      .then(function () {
        // Take control of all open tabs immediately.
        return self.clients.claim()
      })
  )
})

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', function (event) {
  const req = event.request
  const url = new URL(req.url)

  // Only handle same-origin GET requests
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // ── Never cache API routes ────────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) return

  // ── Static assets (Next.js build output) — cache-first ───────────────────
  // /_next/static/* are immutable (content-hashed filenames). Safe to cache
  // indefinitely. On a new build all hashes change so old entries are unused.
  if (url.pathname.startsWith('/_next/static/') ||
      url.pathname.startsWith('/icon-') ||
      url.pathname.startsWith('/badge-') ||
      url.pathname === '/favicon.ico' ||
      url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(req, STATIC_CACHE))
    return
  }

  // ── App navigation (HTML pages) — network-first with offline fallback ─────
  // We want the freshest HTML (server-rendered RSC) when online.
  // If offline, we serve the offline fallback page from the shell cache.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(req))
    return
  }

  // All other requests (fonts, images in public/) — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req, STATIC_CACHE))
})

// ─── Cache strategies ─────────────────────────────────────────────────────────

/**
 * Cache-first: return cached response immediately, or fetch + cache if missing.
 * Best for immutable assets (content-hashed filenames).
 */
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached
      return fetch(request).then(function (response) {
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    })
  })
}

/**
 * Network-first: try network, fall back to offline page on navigation failure.
 * Used for HTML navigations so the user always sees fresh server-rendered content.
 * On failure (offline), serve /offline from the shell cache.
 */
function networkFirstWithFallback(request) {
  return fetch(request)
    .catch(function () {
      return caches.open(SHELL_CACHE).then(function (cache) {
        return cache.match('/offline').then(function (fallback) {
          if (fallback) return fallback
          // Last resort: synthetic offline response
          return new Response(
            '<!DOCTYPE html><html><head><title>Offline — LifeFlow</title></head><body><h1>You\'re offline</h1><p>LifeFlow will sync when connectivity returns.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          )
        })
      })
    })
}

/**
 * Stale-while-revalidate: return cache immediately (fast), then update cache
 * in the background from the network.
 * Used for non-critical assets like images in /public/.
 */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      const fetchPromise = fetch(request).then(function (response) {
        if (response.ok) cache.put(request, response.clone())
        return response
      }).catch(function () { return cached })

      return cached || fetchPromise
    })
  })
}

// ─── Message channel — update lifecycle ──────────────────────────────────────

self.addEventListener('message', function (event) {
  if (!event.data) return

  if (event.data.type === 'SKIP_WAITING') {
    // PushRegistrar sends this after showing the user an update-available prompt.
    // Activates the new SW immediately, allowing clients.claim() to refresh tabs.
    self.skipWaiting()
    return
  }

  if (event.data.type === 'PING') {
    // Health check from PushRegistrar
    if (event.source) {
      event.source.postMessage({ type: 'PONG', version: CACHE_VERSION })
    }
    return
  }
})

// ─── Background Sync (progressive enhancement) ───────────────────────────────

self.addEventListener('sync', function (event) {
  if (event.tag === 'lifeflow-sync') {
    // Tell the active tab to run the sync engine.
    // The engine in lib/sync/engine.ts is the authoritative sync path.
    // We just signal the app to trigger a cycle.
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(function (windowClients) {
        for (const client of windowClients) {
          client.postMessage({ type: 'BACKGROUND_SYNC_READY' })
        }
      })
    )
  }
})

// ─── Push event ───────────────────────────────────────────────────────────────
// (Identical to the previous lib/service-worker.js push handling)

const APP_ORIGIN  = self.location.origin
const DEFAULT_PATH = '/app/notifications'

self.addEventListener('push', function (event) {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'LifeFlow', body: event.data.text() || 'You have a new notification.' }
  }

  const title     = payload.title ?? 'LifeFlow'
  const body      = payload.body  ?? ''
  const targetUrl = payload.url
    ? new URL(payload.url, APP_ORIGIN).href
    : APP_ORIGIN + DEFAULT_PATH

  const options = {
    body,
    icon:      APP_ORIGIN + '/icon-192.png',
    badge:     APP_ORIGIN + '/badge-96.png',
    tag:       payload.tag ?? 'lifeflow-general',
    renotify:  false,
    data:      { url: targetUrl },
    silent:    false,
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
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windowClients) {
        for (const client of windowClients) {
          if (client.url.startsWith(APP_ORIGIN) && 'focus' in client) {
            client.focus()
            client.navigate(targetUrl)
            return
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
      })
  )
})

self.addEventListener('notificationclose', function () {
  // No-op
})
