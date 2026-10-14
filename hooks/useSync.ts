'use client'

/**
 * hooks/useSync.ts — React hook for sync state and operations.
 *
 * Wraps the lib/sync/engine module in a React-friendly interface.
 * Components use this hook to:
 *  - Read the current sync state (online, pending count, last sync time, etc.)
 *  - Trigger a manual sync
 *  - React to sync state changes in real time
 *
 * USAGE
 * ─────
 *   const { state, triggerSync } = useSync()
 *   // state.online, state.pendingCount, state.phase, state.lastSyncedAt, ...
 *
 * INITIALISATION
 * ──────────────
 * The SyncProvider (in app/app/layout.tsx) calls initSyncEngine(userId) once
 * after the user's identity is confirmed. This hook reads the state stream
 * that the engine emits.
 *
 * ACCOUNT SCOPE
 * ─────────────
 * The hook is account-neutral — it shows whatever the engine reports.
 * Account switching (userId change) is handled by SyncProvider which
 * re-initialises the engine with the new userId.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  subscribeSyncState,
  getSyncState,
  triggerSync as engineTriggerSync,
} from '@/lib/sync/engine'
import type { SyncState } from '@/types/sync'

export interface UseSyncReturn {
  /** Current sync state snapshot */
  state: SyncState
  /** Manually trigger a sync cycle */
  triggerSync: () => Promise<void>
}

export function useSync(): UseSyncReturn {
  const [state, setState] = useState<SyncState>(() => getSyncState())

  useEffect(() => {
    // Subscribe to engine state updates
    const unsub = subscribeSyncState((newState) => {
      setState(newState)
    })
    return unsub
  }, [])

  const triggerSync = useCallback(async () => {
    await engineTriggerSync()
  }, [])

  return { state, triggerSync }
}

/**
 * Lightweight hook that returns only the pending count.
 * Use this in components that only show the badge number.
 */
export function usePendingCount(): number {
  const { state } = useSync()
  return state.pendingCount
}

/**
 * Lightweight hook that returns only the online/offline status.
 */
export function useIsOnline(): boolean {
  const { state } = useSync()
  return state.online
}
