'use client'

/**
 * hooks/useNotificationTone.ts
 *
 * Watches the unread notification count and plays the Turn Tone chime
 * whenever the count increases — indicating a new notification has arrived.
 *
 * DESIGN
 * ──────────────────────────────────────────────────────────────────────────
 * - Wraps useUnreadCount so the count is fetched in one place (AppHeader
 *   already calls useUnreadCount; this hook replaces that call there).
 * - Skips the tone on the very first count read (mount) to avoid playing
 *   a sound on every page load for existing unread notifications.
 * - Reads tone preferences (enabled, volume) live from ThemeContext so
 *   changes on the Profile page take effect immediately without a reload.
 * - Tone failure NEVER throws, NEVER affects notifications or other UI.
 * - If the browser has not had a user interaction yet, the AudioContext
 *   will be suspended and the tone is silently skipped for that event.
 *   Subsequent events after interaction will play correctly.
 * - Does NOT play for duplicate/repeated counts (only strict increases).
 *
 * USAGE (AppHeader)
 * ──────────────────────────────────────────────────────────────────────────
 *   const unreadCount = useNotificationTone()
 *   // identical return value to useUnreadCount — drop-in replacement
 */

import { useEffect, useRef } from 'react'
import { useUnreadCount } from '@/hooks/useUnreadCount'
import { useAppearance } from '@/hooks/useAppearance'
import { playTone } from '@/lib/tonePlayer'

export function useNotificationTone(): number {
  const count              = useUnreadCount()
  const { appearance }     = useAppearance()
  const prevCountRef       = useRef<number | null>(null)  // null = not yet initialised

  useEffect(() => {
    // Skip tone on the initial mount read — we don't want a sound on every
    // page load just because there are pre-existing unread notifications.
    if (prevCountRef.current === null) {
      prevCountRef.current = count
      return
    }

    // Play tone only when count strictly increases (new notification arrived)
    if (count > prevCountRef.current) {
      if (appearance.turnToneEnabled && appearance.turnToneVolume > 0) {
        void playTone(appearance.turnToneVolume)
      }
    }

    prevCountRef.current = count
  }, [count, appearance.turnToneEnabled, appearance.turnToneVolume])

  return count
}
