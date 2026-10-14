'use client'

/**
 * InactivityMonitor — client-side session-expiry guard for LifeFlow.
 *
 * STRATEGY
 * ────────────────────────────────────────────────────────────────────────────
 * The SERVER is the source of truth.  This component is a UX aid only:
 * it gives the user immediate feedback (redirect + toast) when the browser
 * detects expiry, rather than waiting for the next page navigation to
 * get a 401 from the server.  The server's requireAuth() still enforces both
 * the idle timeout AND the absolute 24-hour deadline independently — even if
 * this component is bypassed.
 *
 * TWO EXPIRY DEADLINES
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Inactivity deadline — resets on real user interaction (DOM events).
 *    Controlled by SESSION_IDLE_TIMEOUT_MINUTES on the server.
 * 2. Absolute deadline — fixed 24 hours from login; NEVER resets.
 *    Controlled by SESSION_ABSOLUTE_TIMEOUT_HOURS on the server.
 *
 * The client timer fires at whichever deadline comes first (msUntilExpiry).
 * The server reports both deadlines in /api/auth/session-status and this
 * component stores the absolute deadline timestamp in a ref so that activity
 * events cannot accidentally extend it.
 *
 * WARNING
 * ────────────────────────────────────────────────────────────────────────────
 * A warning toast is shown WARNING_BEFORE_EXPIRY_MS (5 minutes) before the
 * absolute deadline.  The warning is a UX courtesy; the server will reject
 * the session regardless of whether the toast was seen.
 *
 * ACTIVITY EVENTS
 * ────────────────────────────────────────────────────────────────────────────
 * Meaningful user interaction: pointermove, pointerdown, keydown, touchstart,
 * scroll.  These reset the INACTIVITY timer only — they never touch the
 * absolute deadline.  Becoming visible (visibilitychange) triggers a server
 * sync but does not by itself reset the local inactivity timer.
 *
 * FLOW
 * ────────────────────────────────────────────────────────────────────────────
 * 1. On mount, fetch GET /api/auth/session-status to get deadlines.
 * 2. Set a local countdown timer to the earlier of the two deadlines.
 * 3. User activity resets the INACTIVITY timer only (not absolute).
 * 4. When the timer fires, check the server once more to confirm expiry
 *    (avoids false-positive logout if activity happened in another tab).
 * 5. If the server confirms expiry, call POST /api/auth/logout, clear local
 *    state, show toast, redirect to /login?reason=session_expired.
 * 6. If the server says the session is still active, re-sync and continue.
 *
 * BACKGROUND TABS / SLEEPING DEVICES
 * ────────────────────────────────────────────────────────────────────────────
 * setTimeout is unreliable in background tabs (browsers throttle it) and
 * after device sleep.  On every visibilitychange to 'visible' this component
 * re-syncs with the server to get the real remaining time, including a check
 * against the absolute deadline.  This handles the "laptop woke up" case.
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
 * - Activity events reset only the inactivity timer; the absolute deadline is
 *   immutable once received from the server.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * How often the client syncs with the server while the tab is idle and visible.
 * Used to detect activity from other tabs while this one is idle.
 */
const SERVER_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Grace buffer: fire the local timer this many ms BEFORE the server would
 * expire the session.  Gives the logout call time to complete before the
 * server rejects the next request.
 */
const EXPIRY_GRACE_MS = 10_000 // 10 seconds

/**
 * Show a warning toast this many ms before the absolute session deadline.
 * The warning is UX-only; the server enforces the deadline regardless.
 */
