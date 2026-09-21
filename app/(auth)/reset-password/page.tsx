'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { KeyRound, Eye, EyeOff, ArrowLeft, AlertTriangle } from 'lucide-react'
import { z } from 'zod'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

// ── Client-side schema (mirrors server-side resetPasswordSchema minus the
//    token field — the token comes from the URL, not the form) ─────────────────
const formSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormValues = z.infer<typeof formSchema>

// ── Password strength helper ──────────────────────────────────────────────────

function PasswordRequirements({ value }: { value: string }) {
  const rules = [
    { label: 'At least 8 characters',      met: value.length >= 8              },
    { label: 'One uppercase letter (A–Z)',  met: /[A-Z]/.test(value)            },
    { label: 'One number (0–9)',            met: /[0-9]/.test(value)            },
  ]

  if (!value) return null

  return (
    <ul className="mt-2 space-y-1" aria-label="Password requirements">
      {rules.map((r) => (
        <li
          key={r.label}
          className="flex items-center gap-1.5 text-[12px]"
          style={{ color: r.met ? '#16a34a' : 'var(--text-muted)' }}
        >
          <span aria-hidden="true">{r.met ? '✓' : '○'}</span>
          {r.label}
        </li>
      ))}
    </ul>
  )
}

// ── Main component (wrapped in Suspense below for useSearchParams) ─────────────

function ResetPasswordContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { success, error } = useToast()

  const rawToken = searchParams.get('token') ?? ''

  const [loading, setLoading]           = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)
  const [done, setDone]                 = useState(false)
  const [invalidToken, setInvalidToken] = useState(!rawToken)

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  })

  // Keep live value for the requirements checklist
  const watchedPassword = watch('password', '')

  async function onSubmit(data: FormValues) {
    if (loading || !rawToken) return
    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token:           rawToken,
          password:        data.password,
          confirmPassword: data.confirmPassword,
        }),
      })

      // Parse JSON — the API always returns a JSON body
      let json: { success?: boolean; error?: string; message?: string; code?: string } = {}
      try {
        json = await res.json()
      } catch {
        // Non-JSON response (very unlikely — means a proxy/infra error)
        error('Something went wrong. Please try again.')
        return
      }

      if (!res.ok) {
        // Switch on known error codes first
        if (json.code === 'INVALID_TOKEN') {
          setInvalidToken(true)
          return
        }
        if (res.status === 429 || json.code === 'RATE_LIMITED') {
          error(json.error ?? 'Too many attempts. Please request a new reset link.')
          return
        }
        if (res.status === 503) {
          error('Service temporarily unavailable. Please try again in a moment.')
          return
        }
        // All other errors: show the API message if present, otherwise generic fallback
        error(json.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Success path — json.success === true (or res.ok without error)
      success(json.message ?? 'Password changed! Redirecting to login…')
      setDone(true)

      // Redirect after a short delay so the user sees the success state
      setTimeout(() => {
        router.push('/login?reset=success')
      }, 2000)
    } catch {
      // Network failure or unexpected JS exception
      error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Invalid / missing token state ─────────────────────────────────────────
  if (invalidToken) {
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
          <div
            className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }}
          />

          <div className="auth-card-pad">
            <div className="flex flex-col items-center mb-8">
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1,   opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border:     '1px solid rgba(239,68,68,0.20)',
                  color:      '#dc2626',
                }}
              >
                <AlertTriangle size={26} />
              </motion.div>

              <div className="flex items-center gap-1.5 mb-4">
                <span className="text-lg">⚡</span>
                <span className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }}>
                  LifeFlow
                </span>
              </div>

              <h1
                className="text-[22px] font-bold tracking-tight text-center mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Link invalid or expired
              </h1>
              <p
                className="text-[13px] text-center leading-relaxed"
                style={{ color: 'var(--text-muted)' }}
              >
                This password reset link is invalid or has expired. Reset links
                are single-use and expire after 15 minutes.
              </p>
            </div>

            <GlassButton
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => router.push('/forgot-password')}
            >
              Request a new reset link
            </GlassButton>

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

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
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
          <div
            className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }}
          />

          <div className="p-8 text-center">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{
                background: 'rgba(22,163,74,0.08)',
                border:     '1px solid rgba(22,163,74,0.20)',
                color:      '#16a34a',
                fontSize:   '26px',
              }}
            >
              ✓
            </motion.div>

            <div className="flex items-center justify-center gap-1.5 mb-4">
              <span className="text-lg">⚡</span>
              <span className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }}>
                LifeFlow
              </span>
            </div>

            <h1
              className="text-[22px] font-bold tracking-tight mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Password changed!
            </h1>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Your password has been updated. Redirecting you to login…
            </p>
          </div>
        </div>
      </motion.div>
    )
  }

  // ── Reset form ─────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0,  scale: 1     }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[400px]"
    >
      <div
        className="relative rounded-[28px] overflow-hidden"
        style={{
          background:          'rgba(255,255,255,0.88)',
          backdropFilter:      'blur(36px) saturate(1.8)',
          WebkitBackdropFilter:'blur(36px) saturate(1.8)',
          border:              '1px solid rgba(0,0,0,0.08)',
          boxShadow:           '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }}
        />

        <div className="auth-card-pad">
          {/* ── Icon + branding ────────────────────────────────────────── */}
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
              <KeyRound size={24} />
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

            <h1
              className="text-[22px] font-bold tracking-tight text-center mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Choose a new password
            </h1>
            <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
              Pick something strong that you haven&apos;t used before.
            </p>
          </div>

          {/* ── Form ──────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <GlassInput
                label="New password"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                autoFocus
                leftIcon={<KeyRound size={14} />}
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
                error={errors.password?.message}
                {...register('password')}
              />
              <PasswordRequirements value={watchedPassword} />
            </div>

            <GlassInput
              label="Confirm new password"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Re-enter your new password"
              autoComplete="new-password"
              leftIcon={<KeyRound size={14} />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="transition-colors focus-ring rounded"
                  style={{ color: 'var(--text-muted)' }}
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />

            <GlassButton
              type="submit"
              variant="primary"
              fullWidth
              size="lg"
              loading={loading}
              className="mt-2"
            >
              Reset Password
            </GlassButton>
          </form>

          {/* ── Back to login ─────────────────────────────────────────── */}
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

// Suspense boundary required because useSearchParams() needs it in Next.js
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-[400px]">
          <div
            className="glass-floating glass-catchlight rounded-[28px] overflow-hidden p-8 flex items-center justify-center"
            style={{ minHeight: '280px' }}
          >
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'rgba(37,99,235,0.3)', borderTopColor: '#2563eb' }}
              role="status"
              aria-label="Loading"
            />
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
