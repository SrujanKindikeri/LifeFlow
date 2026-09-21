'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, ArrowLeft, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

type PageState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'expired' }
  | { phase: 'gone' }
  | { phase: 'confirm'; name: string; scheduledPermanentDeletionAt: string }
  | { phase: 'success' }

// ── Shared card shell ─────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[400px]"
    >
      <div
        className="glass-floating glass-catchlight relative rounded-[28px] overflow-hidden"
        style={{ boxShadow: 'var(--glass-shadow-lg)' }}
      >
        {children}
      </div>
    </motion.div>
  )
}

// ── Brand mark ────────────────────────────────────────────────────────────────

function BrandMark() {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-4">
      <span className="text-lg" aria-hidden="true">⚡</span>
      <span
        className="text-[13px] font-semibold tracking-tight"
        style={{ color: 'var(--text-muted)' }}
      >
        LifeFlow
      </span>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <Card>
      <div className="p-8 flex flex-col items-center justify-center" style={{ minHeight: '280px' }}>
        <div
          className="w-6 h-6 rounded-full border-2 animate-spin"
          style={{
            borderColor:    'rgba(37,99,235,0.3)',
            borderTopColor: '#2563eb',
          }}
          role="status"
          aria-label="Validating your restoration link…"
        />
        <p
          className="mt-4 text-[13px]"
          style={{ color: 'var(--text-muted)' }}
          aria-live="polite"
        >
          Validating your restoration link…
        </p>
      </div>
    </Card>
  )
}

// ── Invalid token state ───────────────────────────────────────────────────────

function InvalidState() {
  const router = useRouter()
  return (
    <Card>
      <div className="auth-card-pad">
        <div className="flex flex-col items-center mb-8">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border:     '1px solid rgba(239,68,68,0.20)',
              color:      '#dc2626',
            }}
            aria-hidden="true"
          >
            <AlertTriangle size={26} />
          </motion.div>
          <BrandMark />
          <h1
            className="text-[22px] font-bold tracking-tight text-center mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Link invalid or already used
          </h1>
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            This restoration link is invalid or has already been used.
            Each link is single-use — you&apos;ll need to delete your account
            again to receive a new one.
          </p>
        </div>

        <GlassButton
          variant="primary"
          fullWidth
          size="lg"
          onClick={() => router.push('/login')}
        >
          Back to login
        </GlassButton>
      </div>
    </Card>
  )
}

// ── Expired token state ───────────────────────────────────────────────────────

function ExpiredState() {
  const router = useRouter()
  return (
    <Card>
      <div className="auth-card-pad">
        <div className="flex flex-col items-center mb-8">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{
              background: 'rgba(234,179,8,0.08)',
              border:     '1px solid rgba(234,179,8,0.24)',
              color:      '#ca8a04',
            }}
            aria-hidden="true"
          >
            <AlertTriangle size={26} />
          </motion.div>
          <BrandMark />
          <h1
            className="text-[22px] font-bold tracking-tight text-center mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Your account restoration link has expired.
          </h1>
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            This restoration link has expired. The 30-day recovery window
            has closed and this account can no longer be restored.
          </p>
        </div>

        <GlassButton
          variant="primary"
          fullWidth
          size="lg"
          onClick={() => router.push('/login')}
        >
          Back to login
        </GlassButton>
      </div>
    </Card>
  )
}

// ── Account permanently gone state ────────────────────────────────────────────

function GoneState() {
  const router = useRouter()
  return (
    <Card>
      <div className="auth-card-pad">
        <div className="flex flex-col items-center mb-8">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border:     '1px solid rgba(239,68,68,0.20)',
              color:      '#dc2626',
            }}
            aria-hidden="true"
          >
            <AlertTriangle size={26} />
          </motion.div>
          <BrandMark />
          <h1
            className="text-[22px] font-bold tracking-tight text-center mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            This account can no longer be restored.
          </h1>
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            The recovery window for this account has expired and the account
            data has been permanently deleted.
          </p>
        </div>

        <GlassButton
          variant="primary"
          fullWidth
          size="lg"
          onClick={() => router.push('/signup')}
        >
          Create a new account
        </GlassButton>

        <div className="flex items-center justify-center mt-4">
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={13} />
            Back to login
          </Link>
        </div>
      </div>
    </Card>
  )
}

// ── Success state ─────────────────────────────────────────────────────────────

function SuccessState() {
  const router = useRouter()
  return (
    <Card>
      <div className="p-8 text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{
            background: 'rgba(22,163,74,0.08)',
            border:     '1px solid rgba(22,163,74,0.20)',
            color:      '#16a34a',
          }}
          aria-hidden="true"
        >
          <CheckCircle2 size={26} />
        </motion.div>
        <BrandMark />
        <h1
          className="text-[22px] font-bold tracking-tight mb-2"
          style={{ color: 'var(--text-primary)' }}
          role="status"
          aria-live="polite"
        >
          Your LifeFlow account has been restored.
        </h1>
        <p
          className="text-[13px] leading-relaxed mb-8"
          style={{ color: 'var(--text-muted)' }}
        >
          Your account and existing LifeFlow data have been fully restored.
          Redirecting you to the dashboard…
        </p>

        <GlassButton
          variant="primary"
          fullWidth
          size="lg"
          onClick={() => router.push('/app/dashboard')}
        >
          Open LifeFlow
        </GlassButton>
      </div>
    </Card>
  )
}

// ── Main content (needs useSearchParams — wrapped in Suspense below) ──────────

