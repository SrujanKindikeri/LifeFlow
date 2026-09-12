'use client'

/**
 * components/notifications/PushRegistrar.tsx
 *
 * Silently registers the LifeFlow service worker once when the authenticated
 * app shell mounts.  Renders nothing — purely a side-effect component.
 *
 * WHAT IT DOES
 * ────────────
 * 1. Registers lib/service-worker.js using Next.js's recommended Worker URL
 *    pattern so webpack bundles it correctly for both dev and production.
 * 2. Does NOT prompt for permission — permission is requested only when the
 *    user explicitly clicks "Enable" in the Profile → Notifications section.
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * - Does not request Notification.permission automatically.
 * - Does not subscribe to push automatically.
 * - Does not store any user data.
 * - Does not run if the browser doesn't support service workers.
 *
 * PLACEMENT
 * ─────────
 * Rendered inside app/app/layout.tsx so it runs once for the entire
 * authenticated app shell, not on every page navigation.
 */

import { useEffect } from 'react'

export function PushRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    let mounted = true

    async function register() {
      try {
        // Next.js docs pattern: new URL resolves the path relative to this
        // module and webpack emits the worker as a separate chunk.
        const registration = await navigator.serviceWorker.register(
          new URL('../../lib/service-worker.js', import.meta.url),
          {
            scope:          '/',
            updateViaCache: 'none',
          }
        )

        if (!mounted) return

        // Trigger an update check in the background so users always get the
        // latest service worker without a hard refresh.
        registration.update().catch(() => undefined)

      } catch (err) {
        // Service worker registration failures are non-fatal.
        // The app continues to work — push notifications just won't be available.
        // We log only in development to avoid noise in production.
        if (process.env.NODE_ENV === 'development') {
          console.debug('[PushRegistrar] Service worker registration failed:', err)
        }
      }
    }

    void register()

    return () => {
      mounted = false
    }
  }, [])

  // Renders nothing — this is a side-effect-only component.
  return null
}
