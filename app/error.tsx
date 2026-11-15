'use client'

/**
 * app/error.tsx — Route-segment error boundary for the LifeFlow App Router.
 *
 * CRITICAL CONSTRAINTS
 * ────────────────────
 * 1. NO Tailwind class names.  This component renders before ThemeProvider
 *    and before globals.css custom properties are resolved on the client.
 *    Any class like `auth-bg` or `glass-floating` that depends on CSS custom
 *    properties (--bg-base, --text-primary, etc.) will produce invisible or
 *    broken UI.  All styling must be inline.
 *
 * 2. NO external component imports (lucide-react, framer-motion, etc.).
 *    In React 19 App Router, if an error fires during the RSC phase before
 *    ESM modules are fully resolved, the import resolves to a Promise<undefined>
 *    rather than a component function.  React throws:
 *      "Element type is invalid. Received a promise that resolves to: undefined."
 *    which then triggers `enqueueModel` Fiber crashes in a recursive loop.
 *    Inline SVGs are safe and have zero dependencies.
 *
 * 3. Keep it a Client Component ('use client') — Next.js requires this.
 *
 * 4. The fallback must NEVER throw.  If it does, React escalates to
 *    global-error.tsx, which also renders before any provider, and a crash
 *    there produces an infinite error loop with no user-visible recovery path.
 */

import { useEffect } from 'react'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

// ── Inline SVG icons — no external import required ────────────────────────────

function IconRefresh() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  )
}

function IconHome() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

// ── DB / network hint (dev only) ─────────────────────────────────────────────

function getDevHint(msg: string): string | null {
  if (!msg) return null
  if (msg.includes('IP') || msg.includes('whitelist') || msg.includes('Atlas'))
    return 'MongoDB Atlas is rejecting the connection. Add your current IP to the Atlas cluster IP Allowlist.'
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND'))
    return 'Cannot reach the database server. Check that MONGODB_URI in .env.local is correct.'
  if (msg.includes('Authentication failed') || msg.includes('bad auth'))
    return 'MongoDB authentication failed. Verify the username and password in MONGODB_URI.'
  if (msg.includes('Unauthorized') || msg.includes('session'))
    return 'Session is missing or invalid. Try logging in again.'
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log without re-throwing — a throw inside useEffect would recurse
    try { console.error('[app error]', error) } catch { /* ignore */ }
  }, [error])

  const isDev = process.env.NODE_ENV === 'development'
  const hint  = isDev ? getDevHint(error?.message ?? '') : null

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: '#f5f5f7',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '1.5rem',
        padding: '2.5rem',
        maxWidth: '480px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        border: '1px solid rgba(0,0,0,0.07)',
      }}>
        {/* Icon */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '4rem',
          height: '4rem',
          borderRadius: '1rem',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.18)',
          fontSize: '1.75rem',
          marginBottom: '1.5rem',
        }}>
          ⚡
        </div>

        <p style={{
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'rgba(239,68,68,0.65)',
          marginBottom: '0.75rem',
          margin: '0 0 0.75rem',
        }}>
          Something went wrong
        </p>

        <h1 style={{
          fontSize: '1.375rem',
          fontWeight: 700,
          color: '#111827',
          margin: '0 0 0.75rem',
          letterSpacing: '-0.02em',
        }}>
          Unexpected error
        </h1>

        <p style={{
          fontSize: '0.8125rem',
          color: '#6b7280',
          margin: '0 0 1.75rem',
          lineHeight: 1.6,
        }}>
          An unexpected error occurred. Please try again, or contact support if the problem persists.
        </p>

        {/* Dev-only error details */}
        {isDev && (
          <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
            <div style={{
              borderRadius: '0.75rem',
              background: 'rgba(239,68,68,0.05)',
              border: '1px solid rgba(239,68,68,0.15)',
              padding: '0.75rem 1rem',
              marginBottom: hint ? '0.75rem' : '0',
            }}>
              <p style={{
                fontSize: '0.625rem',
                fontWeight: 700,
                color: 'rgba(239,68,68,0.6)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                margin: '0 0 0.5rem',
              }}>
                Error (dev only)
              </p>
              <p style={{
                fontSize: '0.75rem',
                color: '#dc2626',
                fontFamily: '"SF Mono", "Fira Code", Consolas, monospace',
                wordBreak: 'break-all',
                lineHeight: 1.5,
                margin: 0,
              }}>
                {error?.message || 'Unknown error'}
              </p>
              {error?.digest && (
                <p style={{
                  fontSize: '0.6875rem',
                  color: '#9ca3af',
                  margin: '0.5rem 0 0',
                }}>
                  digest: {error.digest}
                </p>
              )}
            </div>

            {hint && (
              <div style={{
                borderRadius: '0.75rem',
                background: 'rgba(245,158,11,0.06)',
                border: '1px solid rgba(245,158,11,0.18)',
                padding: '0.75rem 1rem',
              }}>
                <p style={{
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  color: 'rgba(245,158,11,0.7)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  margin: '0 0 0.5rem',
                }}>
                  How to fix
                </p>
                <p style={{
                  fontSize: '0.75rem',
                  color: '#92400e',
                  lineHeight: 1.5,
                  margin: 0,
                }}>
                  {hint}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={reset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.375rem',
              borderRadius: '0.75rem',
              background: 'rgba(99,102,241,0.90)',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(99,102,241,0.28)',
            }}
          >
            <IconRefresh />
            Try again
          </button>

          <a
            href="/app/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.375rem',
              borderRadius: '0.75rem',
              background: 'rgba(0,0,0,0.04)',
              color: '#374151',
              border: '1px solid rgba(0,0,0,0.08)',
              fontSize: '0.875rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <IconHome />
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