function RestoreAccountContent() {
  const router          = useRouter()
  const searchParams    = useSearchParams()
  const { error: toastError } = useToast()

  const rawToken = searchParams.get('token') ?? ''

  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const [password, setPassword]           = useState('')
  const [showPassword, setShowPassword]   = useState(false)
  const [submitting, setSubmitting]       = useState(false)

  // ── Validate the token on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!rawToken) {
      setState({ phase: 'invalid' })
      return
    }

    let cancelled = false

    async function validate() {
      try {
        const res  = await fetch(
          `/api/auth/validate-restore-token?token=${encodeURIComponent(rawToken)}`,
          { method: 'GET' }
        )
        if (cancelled) return

        if (res.status === 429) {
          setState({ phase: 'invalid' })
          return
        }

        let json: {
          valid?: boolean
          code?: string
          name?: string
          scheduledPermanentDeletionAt?: string
        } = {}
        try { json = await res.json() } catch { /* ignore parse error */ }

        if (cancelled) return

        if (json.valid && json.name && json.scheduledPermanentDeletionAt) {
          setState({
            phase:                        'confirm',
            name:                         json.name,
            scheduledPermanentDeletionAt: json.scheduledPermanentDeletionAt,
          })
          return
        }

        if (json.code === 'TOKEN_EXPIRED') {
          setState({ phase: 'expired' })
          return
        }

        if (json.code === 'ACCOUNT_GONE' || res.status === 410) {
          setState({ phase: 'gone' })
          return
        }

        // INVALID_TOKEN or anything unexpected
        setState({ phase: 'invalid' })
      } catch {
        if (!cancelled) setState({ phase: 'invalid' })
      }
    }

    validate()
    return () => { cancelled = true }
  }, [rawToken])

  // ── Handle restore form submit ────────────────────────────────────────────
  async function handleRestore(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || state.phase !== 'confirm') return

    if (!password.trim()) {
      toastError('Please enter your password.')
      return
    }

    setSubmitting(true)
    try {
      const res  = await fetch('/api/auth/restore-account', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: rawToken, password }),
      })

      let json: { message?: string; error?: string; code?: string } = {}
      try { json = await res.json() } catch { /* ignore */ }

      if (!res.ok) {
        if (json.code === 'TOKEN_EXPIRED') {
          setState({ phase: 'expired' })
          return
        }
        if (json.code === 'RECOVERY_WINDOW_EXPIRED' || json.code === 'ACCOUNT_GONE' || res.status === 410) {
          setState({ phase: 'gone' })
          return
        }
        if (json.code === 'INVALID_TOKEN') {
          setState({ phase: 'invalid' })
          return
        }
        if (res.status === 429) {
          toastError(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        // Wrong password or generic error — stay on the confirm screen
        toastError(json.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Success — transition to success state, then redirect
      setState({ phase: 'success' })
      setTimeout(() => {
        router.push('/app/dashboard')
      }, 2500)
    } catch {
      toastError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render by phase ───────────────────────────────────────────────────────

  if (state.phase === 'loading') return <LoadingState />
  if (state.phase === 'invalid') return <InvalidState />
  if (state.phase === 'expired') return <ExpiredState />
  if (state.phase === 'gone')    return <GoneState />
  if (state.phase === 'success') return <SuccessState />

  // ── Confirm phase ─────────────────────────────────────────────────────────
  const { name, scheduledPermanentDeletionAt } = state

  const firstName = name.split(' ')[0] ?? name
  const permanentDateStr = new Date(scheduledPermanentDeletionAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Card>
      <div className="auth-card-pad">
        {/* ── Icon + branding ──────────────────────────────────────────── */}
        <div className="flex flex-col items-center mb-8">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{
              background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
              border:     '1px solid rgba(37,99,235,0.18)',
              boxShadow:  '0 4px 20px rgba(37,99,235,0.12)',
              color:      '#2563eb',
            }}
            aria-hidden="true"
          >
            <RotateCcw size={24} />
          </motion.div>
          <BrandMark />
          <h1
            className="text-[22px] font-bold tracking-tight text-center mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            Restore your LifeFlow account?
          </h1>
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            Hi {firstName} — your account and existing LifeFlow data will be
            restored.
          </p>
        </div>

        {/* ── Info notice ───────────────────────────────────────────────── */}
        <div
          className="rounded-xl px-4 py-3 mb-6 text-[12.5px] leading-relaxed"
          style={{
            background:  'rgba(37,99,235,0.05)',
            border:      '1px solid rgba(37,99,235,0.14)',
            color:       'var(--text-muted)',
          }}
          role="note"
        >
          Your account is scheduled for permanent deletion on{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{permanentDateStr}</strong>.
          Restoring it now will cancel the deletion and preserve all your data.
        </div>

        {/* ── Password form ─────────────────────────────────────────────── */}
        <form onSubmit={handleRestore} className="space-y-4" noValidate>
          <GlassInput
            label="Confirm your password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your current password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="transition-colors focus-ring rounded"
                style={{ color: 'var(--text-muted)' }}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            }
          />

          <GlassButton
            type="submit"
            variant="primary"
            fullWidth
            size="lg"
            loading={submitting}
            className="mt-2"
          >
            Restore Account
          </GlassButton>
        </form>

        {/* ── Back to login ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-center mt-6">
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={13} />
            Back to login
          </Link>
        </div>
      </div>
    </Card>
  )
}

// ── Suspense boundary — required because useSearchParams() suspends in Next.js ─

export default function RestoreAccountPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-[400px]">
          <div
            className="glass-floating glass-catchlight rounded-[28px] overflow-hidden p-8 flex items-center justify-center"
            style={{ minHeight: '280px' }}
          >
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{
                borderColor:    'rgba(37,99,235,0.3)',
                borderTopColor: '#2563eb',
              }}
              role="status"
              aria-label="Loading"
            />
          </div>
        </div>
      }
    >
      <RestoreAccountContent />
    </Suspense>
  )
}
