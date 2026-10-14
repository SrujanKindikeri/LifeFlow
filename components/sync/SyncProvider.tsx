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
 * 4. On unmount, call teardownSyncEngine() to remove event listeners.
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
  const initialised = useRef(false)

  useEffect(() => {
    if (initialised.current) return
    initialised.current = true

    async function init() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
        if (!res.ok) return  // 401 → session expired; proxy will redirect

        const data = await res.json()
        const userId: string | undefined = data?.user?.userId ?? data?.userId

        if (!userId) return

        // Register the userId so account-scope checks can verify it
        const userSwitched = setActiveUser(userId)
        if (userSwitched) {
          // Different user logged in — the engine will handle cleanup
          console.debug('[SyncProvider] Account switch detected')
        }

        initSyncEngine(userId)
      } catch {
        // Network offline — engine will init on next online event
      }
    }

    void init()

    return () => {
      teardownSyncEngine()
      initialised.current = false
    }
  }, [])

  return <>{children}</>
}