const WARNING_BEFORE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

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
  active:                 boolean
  reason?:                string
  idleTimeoutMs?:         number
  /** ms remaining before the inactivity deadline */
  msUntilIdleExpiry?:     number | null
  /** ms remaining before the absolute 24-hour deadline */
  msUntilAbsoluteExpiry?: number | null
  /** min(msUntilIdleExpiry, msUntilAbsoluteExpiry) — used for the primary timer */
  msUntilExpiry?:         number | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InactivityMonitor() {
  const router      = useRouter()
  const { warning } = useToast()

  // ── Stable refs (never cause re-renders) ────────────────────────────────────
  const logoutTimerRef        = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const warningTimerRef       = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const syncIntervalRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const visibilityCleanupRef  = useRef<(() => void) | null>(null)
  const loggingOutRef         = useRef(false)
  const mountedRef            = useRef(true)
  const warningShownRef       = useRef(false)

  /**
   * The absolute deadline as a wall-clock timestamp (Date.now() + msUntilAbsoluteExpiry).
   * Set once on mount from the server response and NEVER updated by activity.
   * Null means no absolute deadline is configured.
   */
  const absoluteDeadlineRef   = useRef<number | null>(null)

  /**
   * The server-reported idle timeout in ms — used by activity handlers to
   * reset the inactivity countdown without closing over a stale value.
   */
  const idleTimeoutRef        = useRef<number>(60 * 60 * 1000)

  // ── Logout ──────────────────────────────────────────────────────────────────
  const performLogout = useCallback(async (reason: 'inactivity' | 'absolute' = 'inactivity') => {
    if (loggingOutRef.current || !mountedRef.current) return
    loggingOutRef.current = true

    // Stop all timers before the async logout so nothing else fires
    if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    visibilityCleanupRef.current?.()

    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // Network error — proceed anyway; the server rejects the stale cookie
    }

    if (!mountedRef.current) return

    if (reason === 'absolute') {
      warning('Your session has expired after 24 hours. Please log in again.')
    } else {
      warning('Your session expired due to inactivity. Please log in again.')
    }
    router.push('/login?reason=session_expired')
    router.refresh()
  }, [router, warning])

  // ── Warning before absolute deadline ────────────────────────────────────────
  const scheduleAbsoluteWarning = useCallback((msUntilDeadline: number) => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    warningShownRef.current = false

    const msUntilWarning = msUntilDeadline - WARNING_BEFORE_EXPIRY_MS
    if (msUntilWarning <= 0) {
      // Already within the warning window — show immediately if not shown yet
      if (!warningShownRef.current) {
        warningShownRef.current = true
        warning(
          `Your session will expire in ${Math.ceil(msUntilDeadline / 60_000)} minute(s). ` +
          `Please save your work and log in again soon.`
        )
      }
      return
    }

    warningTimerRef.current = setTimeout(() => {
      if (!loggingOutRef.current && mountedRef.current && !warningShownRef.current) {
        warningShownRef.current = true
        // Re-read the real remaining time from the absolute deadline ref
        const now = Date.now()
        const absoluteDeadline = absoluteDeadlineRef.current
        const remaining = absoluteDeadline ? Math.max(0, absoluteDeadline - now) : 0
        const remainMins = Math.ceil(remaining / 60_000)
        warning(
          `Your session will expire in ${remainMins} minute(s). ` +
          `Please save your work and log in again soon.`
        )
      }
    }, msUntilWarning)
  }, [warning])

  // ── Schedule / reschedule the logout countdown timer ────────────────────────
  const scheduleLogoutTimer = useCallback(
    (delayMs: number, syncFn: () => void) => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current)

      if (delayMs <= 0) {
        syncFn()
        return
      }

      logoutTimerRef.current = setTimeout(syncFn, delayMs)
    },
    [],
  )

  // ── Server sync: re-read remaining time and reschedule ──────────────────────
  const syncWithServerRef = useRef<() => Promise<void>>(async () => { /* populated below */ })

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
          // Determine logout reason for the toast message
          const isAbsolute =
            absoluteDeadlineRef.current !== null &&
            Date.now() >= absoluteDeadlineRef.current
          await performLogout(isAbsolute ? 'absolute' : 'inactivity')
          return
        }

        // Both timeouts disabled — cancel all local timers
        if (data.idleTimeoutMs === 0 && !data.msUntilAbsoluteExpiry) {
          if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
          if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
          return
        }

        // Update the absolute deadline from the server (immutable after first set,
        // but re-sync keeps it accurate across background tab resumes).
        if (data.msUntilAbsoluteExpiry != null) {
          const newDeadline = Date.now() + data.msUntilAbsoluteExpiry
          // Only update if not yet set, or if the server reports it's actually
          // earlier (guards against a theoretically impossible clock drift issue).
          if (
            absoluteDeadlineRef.current === null ||
            newDeadline < absoluteDeadlineRef.current
          ) {
            absoluteDeadlineRef.current = newDeadline
          }
          // Re-schedule the absolute warning
          scheduleAbsoluteWarning(data.msUntilAbsoluteExpiry)
        }

        // Update idle timeout ref so activity handlers stay correct
        if (data.idleTimeoutMs) idleTimeoutRef.current = data.idleTimeoutMs

        // Schedule the next logout-check timer based on the earliest deadline
        const msRemaining = data.msUntilExpiry ?? data.msUntilIdleExpiry ?? data.idleTimeoutMs ?? 0
        scheduleLogoutTimer(
          Math.max(0, msRemaining - EXPIRY_GRACE_MS),
          () => { void syncWithServerRef.current() },
        )
      } catch {
        // Transient network error — keep existing timer, do not log out
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performLogout, scheduleLogoutTimer, scheduleAbsoluteWarning])

  // ── Activity handler — reset inactivity timer (NOT the absolute deadline) ───
  const handleActivity = useCallback(() => {
    if (loggingOutRef.current) return

    // Absolute deadline: compute remaining time directly from the stored wall-clock ref
    const now = Date.now()
    const absoluteDeadline = absoluteDeadlineRef.current
    const msUntilAbsolute  = absoluteDeadline != null ? absoluteDeadline - now : Infinity

    // Inactivity deadline reset
    const msUntilIdle = idleTimeoutRef.current - EXPIRY_GRACE_MS

    // Fire at whichever comes first
    const msUntilNext = Math.min(msUntilIdle, msUntilAbsolute - EXPIRY_GRACE_MS)

    scheduleLogoutTimer(
      Math.max(0, msUntilNext),
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
          const isAbsolute =
            absoluteDeadlineRef.current !== null &&
            Date.now() >= absoluteDeadlineRef.current
          await performLogout(isAbsolute ? 'absolute' : 'inactivity')
          return
        }

        // Both timeouts disabled — nothing to monitor
        if (!data.idleTimeoutMs && !data.msUntilAbsoluteExpiry) return

        // Store the absolute deadline as a wall-clock timestamp (immutable)
        if (data.msUntilAbsoluteExpiry != null) {
          absoluteDeadlineRef.current = Date.now() + data.msUntilAbsoluteExpiry
          scheduleAbsoluteWarning(data.msUntilAbsoluteExpiry)
        }

        if (data.idleTimeoutMs) idleTimeoutRef.current = data.idleTimeoutMs

        // Start the local countdown at the earliest of the two deadlines
        const msRemaining = data.msUntilExpiry ?? data.msUntilIdleExpiry ?? data.idleTimeoutMs ?? 0
        scheduleLogoutTimer(
          Math.max(0, msRemaining - EXPIRY_GRACE_MS),
          () => { void syncWithServerRef.current() },
        )

        // Periodic server sync while tab is visible (catches activity in other tabs
        // and guards against throttled timers in background tabs)
        syncIntervalRef.current = setInterval(() => {
          if (document.visibilityState === 'visible') {
            void syncWithServerRef.current()
          }
        }, SERVER_SYNC_INTERVAL_MS)

        // Re-sync when this tab comes back to the foreground.
        // This is critical for sleeping-device / background-tab accuracy:
        // setTimeout is throttled by browsers when the tab is hidden, so the
        // timer may fire late. Re-syncing on visibility ensures we always check
        // the REAL remaining time — including the absolute deadline — the moment
        // the user switches back to the app.
        const handleVisibility = () => {
          if (document.visibilityState === 'visible') {
            // If we're already past the absolute deadline, log out immediately
            // without waiting for a server round-trip.
            const absoluteDeadline = absoluteDeadlineRef.current
            if (absoluteDeadline !== null && Date.now() >= absoluteDeadline) {
              void performLogout('absolute')
              return
            }
            void syncWithServerRef.current()
          }
        }
        document.addEventListener('visibilitychange', handleVisibility)
        visibilityCleanupRef.current = () =>
          document.removeEventListener('visibilitychange', handleVisibility)

        // Attach user-activity listeners (inactivity reset only)
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
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
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
