'use client'

/**
 * components/sync/SyncProvider.tsx
 *
 * Initialises the sync engine after confirming the authenticated user's
 * identity from the server session. Tears down the engine on unmount/logout.
 *
 * FLOW
 * ────
 * 1. Fetch /api/auth/me on mount to get the server-confirmed userId.
 * 2. Call setActiveUser(userId) — records it in sessionStorage for
 *    account-scope checks.
 * 3. Call initSyncEngine(userId) — starts listening for online/offline events
 *    and schedules the first sync cycle.
 * 4. If the page loads while offline, retry the identity fetch every time the
 *    browser reports it is back online — without this, the engine would never
 *    start after an offline-first page load.
 * 5. On unmount, call teardownSyncEngine() to remove event listeners.
 *
 * SECURITY
 * ────────
 * The userId comes from the server session (/api/auth/me), not from localStorage
 * or any client-generated value. If the session is expired, /api/auth/me returns
 * 401 and we skip init (the proxy middleware will redirect to /login on next nav).
 */

import { useEffect, useRef } from 'react'
import { initSyncEngine, teardownSyncEngine } from '@/lib/sync/engine'
import { setActiveUser } from '@/lib/sync/account-guard'

export function SyncProvider({ children }: { children: React.ReactNode }) {
  // Set to true once initSyncEngine has been successfully called so we never
  // call it twice for the same session.
  const engineStarted = useRef(false)

  useEffect(() => {
    /**
     * Attempt to fetch the server-verified identity and start the engine.
     * Returns true if the engine was successfully started, false otherwise.
     */
    async function tryInit(): Promise<boolean> {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' })

        // 401 → session expired; the middleware will redirect to /login on the
        // next navigation. Don't retry automatically.
        if (res.status === 401) return true   // permanent — stop retrying

        if (!res.ok) return false   // transient server error — may retry

        const data = await res.json()

        // /api/auth/me returns { user: { _id, publicId, name, … } }.
        // BUG HISTORY: this previously read data?.user?.userId which is
        // undefined (the field is _id), silently skipping initSyncEngine and
        // leaving every offline write permanently stuck in the outbox.
        const userId: string | undefined =
          data?.user?._id ?? data?.user?.userId ?? data?.userId

        if (!userId) return false   // unexpected shape — retry after reconnect

        if (!engineStarted.current) {
          engineStarted.current = true

          // Register the userId so account-scope checks can verify it
          const userSwitched = setActiveUser(userId)
          if (userSwitched) {
            // Different user logged in on the same device — the engine handles
            // any necessary local data wipe.
            console.debug('[SyncProvider] Account switch detected')
          }

          initSyncEngine(userId)
        }
        return true
      } catch {
        // Network fetch failed — browser is offline or the server is unreachable.
        // Return false so the online listener will retry.
        return false
      }
    }

    // ── Initial attempt ────────────────────────────────────────────────────────
    void tryInit()

    // ── Retry on reconnection ──────────────────────────────────────────────────
    // If the page loaded while offline, tryInit() returned false. We listen for
    // the 'online' event and retry — the sync engine itself also fires a sync
    // cycle on 'online', but only after it has been initialised. Without this
    // retry the engine would never start from an offline-first page load.
    function handleOnline() {
      if (!engineStarted.current) {
        void tryInit()
      }
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
      teardownSyncEngine()
      engineStarted.current = false
    }
  }, [])

  return <>{children}</>
}
