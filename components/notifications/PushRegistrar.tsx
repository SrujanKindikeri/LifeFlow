'use client'

/**
 * components/notifications/PushRegistrar.tsx
 *
 * Registers /sw.js (static file in /public) as the LifeFlow service worker.
 * Handles the full SW lifecycle: install, update detection, and the safe
 * update flow (show prompt → user confirms → send SKIP_WAITING → reload).
 *
 * CHANGES FROM PREVIOUS VERSION
 * ──────────────────────────────
 * • Registers /public/sw.js (static path) instead of the webpack Worker bundle
 *   (lib/service-worker.js). The static path is more reliable across browsers,
 *   does not require webpack Worker plugin support, and is required for proper
 *   app-shell caching (webpack Workers cannot intercept navigation fetches).
 * • Listens for SW updatefound events and notifies the user via toast.
 * • Sends SKIP_WAITING after user-initiated update confirmation.
 * • Listens for BACKGROUND_SYNC_READY messages from the SW to trigger the
 *   sync engine (progressive enhancement only — not required for correctness).
 *
 * SECURITY
 * ────────
 * • Does NOT request Notification.permission automatically.
 * • Does NOT subscribe to push automatically.
 * • Does NOT store any user data.
 * • Does NOT run if the browser doesn't support service workers.
 */

import { useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'
import { triggerSync } from '@/lib/sync/engine'

export function PushRegistrar() {
  const { info } = useToast()
  const updateReadyRef = useRef<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    let mounted = true

    async function register() {
      try {
        // Register the static service worker from /public/sw.js
        // This allows the SW to control navigation requests for app-shell caching.
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope:          '/',
          updateViaCache: 'none',
        })

        if (!mounted) return

        // Trigger an update check so users always get the latest SW quickly.
        registration.update().catch(() => undefined)

        // ── Update detection ─────────────────────────────────────────────
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // A new SW version is installed and waiting.
              // Store the registration so the user can trigger the update.
              updateReadyRef.current = registration

              // Notify the user non-intrusively via a toast.
              info('LifeFlow update ready — refresh to apply.')
            }
          })
        })

        // ── BACKGROUND_SYNC_READY message from SW ────────────────────────
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (!event.data) return
          if (event.data.type === 'BACKGROUND_SYNC_READY') {
            // SW signalled that a background sync should run.
            // Delegate to the sync engine (not the SW) for correctness.
            void triggerSync()
          }
        })

      } catch (err) {
        // SW registration failures are non-fatal. The app works without it.
        if (process.env.NODE_ENV === 'development') {
          console.debug('[PushRegistrar] SW registration failed:', err)
        }
      }
    }

    void register()

    return () => {
      mounted = false
    }
  }, [info])

  // Nothing rendered — side-effect only.
  return null
}

/**
 * Call this when the user explicitly requests applying the pending SW update.
 * Sends SKIP_WAITING to the waiting SW, then reloads the page once the new
 * SW has activated and claimed the client.
 *
 * Export so the SyncStatusBar "Update available" button can call it.
 */
export function applyPendingUpdate(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting
  if (!waiting) return

  // Reload the page once the new SW activates
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  }, { once: true })

  waiting.postMessage({ type: 'SKIP_WAITING' })
}
