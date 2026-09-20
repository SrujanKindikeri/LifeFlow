'use client'

/**
 * ThemeProvider — manages Dark Mode, Night Shift, and Turn Tone state
 * for the entire LifeFlow application.
 *
 * STRATEGY
 * ────────────────────────────────────────────────────────────────────────────
 * 1. On first render (before any React hydration) an inline <script> in
 *    app/layout.tsx reads localStorage and sets data-theme / data-night-shift
 *    on <html> synchronously — this eliminates any flash of the wrong theme.
 *
 * 2. This provider then mounts, reads the same localStorage keys, and takes
 *    over the live management: system-preference media queries, Night Shift
 *    schedule timers, and exporting the context so the Profile UI can update
 *    preferences immediately.
 *
 * 3. When the user saves new preferences on the Profile page, the Profile
 *    component calls `applyAppearance()` from this context directly — the
 *    change is instant without a page reload.
 *
 * 4. All preferences are also persisted to localStorage so they survive
 *    logout/login (before the server data loads) and browser restarts.
 *    The server copy (MongoDB) is the canonical source; localStorage is the
 *    fast-load cache.
 *
 * NIGHT SHIFT
 * ────────────────────────────────────────────────────────────────────────────
 * Night Shift is evaluated every minute via setInterval. It compares the
 * current wall-clock time in the user's configured timezone against the
 * configured start/end times, correctly handling schedules that cross midnight
 * (e.g. 22:00 → 07:00). Only the data-night-shift attribute on <html> is
 * toggled — no full theme re-render.
 *
 * TURN TONE
 * ────────────────────────────────────────────────────────────────────────────
 * Audio preferences (enabled, volume) are stored in the context so any
 * component can read them without another fetch. Actual audio playback lives
 * in lib/tonePlayer.ts to keep this provider thin.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { AppearancePreferences, AppTheme } from '@/types'
import { DEFAULT_APPEARANCE } from '@/types'

// ── localStorage keys ──────────────────────────────────────────────────────

export const LS_APPEARANCE = 'lf_appearance'

// ── Context shape ──────────────────────────────────────────────────────────

export interface ThemeContextValue {
  appearance: AppearancePreferences
  /** Call this after saving to /api/auth/me to apply changes instantly. */
  applyAppearance: (next: AppearancePreferences) => void
  /**
   * Inform the provider of the user's IANA timezone once it loads from the
   * server. Used for accurate Night Shift scheduling.
   */
  setTimezone: (tz: string) => void
  /** Whether Night Shift is currently active right now. */
  nightShiftActive: boolean
}

const ThemeContext = createContext<ThemeContextValue>({
  appearance:       DEFAULT_APPEARANCE,
  applyAppearance:  () => undefined,
  setTimezone:      () => undefined,
  nightShiftActive: false,
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Read stored preferences from localStorage. Falls back to DEFAULT_APPEARANCE
 * safely on any error (SSR, storage disabled, corrupted JSON).
 */
function readStored(): AppearancePreferences {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE
  try {
    const raw = window.localStorage.getItem(LS_APPEARANCE)
    if (!raw) return DEFAULT_APPEARANCE
    const parsed = JSON.parse(raw) as Partial<AppearancePreferences>
    return { ...DEFAULT_APPEARANCE, ...parsed }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/**
 * Determine the resolved theme ('light' | 'dark') from the user's setting,
 * respecting the OS preference when theme === 'system'.
 */
function resolveTheme(theme: AppTheme): 'light' | 'dark' {
  if (theme === 'dark')  return 'dark'
  if (theme === 'light') return 'light'
  // 'system'
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/**
 * Returns the current HH:MM time string in the given IANA timezone.
 * Falls back to local time if the timezone string is invalid.
 */
function getCurrentHHMM(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
      timeZone: timezone,
    }).formatToParts(new Date())
    const h = parts.find((p) => p.type === 'hour')?.value   ?? '00'
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
    // Intl may return '24' for midnight — normalise to '00'
    return `${h === '24' ? '00' : h}:${m}`
  } catch {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
}

/**
 * Returns true if `current` falls within [start, end] in a schedule that may
 * cross midnight (e.g. 22:00 → 07:00).
 */
function isInNightShiftWindow(current: string, start: string, end: string): boolean {
  if (start === end) return false
  if (start < end) {
    // Same-day window (e.g. 02:00 → 06:00)
    return current >= start && current < end
  }
  // Cross-midnight window (e.g. 22:00 → 07:00)
  return current >= start || current < end
}

// ── DOM helpers ───────────────────────────────────────────────────────────

function applyThemeToDom(theme: AppTheme): void {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(theme)
  document.documentElement.setAttribute('data-theme', resolved)
}

function applyNightShiftToDom(active: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-night-shift', active ? 'true' : 'false')
}

// ── Provider component ────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance,      setAppearance]      = useState<AppearancePreferences>(readStored)
  const [nightShiftActive, setNightShiftActive] = useState(false)

  // Keep a stable ref so interval callback always sees current value
  const appearanceRef = useRef(appearance)
  // Track user timezone — loaded async from the server via setTimezone()
  const timezoneRef   = useRef<string>('Asia/Kolkata')

  // ── Night Shift scheduler ───────────────────────────────────────────────
  const checkNightShift = useCallback(() => {
    const pref = appearanceRef.current
    if (!pref.nightShiftEnabled) {
      setNightShiftActive(false)
      applyNightShiftToDom(false)
      return
    }
    const current = getCurrentHHMM(timezoneRef.current)
    const active  = isInNightShiftWindow(current, pref.nightShiftStart, pref.nightShiftEnd)
    setNightShiftActive(active)
    applyNightShiftToDom(active)
  }, [])

  // ── System theme media query listener ──────────────────────────────────
  useEffect(() => {
    if (appearance.theme !== 'system') return
    const mq      = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyThemeToDom('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [appearance.theme])

  // ── On mount: apply stored preferences + start Night Shift interval ──
  useEffect(() => {
    applyThemeToDom(appearance.theme)
    checkNightShift()
    const interval = setInterval(checkNightShift, 60_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount; checkNightShift uses refs

  // ── applyAppearance — called by Profile page after save ────────────────
  const applyAppearance = useCallback((next: AppearancePreferences) => {
    appearanceRef.current = next
    setAppearance(next)

    // Persist to localStorage for fast loads
    try {
      window.localStorage.setItem(LS_APPEARANCE, JSON.stringify(next))
    } catch { /* storage might be disabled */ }

    // Apply DOM attributes immediately
    applyThemeToDom(next.theme)

    // Re-evaluate Night Shift with new settings
    if (!next.nightShiftEnabled) {
      setNightShiftActive(false)
      applyNightShiftToDom(false)
    } else {
      const current = getCurrentHHMM(timezoneRef.current)
      const active  = isInNightShiftWindow(current, next.nightShiftStart, next.nightShiftEnd)
      setNightShiftActive(active)
      applyNightShiftToDom(active)
    }
  }, [])

  // ── setTimezone — called by ProfileClient once the user data loads ──────
  const setTimezone = useCallback((tz: string) => {
    timezoneRef.current = tz
    checkNightShift()
  }, [checkNightShift])

  return (
    <ThemeContext.Provider value={{ appearance, applyAppearance, setTimezone, nightShiftActive }}>
      {children}
    </ThemeContext.Provider>
  )
}
