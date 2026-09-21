'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { Mail, ArrowLeft } from 'lucide-react'
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validations'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading]     = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  async function onSubmit(data: ForgotPasswordInput) {
    if (loading) return
    setLoading(true)
    try {
      // Fire-and-forget — we always show the generic success message regardless
      // of the response, so account enumeration is impossible from the UI side.
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
    } catch {
      // Swallow network errors — the generic message is shown regardless
    } finally {
      setLoading(false)
      // Always transition to the success state — never reveal whether the
      // email exists in the database.
      setSubmitted(true)
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
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }}
        />

        <div className="auth-card-pad">
          {/* ── Icon + branding ──────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{
                background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
                border:     '1px solid rgba(37,99,235,0.18)',
                boxShadow:  '0 4px 20px rgba(37,99,235,0.12)',
                color:      '#2563eb',
              }}
            >
              <Mail size={26} />
            </motion.div>

            <div className="flex items-center gap-1.5 mb-4">
              <span className="text-lg">⚡</span>
              <span
                className="text-[13px] font-semibold tracking-tight"
                style={{ color: 'var(--text-muted)' }}
              >
                LifeFlow
              </span>
            </div>

            {!submitted ? (
              <>
                <h1
                  className="text-[22px] font-bold tracking-tight text-center mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Forgot your password?
                </h1>
                <p
                  className="text-[13px] text-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Enter your email and we&apos;ll send you a reset link.
                </p>
              </>
            ) : (
              <>
                <h1
                  className="text-[22px] font-bold tracking-tight text-center mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Check your email
                </h1>
                <p
                  className="text-[13px] text-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Reset link sent (if that account exists)
                </p>
              </>
            )}
          </div>

          {/* ── Form / success state ──────────────────────────────────────── */}
          {!submitted ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <GlassInput
                label="Email address"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                leftIcon={<Mail size={14} />}
                error={errors.email?.message}
                {...register('email')}
              />

              <GlassButton
                type="submit"
                variant="primary"
                fullWidth
                size="lg"
                loading={loading}
                className="mt-2"
              >
                Send Reset Link
              </GlassButton>
            </form>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="rounded-2xl p-4 text-center"
              style={{
                background: 'rgba(37,99,235,0.06)',
                border:     '1px solid rgba(37,99,235,0.14)',
              }}
            >
              <p
                className="text-[14px] leading-relaxed"
                style={{ color: 'var(--text-primary)' }}
              >
                If an account exists for that email, we&apos;ve sent a password
                reset link. Check your inbox — the link expires in{' '}
                <strong>15 minutes</strong>.
              </p>
            </motion.div>
          )}

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
      </div>
    </motion.div>
  )
}
