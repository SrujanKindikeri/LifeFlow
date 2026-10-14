'use client'

/**
 * components/sync/ClientConflictBridge.tsx
 *
 * Thin client-side bridge that reads the active userId from sessionStorage
 * and passes it to ConflictResolutionModal.
 *
 * This exists so AppLayout (Server Component) doesn't need to be converted
 * to a Client Component just to pass the userId to the modal.
 */

import { useState, useEffect } from 'react'
import { getActiveUser } from '@/lib/sync/account-guard'
import { ConflictResolutionModal } from '@/components/sync/ConflictResolutionModal'

export function _ClientConflictBridge() {
  const [clientUserId, setClientUserId] = useState<string | null>(null)

  useEffect(() => {
    // Read userId after mount (sessionStorage is browser-only)
    const uid = getActiveUser()
    setClientUserId(uid)

    // Re-check periodically in case the user logs in/out
    const interval = setInterval(() => {
      const uid2 = getActiveUser()
      setClientUserId(uid2)
    }, 5_000)

    return () => clearInterval(interval)
  }, [])

  if (!clientUserId) return null

  return <ConflictResolutionModal clientUserId={clientUserId} />
}
