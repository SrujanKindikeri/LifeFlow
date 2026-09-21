'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle, XCircle, Clock, Mail, Loader2 } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

type Status = 'loading' | 'success' | 'expired' | 'already-verified' | 'invalid' | 'error'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()

  const [status, setStatus]       = useState<Status>('loading')
  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)

  useEffect(() => {
    // Pre-populate email from query if provided (e.g. from resend flow)
    const emailParam = searchParams.get('email')
    if (emailParam) setResendEmail(decodeURIComponent(emailParam))

    const statusParam = searchParams.get('status') as Status | null
    if (statusParam) {
      // API already processed the token and redirected here with ?status=
      setStatus(statusParam)
      return
    }

    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      // User clicked the verification link in the email — hand off to the API
      // route which hashes the token, queries MongoDB, and redirects back here
      // with ?status=success|expired|invalid|already-verified.
      //
      // IMPORTANT: we must use window.location.href (full browser navigation),
      // NOT router.replace(). The API route responds with NextResponse.redirect()
      // (HTTP 307). App Router client-side navigation does NOT follow HTTP
      // redirects from API routes — it either silently drops them or re-renders
      // the current page, so the token never gets verified. A full browser
      // navigation lets the browser follow the redirect natively.
      window.location.assign(`/api/auth/verify-email?token=${encodeURIComponent(tokenParam)}`)
      return
    }

    // No token and no status — user navigated here directly
    setStatus('invalid')
  }, [searchParams])

  async function handleResend() {
    if (!resendEmail.trim()) {
      toastError('Please enter your email address.')
      return
    }
    setResending(true)
    try {
      const res  = await fetch('/api/auth/resend-verification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: resendEmail.trim() }),
      })
      const json = await res.json()
      if (res.status === 429) {
        toastError(json.error ?? 'Too many requests. Please wait a moment.')
        return
      }
      // Always show the generic success message
      toastSuccess(json.message ?? 'Verification email sent. Check your inbox.')
    } catch {
      toastError('Something went wrong. Please try again.')
    } finally {
      setResending(false)
    }
  }

  // ── Status variants ────────────────────────────────────────────────────────

  const variants: Record<Status, {
    icon: React.ReactNode
    heading: string
    body: React.ReactNode
    iconBg: string
    iconColor: string
  }> = {
    loading: {
      icon: <Loader2 size={28} className="animate-spin" />,
      heading: 'Verifying your email…',
      body: <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>Please wait a moment.</p>,
      iconBg: 'rgba(37,99,235,0.10)',
      iconColor: '#2563eb',
    },
    success: {
      icon: <CheckCircle size={28} />,
      heading: 'Email verified!',
      body: (
        <div className="space-y-4">
          <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
            Your email has been verified successfully. Welcome to LifeFlow.
          </p>
          <GlassButton
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => router.replace('/app/dashboard')}
          >
            Continue to Dashboard
          </GlassButton>
        </div>
      ),
      iconBg: 'rgba(22,163,74,0.10)',
      iconColor: '#16a34a',
    },
    'already-verified': {
      icon: <CheckCircle size={28} />,
      heading: 'Already verified',
      body: (
        <div className="space-y-4">
          <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
            Your email address has already been verified. Sign in to continue.
          </p>
          <Link href="/login">
            <GlassButton variant="primary" fullWidth size="lg">
              Sign In
            </GlassButton>
          </Link>
        </div>
      ),
      iconBg: 'rgba(22,163,74,0.10)',
      iconColor: '#16a34a',
    },
    expired: {
      icon: <Clock size={28} />,
      heading: 'Link expired',
      body: (
        <div className="space-y-4">
          <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
            This verification link has expired. Enter your email below to receive a new one.
          </p>
          <ResendForm
            email={resendEmail}
            onChange={setResendEmail}
            onResend={handleResend}
            resending={resending}
          />
        </div>
      ),
      iconBg: 'rgba(234,179,8,0.10)',
      iconColor: '#b45309',
    },
    invalid: {
      icon: <XCircle size={28} />,
      heading: 'Invalid verification link',
      body: (
        <div className="space-y-4">
          <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
            This link is invalid or has already been used. Enter your email below to request a new one.
          </p>
          <ResendForm
            email={resendEmail}
            onChange={setResendEmail}
            onResend={handleResend}
            resending={resending}
          />
        </div>
      ),
      iconBg: 'rgba(220,38,38,0.10)',
      iconColor: '#dc2626',
    },
    error: {
      icon: <XCircle size={28} />,
      heading: 'Something went wrong',
      body: (
        <div className="space-y-4">
          <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
            An unexpected error occurred. Please try again or request a new verification email.
          </p>
          <ResendForm
            email={resendEmail}
            onChange={setResendEmail}
            onResend={handleResend}
            resending={resending}
          />
        </div>
      ),
      iconBg: 'rgba(220,38,38,0.10)',
      iconColor: '#dc2626',
    },
  }

  const v = variants[status]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0,  scale: 1     }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[400px]"
    >
      <div
        className="glass-floating glass-catchlight relative rounded-[28px] overflow-hidden"
        style={{ boxShadow: 'var(--glass-shadow-lg)' }}
      >
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }} />

        <div className="auth-card-pad">
          <div className="flex flex-col items-center mb-8">
            {/* Icon */}
            <motion.div
              key={status}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: v.iconBg,
                border: `1px solid ${v.iconColor}30`,
                color: v.iconColor,
              }}
            >
              {v.icon}
            </motion.div>

            {/* Brand mark */}
            <div className="flex items-center gap-1.5 mb-5">
              <span className="text-lg">⚡</span>
              <span className="text-[13px] font-semibold tracking-tight"
                style={{ color: 'var(--text-muted)' }}>LifeFlow</span>
            </div>

            <h1 className="text-[20px] font-bold tracking-tight text-center mb-1"
              style={{ color: 'var(--text-primary)' }}>
              {v.heading}
            </h1>
          </div>

          <div>{v.body}</div>

          {/* Back to login — always available */}
          {status !== 'success' && status !== 'already-verified' && (
            <p className="text-center text-[13px] mt-6" style={{ color: 'var(--text-muted)' }}>
              <Link href="/login" className="font-semibold"
                style={{ color: 'var(--accent)' }}>
                Back to Sign In
              </Link>
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── Inline resend form ────────────────────────────────────────────────────────

function ResendForm({
  email,
  onChange,
  onResend,
  resending,
}: {
  email: string
  onChange: (v: string) => void
  onResend: () => void
  resending: boolean
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="resend-email"
          className="block text-[12px] font-medium mb-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Your email address
        </label>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.10)',
          }}>
          <Mail size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            id="resend-email"
            type="email"
            value={email}
            onChange={(e) => onChange(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>
      <GlassButton
        variant="primary"
        fullWidth
        size="md"
        loading={resending}
        onClick={onResend}
      >
        Resend verification email
      </GlassButton>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  )
}
