'use client'

/**
 * InactivityMonitor — client-side inactivity guard for LifeFlow.
 *
 * STRATEGY
 * ────────────────────────────────────────────────────────────────────────────
 * The SERVER is the source of truth.  This component is a UX aid only:
 * it gives the user immediate feedback (redirect + toast) when the browser
 * detects inactivity, rather than waiting for the next page navigation to
 * get a 401 from the server.  The server's requireAuth() still enforces the
 * timeout independently — even if this component is bypassed.
 *
 * ACTIVITY EVENTS
 * ────────────────────────────────────────────────────────────────────────────
 * Meaningful user interaction: pointermove, pointerdown, keydown, touchstart,
 * scroll.  Becoming visible (visibilitychange) triggers a server sync but does
 * not by itself reset the local timer — only real user input does.
 *
 * FLOW
 * ────────────────────────────────────────────────────────────────────────────
 * 1. On mount, fetch GET /api/auth/session-status to get msUntilExpiry.
 * 2. Set a local countdown timer based on that value.
 * 3. Any user activity event resets the timer to the full idle timeout.
 * 4. When the timer fires, call GET /api/auth/session-status once more to
 *    confirm expiry with the server (avoids false-positive logout if activity
 *    happened in another tab while this tab was idle).
 * 5. If the server confirms expiry, call POST /api/auth/logout, clear local
 *    state, show toast, redirect to /login?reason=session_expired.
 * 6. If the server says the session is still active (another tab was active),
 *    re-sync the countdown from the server value and continue.
 *
 * MULTIPLE TABS
 * ────────────────────────────────────────────────────────────────────────────
 * Each tab runs its own timer.  Before logging out, step 4 checks the server.
 * If another tab was active, lastActiveAt will be recent and the server returns
 * msUntilExpiry > 0 — this tab simply resets its timer rather than logging out.
 *
 * BACKGROUND POLLING
 * ────────────────────────────────────────────────────────────────────────────
 * /api/notifications polls every 60 s with skipActivityUpdate=true, so it does
 * NOT reset lastActiveAt on the server.  This component's timer is unaffected
 * by that polling because we only reset it on the DOM events listed above.
 *
 * SECURITY
 * ────────────────────────────────────────────────────────────────────────────
 * - Never logs tokens, cookies, or secrets.
 * - Logout is performed by the existing /api/auth/logout endpoint.
 * - The server destroys the session regardless of whether this component runs.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * How often the client syncs with the server while the tab is idle and visible.
 * Used to detect activity from other tabs while this one is idle.
 * Deliberately longer than the activity throttle (5 min) to avoid extra load.
 */
const SERVER_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Grace buffer: fire the local timer this many ms BEFORE the server would
 * expire the session.  Gives the logout call time to complete before the
 * server rejects the next request.
 */
const EXPIRY_GRACE_MS = 10_000 // 10 seconds

// ── DOM activity events that count as genuine user interaction ────────────────

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'pointermove',
  'pointerdown',
  'keydown',
  'touchstart',
  'scroll',
]

// ── Session status response shape ─────────────────────────────────────────────

interface SessionStatusResponse {
  active:          boolean
  reason?:         string
  idleTimeoutMs?:  number
  msUntilExpiry?:  number
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InactivityMonitor() {
  const router      = useRouter()
  const { warning } = useToast()

  // ── Stable refs (never cause re-renders) ────────────────────────────────────
  const logoutTimerRef       = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const syncIntervalRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const visibilityCleanupRef = useRef<(() => void) | null>(null)
  const loggingOutRef        = useRef(false)
  const mountedRef           = useRef(true)
  // Stores the server-reported idle timeout so activity handlers can reset to
  // the correct duration without closing over a stale value.
  const idleTimeoutRef       = useRef<number>(60 * 60 * 1000)

  // ── Logout ──────────────────────────────────────────────────────────────────
  const performLogout = useCallback(async () => {
    if (loggingOutRef.current || !mountedRef.current) return
    loggingOutRef.current = true

    // Stop all timers before the async logout so nothing else fires
    if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    visibilityCleanupRef.current?.()

    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // Network error — proceed anyway; the server rejects the stale cookie
    }

    if (!mountedRef.current) return

    warning('Your session expired due to inactivity. Please log in again.')
    router.push('/login?reason=session_expired')
    router.refresh()
  }, [router, warning])

