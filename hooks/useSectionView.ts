/**
 * hooks/useSectionView.ts
 *
 * Fires a fire-and-forget POST to /api/analytics/track when a section is
 * viewed.  The server deduplicates by (userId, section, date, hour) via
 * a unique index, so multiple rapid mounts (React strict mode, hot reloads)
 * produce at most one event per hour bucket.
 *
 * This fills the instrumentation gap identified during the User Intelligence
 * & Monitoring Center audit: the AnalyticsEvent model, the /api/analytics/track
 * writer route, and the admin analytics reader all existed, but no user-facing
 * page was actually calling the track endpoint.
 *
 * Usage (in a client component):
 *   useSectionView('notes')
 *
 * The hook is safe to call from any client component that renders a tracked
 * section.  It never throws, never blocks rendering, and survives network
 * failures silently (fire-and-forget).
 */

'use client'

import { useEffect, useRef } from 'react'

export function useSectionView(section: string): void {
  const firedRef = useRef(false)

  useEffect(() => {
    // Fire once per mount — the server deduplicates by hour bucket
    if (firedRef.current) return
    firedRef.current = true

    void fetch('/api/analytics/track', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ section }),
      // Use keepalive so the beacon survives page navigation/unload
      keepalive: true,
    }).catch(() => {
      // Silently ignore — section view tracking is non-fatal
    })
  }, [section])
}
