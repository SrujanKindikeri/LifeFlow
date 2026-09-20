'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Mail } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

function CheckEmailContent() {
  const searchParams = useSearchParams()
  const { success, error } = useToast()

  // Email is passed as a query param from the signup page
  const email = searchParams.get('email') ?? ''

  const [resending, setResending] = useState(false)
  const [sentCount, setSentCount] = useState(0)

  async function handleResend() {
    if (!email) {
      error('Email address is missing. Please sign up again.')
      return
    }
    setResending(true)
    try {
      const res  = await fetch('/api/auth/resend-verification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      const json = await res.json()

      if (res.status === 429) {
        error(json.error ?? 'Too many requests. Please wait a moment.')
        return
      }

      // emailDelivered: true  → SMTP accepted the message
      // emailDelivered: false → SMTP rejected / timed out
      // emailDelivered absent → generic response (account not found / already verified)
      if (json.emailDelivered === false) {
        error("We couldn't send the verification email. Please try again.")
        return
      }

      success('Verification email sent. Check your inbox.')
      setSentCount((c) => c + 1)
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setResending(false)
    }
  }

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
        {/* Top inner highlight */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }} />

        <div className="p-8">
          {/* Icon + branding */}
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: 'rgba(37,99,235,0.10)',
                border: '1px solid rgba(37,99,235,0.20)',
                color: '#2563eb',
              }}
            >
              <Mail size={28} />
            </motion.div>

            <div className="flex items-center gap-1.5 mb-5">
              <span className="text-lg">⚡</span>
              <span className="text-[13px] font-semibold tracking-tight"
                style={{ color: 'var(--text-muted)' }}>LifeFlow</span>
            </div>

            <h1 className="text-[22px] font-bold tracking-tight text-center mb-1"
              style={{ color: 'var(--text-primary)' }}>
              Check your email
            </h1>
            <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
              We sent a verification link to
            </p>
            {email && (
              <p className="text-[14px] font-semibold text-center mt-1 px-4 break-all"
                style={{ color: 'var(--text-primary)' }}>
                {email}
              </p>
            )}
          </div>

          {/* Instructions */}
          <div
            className="rounded-xl p-4 mb-5 space-y-2"
            style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.12)' }}
          >
            <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
              Next steps:
            </p>
            <ol className="text-[13px] space-y-1 list-none" style={{ color: 'var(--text-muted)' }}>
              <li>1. Open the email from LifeFlow in your inbox</li>
              <li>2. Click the <strong>Verify Email</strong> button</li>
              <li>3. Return here to sign in</li>
            </ol>
          </div>

          {/* Resend */}
          <div className="space-y-3">
            <GlassButton
              variant="secondary"
              fullWidth
              size="md"
              loading={resending}
              onClick={handleResend}
            >
              {sentCount > 0 ? 'Resend again' : 'Resend verification email'}
            </GlassButton>

            {sentCount > 0 && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center text-[12px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Sent {sentCount} time{sentCount > 1 ? 's' : ''}. Check your spam folder too.
              </motion.p>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>or</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          </div>

          <p className="text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Already verified?{' '}
            <Link href="/login" className="font-semibold" style={{ color: 'var(--accent)' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <p className="text-center text-[11px] mt-5" style={{ color: 'var(--text-faint)' }}>
        The link expires in 8 minutes. Check your spam folder if you don&apos;t see it.
      </p>
    </motion.div>
  )
}

export default function CheckEmailPage() {
  return (
    <Suspense>
      <CheckEmailContent />
    </Suspense>
  )
}