  // ── Schedule / reschedule the logout countdown timer ────────────────────────
  const scheduleLogoutTimer = useCallback(
    (delayMs: number, syncFn: () => void) => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current)

      if (delayMs <= 0) {
        // Already at or past the deadline — confirm with server before acting
        syncFn()
        return
      }

      logoutTimerRef.current = setTimeout(syncFn, delayMs)
    },
    [],
  )

  // ── Server sync: re-read remaining time and reschedule ──────────────────────
  // Defined as a ref-based function to break the circular dependency between
  // syncWithServer → scheduleLogoutTimer → syncWithServer.
  const syncWithServerRef = useRef<() => Promise<void>>(async () => { /* populated below */ })

  // Populate it once (stable across renders via ref)
  useEffect(() => {
    syncWithServerRef.current = async () => {
      if (loggingOutRef.current || !mountedRef.current) return

      try {
        const res = await fetch('/api/auth/session-status', {
          credentials: 'same-origin',
          cache:        'no-store',
        })
        if (!res.ok || !mountedRef.current) return

        const data = (await res.json()) as SessionStatusResponse

        if (!mountedRef.current) return

        if (!data.active) {
          await performLogout()
          return
        }

        // Timeout disabled server-side — cancel all local timers
        if (data.idleTimeoutMs === 0) {
          if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
          if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
          return
        }

        // Reschedule based on the server's current remaining time
        const msRemaining = data.msUntilExpiry ?? (data.idleTimeoutMs ?? 0)
        if (data.idleTimeoutMs) idleTimeoutRef.current = data.idleTimeoutMs
        scheduleLogoutTimer(
          Math.max(0, msRemaining - EXPIRY_GRACE_MS),
          () => { void syncWithServerRef.current() },
        )
      } catch {
        // Transient network error — keep existing timer, do not log out
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performLogout, scheduleLogoutTimer])

  // ── Activity handler — reset timer on user input ────────────────────────────
  const handleActivity = useCallback(() => {
    if (loggingOutRef.current) return
    scheduleLogoutTimer(
      idleTimeoutRef.current - EXPIRY_GRACE_MS,
      () => { void syncWithServerRef.current() },
    )
  }, [scheduleLogoutTimer])

  // ── Mount lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current    = true
    loggingOutRef.current = false

    let cleanedUp = false

    async function init() {
      try {
        const res = await fetch('/api/auth/session-status', {
          credentials: 'same-origin',
          cache:        'no-store',
        })
        if (!res.ok || cleanedUp) return

        const data = (await res.json()) as SessionStatusResponse

        if (cleanedUp || !mountedRef.current) return

        if (!data.active) {
          await performLogout()
          return
        }

        // Timeout disabled — nothing to monitor
        if (!data.idleTimeoutMs) return

        idleTimeoutRef.current = data.idleTimeoutMs
        const msRemaining = data.msUntilExpiry ?? data.idleTimeoutMs

        // Start the local countdown
        scheduleLogoutTimer(
          Math.max(0, msRemaining - EXPIRY_GRACE_MS),
          () => { void syncWithServerRef.current() },
        )

        // Periodic server sync while tab is visible (catches activity in other tabs)
        syncIntervalRef.current = setInterval(() => {
          if (document.visibilityState === 'visible') {
            void syncWithServerRef.current()
          }
        }, SERVER_SYNC_INTERVAL_MS)

        // Re-sync when this tab comes back to the foreground
        const handleVisibility = () => {
          if (document.visibilityState === 'visible') {
            void syncWithServerRef.current()
          }
        }
        document.addEventListener('visibilitychange', handleVisibility)
        visibilityCleanupRef.current = () =>
          document.removeEventListener('visibilitychange', handleVisibility)

        // Attach user-activity listeners
        ACTIVITY_EVENTS.forEach((ev) => {
          document.addEventListener(ev, handleActivity, { passive: true })
        })
      } catch {
        // Network error on init — skip the monitor rather than crash the page
      }
    }

    void init()

    return () => {
      cleanedUp          = true
      mountedRef.current = false
      if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
      visibilityCleanupRef.current?.()
      ACTIVITY_EVENTS.forEach((ev) => {
        document.removeEventListener(ev, handleActivity)
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — all state is managed via stable refs

  // This component renders nothing — it's a pure side-effect provider
  return null
}
