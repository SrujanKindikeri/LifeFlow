'use client'

/**
 * app/offline/page.tsx — Offline fallback page.
 *
 * Served by the service worker when the user navigates while offline.
 * Pre-cached in the shell cache at SW install time.
 * Minimal — no data fetching, no auth dependencies.
 */

export default function OfflinePage() {
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center gap-6 p-8 text-center"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Cloud-offline icon */}
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
        style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--glass-subtle-border)' }}
        aria-hidden="true"
      >
        📶
      </div>

      <div className="flex flex-col gap-2 max-w-xs">
        <h1
          className="text-xl font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          You&rsquo;re offline
        </h1>
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          LifeFlow will sync your notes, tasks, habits, and expenses as soon as
          connectivity returns. Any changes you made are safely saved locally.
        </p>
      </div>

      <button
        onClick={() => window.location.reload()}
        className="px-5 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
        style={{
          background:  'var(--accent)',
          color:       '#fff',
          border:      'none',
        }}
      >
        Try again
      </button>
    </div>
  )
}
