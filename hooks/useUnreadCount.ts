'use client'

/**
 * hooks/useUnreadCount.ts — Live unread notification count for the app shell.
 *
 * Polls GET /api/notifications?unread=true&limit=1 at a sensible interval
 * so the bell badge in AppHeader always reflects the true unread count.
 *
 * DESIGN CHOICES
 * ──────────────
 * - Polls every 60 seconds while the tab is visible.
 * - Pauses polling when the tab is hidden (visibilitychange API) to avoid
 *   unnecessary requests from background tabs.
 * - Fetches immediately on mount.
 * - Returns 0 and stops polling gracefully if the user is not authenticated
 *   (401 response).
 * - No WebSocket / SSE dependency — plain HTTP polling is sufficient for a
 *   badge count that updates once per minute.
 * - Safe to call from server components via dynamic import if needed.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_INTERVAL_MS = 60_000  // 60 seconds

export function useUnreadCount(): number {
  const [count, setCount] = useState(0)
  const intervalRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef        = useRef(true)

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?unread=true&limit=1', {
        // Use credentials (session cookie) — same-origin only.
        credentials: 'same-origin',
        // Short cache: always fresh for a badge count.
        cache: 'no-store',
      })

      // 401 = not logged in — stop polling, leave count at 0.
      if (res.status === 401) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        return
      }

      if (!res.ok) return  // transient error — keep current count, retry next tick

      const data = await res.json() as { unreadCount?: number }
      if (mountedRef.current && typeof data.unreadCount === 'number') {
        setCount(data.unreadCount)
      }
    } catch {
      // Network error — keep current count, retry next tick
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    // Fetch immediately on mount.
    void fetchCount()

    // Start the polling interval.
    intervalRef.current = setInterval(() => {
      // Only poll when the tab is visible.
      if (document.visibilityState === 'visible') {
        void fetchCount()
      }
    }, POLL_INTERVAL_MS)

    // Re-fetch when the user switches back to this tab.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchCount()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchCount])

  return count
}
