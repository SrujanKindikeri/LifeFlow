'use client'

import { useEffect } from 'react'
import { RefreshCw, Home } from 'lucide-react'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[app error]', error)
  }, [error])

  const isDev = process.env.NODE_ENV === 'development'

  function getHint(msg: string): string | null {
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

  const hint = isDev ? getHint(error?.message ?? '') : null

  return (
    <div className="auth-bg">
      <div className="glass-floating rounded-[28px] p-10 max-w-lg w-full text-center shadow-[0_32px_80px_rgba(0,0,0,0.55)] relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent pointer-events-none" />
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-44 h-44 bg-red-500/08 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 text-3xl mb-6">
            ⚡
          </div>

          <p className="text-[11px] font-bold tracking-[0.14em] text-red-400/65 uppercase mb-3">
            Something went wrong
          </p>

          <h1 className="text-[24px] font-bold text-white mb-3 tracking-tight">
            Unexpected error
          </h1>
          <p className="text-[13px] text-white/42 mb-6 leading-relaxed max-w-sm mx-auto">
            An unexpected error occurred. Please try again, or contact support if the problem persists.
          </p>

          {/* Dev-only error details */}
          {isDev && (
            <div className="text-left mb-6 space-y-3">
              <div className="rounded-xl bg-red-500/[0.07] border border-red-500/18 px-4 py-3">
                <p className="text-[10px] font-bold text-red-400/65 uppercase tracking-wider mb-1.5">
                  Error (dev only)
                </p>
                <p className="text-[12px] text-red-300/75 font-mono break-all leading-relaxed">
                  {error?.message || 'Unknown error'}
                </p>
                {error?.digest && (
                  <p className="text-[10px] text-white/28 mt-1.5">digest: {error.digest}</p>
                )}
              </div>
              {hint && (
                <div className="rounded-xl bg-amber-500/[0.07] border border-amber-500/18 px-4 py-3">
                  <p className="text-[10px] font-bold text-amber-400/65 uppercase tracking-wider mb-1.5">
                    How to fix
                  </p>
                  <p className="text-[12px] text-amber-200/65 leading-relaxed">{hint}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-500/88 hover:bg-indigo-500 text-white font-semibold transition-colors text-sm shadow-[0_4px_14px_rgba(99,102,241,0.3)]"
            >
              <RefreshCw size={14} />
              Try again
            </button>
            <a
              href="/app/dashboard"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl glass hover:bg-white/[0.08] text-white/65 hover:text-white font-semibold transition-colors text-sm"
            >
              <Home size={14} />
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
