'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Shield, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const json = await res.json() as { error?: { message?: string } }
      if (!res.ok) {
        setError(json.error?.message ?? 'Authentication failed.')
        return
      }
      router.push('/admin/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    /*
     * Outer wrapper:
     * - min-h-svh uses the Small Viewport Height unit so the layout never
     *   overflows when the mobile browser chrome is visible.
     * - overflow-x-hidden prevents any horizontal scroll on narrow screens.
     * - Safe-area padding (env()) gives breathing room on notched devices.
     */
    <div
      className="min-h-screen overflow-x-hidden flex items-center justify-center"
      style={{
        background: 'var(--bg-base)',
        padding: 'max(env(safe-area-inset-top, 0px), 1.25rem) max(env(safe-area-inset-right, 0px), 1rem) max(env(safe-area-inset-bottom, 0px), 1.25rem) max(env(safe-area-inset-left, 0px), 1rem)',
      }}
    >
      {/*
       * Ambient background glow — purely decorative, sits behind the card.
       * pointer-events-none so it never intercepts touches.
       */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none overflow-hidden"
        style={{ zIndex: 0 }}
      >
        <div
          className="absolute"
          style={{
            top: '20%', left: '50%', transform: 'translateX(-50%)',
            width: 'min(600px, 80vw)', height: 'min(600px, 80vw)',
            background: 'radial-gradient(ellipse, rgba(220,38,38,0.07) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />
      </div>

      {/* Login card — max-w keeps it compact on desktop; w-full makes it fluid on mobile */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full"
        style={{ maxWidth: '440px', zIndex: 1 }}
      >
        <div
          className="glass-floating glass-catchlight rounded-[28px] overflow-hidden"
          style={{ boxShadow: 'var(--glass-shadow-xl)' }}
        >
          <div
            className="flex flex-col"
            style={{ padding: 'clamp(1.5rem, 6vw, 2.25rem)' }}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex flex-col items-center" style={{ marginBottom: 'clamp(1.25rem, 4vw, 2rem)' }}>
              {/* Shield icon */}
              <div
                className="flex items-center justify-center rounded-2xl"
                style={{
                  width: 56, height: 56,
                  background: 'linear-gradient(135deg, rgba(220,38,38,0.12) 0%, rgba(239,68,68,0.07) 100%)',
                  border: '1px solid rgba(220,38,38,0.22)',
                  marginBottom: '1.125rem',
                }}
              >
                <Shield size={26} style={{ color: 'var(--danger)' }} aria-hidden="true" />
              </div>

              <h1
                className="font-bold tracking-tight text-center leading-tight"
                style={{ color: 'var(--text-primary)', fontSize: 'clamp(1.2rem, 4vw, 1.4rem)', marginBottom: '0.35rem' }}
              >
                Admin Control Panel
              </h1>
              <p
                className="text-center"
                style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}
              >
                LifeFlow Administrator Access
              </p>
            </div>

            {/* ── Form ───────────────────────────────────────────────── */}
            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Email field */}
                <div>
                  <label
                    htmlFor="admin-email"
                    className="block font-semibold"
                    style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.4rem' }}
                  >
                    Admin Email
                  </label>
                  <div className="relative">
                    <span
                      className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ left: '0.75rem', color: 'var(--text-muted)' }}
                      aria-hidden="true"
                    >
                      <Mail size={15} />
                    </span>
                    <input
                      id="admin-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@example.com"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      disabled={loading}
                      aria-describedby={error ? 'login-error' : undefined}
                      className="w-full rounded-xl outline-none transition-all disabled:opacity-60"
                      style={{
                        paddingLeft: '2.375rem', paddingRight: '0.875rem',
                        paddingTop: '0.625rem', paddingBottom: '0.625rem',
                        fontSize: '0.875rem',
                        background: 'var(--glass-subtle-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        minHeight: '44px', // touch target
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
                      onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                    />
                  </div>
                </div>

                {/* Password field */}
                <div>
                  <label
                    htmlFor="admin-password"
                    className="block font-semibold"
                    style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.4rem' }}
                  >
                    Password
                  </label>
                  <div className="relative">
                    <span
                      className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ left: '0.75rem', color: 'var(--text-muted)' }}
                      aria-hidden="true"
                    >
                      <Lock size={15} />
                    </span>
                    <input
                      id="admin-password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      required
                      disabled={loading}
                      className="w-full rounded-xl outline-none transition-all disabled:opacity-60"
                      style={{
                        paddingLeft: '2.375rem', paddingRight: '2.75rem',
                        paddingTop: '0.625rem', paddingBottom: '0.625rem',
                        fontSize: '0.875rem',
                        background: 'var(--glass-subtle-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        minHeight: '44px',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
                      onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                    />
                    {/* Show/hide toggle */}
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      disabled={loading}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40"
                      style={{
                        right: '0.5rem',
                        width: '2rem', height: '2rem',
                        color: 'var(--text-muted)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <motion.div
                    id="login-error"
                    role="alert"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2.5 rounded-xl"
                    style={{
                      padding: '0.625rem 0.875rem',
                      background: 'var(--danger-dim)',
                      border: '1px solid rgba(220,38,38,0.22)',
                      color: 'var(--danger-text)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </motion.div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full rounded-xl font-semibold text-white transition-all disabled:opacity-50"
                  style={{
                    padding: '0.75rem 1rem',
                    fontSize: '0.9375rem',
                    background: 'var(--danger)',
                    boxShadow: '0 2px 14px rgba(220,38,38,0.22)',
                    minHeight: '48px', // larger touch target for primary action
                  }}
                  onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#b91c1c' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--danger)' }}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Signing in…
                    </span>
                  ) : 'Sign in to Control Panel'}
                </button>
              </div>
            </form>

            {/* Footer note */}
            <p
              className="text-center"
              style={{ color: 'var(--text-faint)', fontSize: '0.6875rem', marginTop: '1.25rem' }}
            >
              Restricted to authorized administrators only.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
