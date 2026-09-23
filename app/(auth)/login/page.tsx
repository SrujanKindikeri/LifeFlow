'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff, ShieldCheck, KeyRound } from 'lucide-react'
import { loginSchema, type LoginInput } from '@/lib/validations'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { OtpInput } from '@/components/ui/OtpInput'
import { useToast } from '@/components/ui/Toast'

// ── Step types ─────────────────────────────────────────────────────────────────
type Step = 'credentials' | 'email-not-verified' | '2fa' | '2fa-email' | 'account-deleted'

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { success, error, info, warning } = useToast()

  // Show a one-time banner when the user is redirected here after session expiry
  useEffect(() => {
    if (searchParams.get('reason') === 'session_expired') {
      warning('Your session expired due to inactivity. Please log in again.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [step, setStep]               = useState<Step>('credentials')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]         = useState(false)

  // Stored from credentials step, used in email-not-verified step
  const [unverifiedEmail, setUnverifiedEmail] = useState('')

  // Account-deleted recovery state
  const [recoveryEmail,    setRecoveryEmail]    = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [deletedAt,        setDeletedAt]        = useState<string | null>(null)
  const [permanentAt,      setPermanentAt]      = useState<string | null>(null)
  const [restoring,        setRestoring]        = useState(false)

  // 2FA TOTP state
  const [totpCode, setTotpCode]           = useState('')
  const [totpLoading, setTotpLoading]     = useState(false)
  const [showRecovery, setShowRecovery]   = useState(false)
  const [recoveryCode, setRecoveryCode]   = useState('')

  // 2FA Email OTP state
  const [emailOtpCode,    setEmailOtpCode]    = useState('')
  const [emailOtpLoading, setEmailOtpLoading] = useState(false)
  const [emailOtpError,   setEmailOtpError]   = useState<string | null>(null)
  const [emailMasked,     setEmailMasked]     = useState('')
  const [emailOtpExpiresAt, setEmailOtpExpiresAt] = useState<string | null>(null)
  const [emailResending,  setEmailResending]  = useState(false)
  const [emailResendCooldown, setEmailResendCooldown] = useState(0)
  const emailResendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown for email OTP
  const [emailOtpCountdown, setEmailOtpCountdown] = useState(0)

  function startEmailResendCooldown() {
    setEmailResendCooldown(60)
    if (emailResendTimerRef.current) clearInterval(emailResendTimerRef.current)
    emailResendTimerRef.current = setInterval(() => {
      setEmailResendCooldown((v) => {
        if (v <= 1) { clearInterval(emailResendTimerRef.current!); return 0 }
        return v - 1
      })
    }, 1000)
  }

  function startEmailOtpCountdown(expiresAt: string) {
    setEmailOtpExpiresAt(expiresAt)
    function tick() {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setEmailOtpCountdown(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    // store for cleanup — attach to ref re-used below
    emailResendTimerRef.current = id
  }

  function formatCountdown(secs: number) {
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
  }

  // Resend state (for email verification resend)
  const [resending, setResending]         = useState(false)

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  // ── Step 1: credentials ────────────────────────────────────────────────────
  async function onSubmit(data: LoginInput) {
    if (loading) return
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      const json = await res.json()

      if (!res.ok) {
        if (json.code === 'ACCOUNT_NOT_FOUND') {
          error("No account found. Let's create one for you.")
          setTimeout(() => {
            router.push(`/signup?email=${encodeURIComponent(data.email)}`)
          }, 1200)
          return
        }
        if (json.code === 'EMAIL_NOT_VERIFIED') {
          setUnverifiedEmail(data.email.toLowerCase())
          setStep('email-not-verified')
          return
        }
        if (json.code === 'ACCOUNT_DELETED') {
          // Account is in the 30-day recovery window — show restore screen.
          // We store the email+password so the user can restore without re-typing.
          setRecoveryEmail(data.email.toLowerCase())
          setRecoveryPassword(data.password)
          setDeletedAt(json.deletedAt ?? null)
          setPermanentAt(json.scheduledPermanentDeletionAt ?? null)
          setStep('account-deleted')
          return
        }
        if (res.status === 429) {
          error(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        error(json.error ?? 'Invalid email or password.')
        return
      }

      // Server signals that TOTP is required
      if (json.twoFactorRequired) {
        if (json.twoFactorMethod === 'email_otp') {
          // Email OTP 2FA — go to dedicated OTP screen
          setEmailMasked(json.maskedEmail ?? '')
          setEmailOtpCode('')
          setEmailOtpError(null)
          if (json.maskedEmail) {
            // Start a 10-minute countdown (600 s) if expiresAt not provided
            startEmailOtpCountdown(
              json.otpExpiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString()
            )
          }
          startEmailResendCooldown()
          setStep('2fa-email')
          return
        }
        // TOTP / Google Authenticator
        setStep('2fa')
        info('Enter the 6-digit code from your authenticator app.')
        return
      }

      success('Welcome back!')
      // Use a full browser navigation instead of router.push so the session
      // cookie set by the login API is guaranteed to be in the browser cookie
      // jar before the /app/dashboard request hits the proxy.  router.push +
      // router.refresh() is a client-side RSC cycle that can race with the
      // Set-Cookie header, causing the proxy to see no valid session and loop.
      window.location.assign('/app/dashboard')
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: 2FA TOTP ───────────────────────────────────────────────────────
  async function onVerify2fa() {
    const code = showRecovery ? recoveryCode.trim() : totpCode.trim()
    if (!code) {
      error(showRecovery ? 'Please enter your recovery code.' : 'Please enter the 6-digit code.')
      return
    }
    setTotpLoading(true)
    try {
      const res  = await fetch('/api/auth/verify-2fa', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, isRecovery: showRecovery }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          error(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        if (res.status === 401 && json.error?.includes('expired')) {
          error('Session expired. Please log in again.')
          setStep('credentials')
          setTotpCode('')
          setRecoveryCode('')
          setShowRecovery(false)
          return
        }
        error(json.error ?? 'Invalid code. Please try again.')
        return
      }

      success('Welcome back!')
      // Full browser navigation for the same reason as the credentials step:
      // guarantees the session cookie is flushed to the browser before the
      // /app/dashboard request is made.
      window.location.assign('/app/dashboard')
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setTotpLoading(false)
    }
  }

  // ── Resend verification email ──────────────────────────────────────────────
  async function handleResend() {
    if (!unverifiedEmail) return
    setResending(true)
    try {
      const res  = await fetch('/api/auth/resend-verification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: unverifiedEmail }),
      })
      const json = await res.json()
      if (res.status === 429) {
        error(json.error ?? 'Too many requests. Please wait.')
        return
      }
      success(json.message ?? 'Verification email sent. Check your inbox.')
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setResending(false)
    }
  }

  // ── Step: Email OTP 2FA ────────────────────────────────────────────────────
  async function onVerifyEmailOtp() {
    if (emailOtpCode.length !== 6) {
      setEmailOtpError('Please enter the 6-digit verification code.')
      return
    }
    setEmailOtpLoading(true)
    setEmailOtpError(null)
    try {
      const res  = await fetch('/api/auth/2fa/email/login-verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ otp: emailOtpCode }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          setEmailOtpError(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        if (json.code === 'OTP_MAX_ATTEMPTS') {
          setEmailOtpError('Too many incorrect attempts. Please log in again.')
          setTimeout(() => { setStep('credentials'); setEmailOtpCode(''); setEmailOtpError(null) }, 2500)
          return
        }
        if (json.code === 'OTP_EXPIRED') {
          setEmailOtpError('Code expired. Click "Resend code" to get a new one.')
          setEmailOtpCode('')
          return
        }
        if (json.code === 'OTP_INVALID' && typeof json.attemptsLeft === 'number') {
          setEmailOtpError(
            json.attemptsLeft === 1
              ? 'Incorrect code. 1 attempt remaining.'
              : `Incorrect code. ${json.attemptsLeft} attempts remaining.`
          )
          setEmailOtpCode('')
          return
        }
        if (res.status === 401 && json.error?.toLowerCase().includes('session')) {
          setEmailOtpError('Session expired. Please log in again.')
          setTimeout(() => setStep('credentials'), 1800)
          return
        }
        setEmailOtpError(json.error ?? 'Verification failed. Please try again.')
        setEmailOtpCode('')
        return
      }

      success('Welcome back!')
      window.location.assign('/app/dashboard')
    } catch {
      setEmailOtpError('Something went wrong. Please try again.')
    } finally {
      setEmailOtpLoading(false)
    }
  }

  async function handleEmailResend() {
    if (emailResendCooldown > 0 || emailResending) return
    setEmailResending(true)
    setEmailOtpError(null)
    try {
      const res  = await fetch('/api/auth/2fa/email/resend', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ purpose: '2fa_login' }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429 || json.code === 'OTP_COOLDOWN') {
          error(json.error ?? 'Please wait before requesting another code.')
          return
        }
        error(json.error ?? 'Failed to resend code. Please try again.')
        return
      }

      setEmailOtpCode('')
      if (json.otpExpiresAt) {
        if (emailResendTimerRef.current) clearInterval(emailResendTimerRef.current)
        startEmailOtpCountdown(json.otpExpiresAt)
      }
      startEmailResendCooldown()
    } catch {
      error('Failed to resend code. Please try again.')
    } finally {
      setEmailResending(false)
    }
  }

  // ── Restore deleted account ────────────────────────────────────────────────
  async function handleRestore() {    if (restoring) return
    setRestoring(true)
    try {
      const res  = await fetch('/api/auth/restore-account', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: recoveryEmail, password: recoveryPassword }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 403 && json.code === 'RECOVERY_WINDOW_EXPIRED') {
          error('The 30-day recovery window has expired. This account can no longer be restored.')
          setStep('credentials')
          return
        }
        if (res.status === 429) {
          error(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        error(json.error ?? 'Unable to restore account. Please try again.')
        return
      }

      success('Your account has been restored. Welcome back!')
      window.location.assign('/app/dashboard')
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setRestoring(false)
    }
  }

  // ── Card wrapper ───────────────────────────────────────────────────────────
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

        <AnimatePresence mode="wait">
          {/* ── Credentials step ──────────────────────────────────────────── */}
          {step === 'credentials' && (
            <motion.div
              key="credentials"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2 }}
              className="auth-card-pad"
            >
              <div className="flex flex-col items-center mb-8">
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1,   opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-5"
                  style={{
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
                    border: '1px solid rgba(37,99,235,0.18)',
                    boxShadow: '0 4px 20px rgba(37,99,235,0.12)',
                  }}
                >
                  ⚡
                </motion.div>
                <h1 className="text-[22px] font-bold tracking-tight mb-1"
                  style={{ color: 'var(--text-primary)' }}>
                  Welcome back
                </h1>
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  Sign in to continue to LifeFlow
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <GlassInput
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  leftIcon={<Mail size={14} />}
                  error={errors.email?.message}
                  {...register('email')}
                />
                <GlassInput
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  autoComplete="current-password"
                  leftIcon={<Lock size={14} />}
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

                <div className="flex justify-end">
                  <Link
                    href="/forgot-password"
                    className="text-[12px] font-medium transition-colors"
                    style={{ color: 'var(--accent)' }}
                  >
                    Forgot password?
                  </Link>
                </div>

                <GlassButton
                  type="submit"
                  variant="primary"
                  fullWidth
                  size="lg"
                  loading={loading}
                  className="mt-2"
                >
                  Sign in
                </GlassButton>
              </form>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              <p className="text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="font-semibold" style={{ color: 'var(--accent)' }}>
                  Sign up
                </Link>
              </p>
            </motion.div>
          )}

          {/* ── Email not verified step ───────────────────────────────────── */}
          {step === 'email-not-verified' && (
            <motion.div
              key="not-verified"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="auth-card-pad"
            >
              <div className="flex flex-col items-center mb-8">
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1,   opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                  style={{
                    background: 'rgba(234,179,8,0.10)',
                    border: '1px solid rgba(234,179,8,0.25)',
                    color: '#b45309',
                  }}
                >
                  <Mail size={26} />
                </motion.div>
                <h1 className="text-[20px] font-bold tracking-tight text-center mb-2"
                  style={{ color: 'var(--text-primary)' }}>
                  Verify your email
                </h1>
                <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Please verify your email before logging in. Check your inbox for the verification link.
                </p>
              </div>

              {unverifiedEmail && (
                <p className="text-center text-[13px] font-medium mb-5 break-all"
                  style={{ color: 'var(--text-primary)' }}>
                  {unverifiedEmail}
                </p>
              )}

              <div className="space-y-3">
                <GlassButton
                  variant="primary"
                  fullWidth
                  size="lg"
                  loading={resending}
                  onClick={handleResend}
                >
                  Resend verification email
                </GlassButton>

                <GlassButton
                  variant="ghost"
                  fullWidth
                  size="md"
                  onClick={() => setStep('credentials')}
                >
                  Back to Sign In
                </GlassButton>
              </div>
            </motion.div>
          )}

          {/* ── Account deleted / recovery step ──────────────────────────── */}
          {step === 'account-deleted' && (
            <motion.div
              key="account-deleted"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="auth-card-pad"
            >
              <div className="flex flex-col items-center mb-7">
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1,   opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-[26px]"
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.20)',
                  }}
                >
                  🗑️
                </motion.div>
                <h1 className="text-[20px] font-bold tracking-tight text-center mb-2"
                  style={{ color: 'var(--text-primary)' }}>
                  Account scheduled for deletion
                </h1>
                <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Your LifeFlow account is in the 30-day recovery window.
                  You can restore it and keep all your data.
                </p>
              </div>

              {/* Timeline info box */}
              {(deletedAt || permanentAt) && (
                <div className="rounded-xl mb-5 overflow-hidden"
                  style={{
                    background: 'rgba(254,252,232,0.8)',
                    border: '1px solid rgba(234,179,8,0.30)',
                  }}>
                  <div className="px-4 py-3 flex flex-col gap-2">
                    {deletedAt && (
                      <div className="flex justify-between items-center">
                        <span className="text-[12px] font-semibold" style={{ color: '#92400e' }}>
                          Account deleted
                        </span>
                        <span className="text-[12px]" style={{ color: '#78350f' }}>
                          {new Date(deletedAt).toLocaleDateString('en-US', {
                            year: 'numeric', month: 'long', day: 'numeric',
                          })}
                        </span>
                      </div>
                    )}
                    {permanentAt && (
                      <div className="flex justify-between items-center">
                        <span className="text-[12px] font-semibold" style={{ color: '#92400e' }}>
                          Permanent deletion
                        </span>
                        <span className="text-[12px] font-semibold" style={{ color: '#b91c1c' }}>
                          {new Date(permanentAt).toLocaleDateString('en-US', {
                            year: 'numeric', month: 'long', day: 'numeric',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <GlassButton
                  variant="primary"
                  fullWidth
                  size="lg"
                  loading={restoring}
                  onClick={handleRestore}
                >
                  Restore My Account
                </GlassButton>

                <GlassButton
                  variant="ghost"
                  fullWidth
                  size="md"
                  onClick={() => {
                    setStep('credentials')
                    setRecoveryEmail('')
                    setRecoveryPassword('')
                  }}
                  disabled={restoring}
                >
                  Back to Sign In
                </GlassButton>
              </div>

              <p className="text-[11px] text-center mt-5 leading-relaxed"
                style={{ color: 'var(--text-faint)' }}>
                After the permanent deletion date, your account and all data
                will be irreversibly deleted and cannot be recovered.
              </p>
            </motion.div>
          )}

          {/* ── 2FA step ──────────────────────────────────────────────────── */}
          {step === '2fa' && (
            <motion.div
              key="2fa"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="auth-card-pad"
            >
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
                  <ShieldCheck size={26} />
                </motion.div>
                <h1 className="text-[20px] font-bold tracking-tight text-center mb-2"
                  style={{ color: 'var(--text-primary)' }}>
                  Two-factor authentication
                </h1>
                <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
                  {showRecovery
                    ? 'Enter one of your recovery codes.'
                    : 'Enter the 6-digit code from your Google Authenticator app.'}
                </p>
              </div>

              <div className="space-y-4">
                {!showRecovery ? (
                  <GlassInput
                    label="Authenticator code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    leftIcon={<ShieldCheck size={14} />}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                ) : (
                  <GlassInput
                    label="Recovery code"
                    type="text"
                    placeholder="20-character code"
                    autoComplete="off"
                    leftIcon={<KeyRound size={14} />}
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                  />
                )}

                <GlassButton
                  variant="primary"
                  fullWidth
                  size="lg"
                  loading={totpLoading}
                  onClick={onVerify2fa}
                >
                  Verify
                </GlassButton>

                <button
                  type="button"
                  className="w-full text-center text-[13px] transition-colors py-1"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => {
                    setShowRecovery((v) => !v)
                    setTotpCode('')
                    setRecoveryCode('')
                  }}
                >
                  {showRecovery ? 'Use authenticator app instead' : 'Use a recovery code instead'}
                </button>

                <button
                  type="button"
                  className="w-full text-center text-[12px] transition-colors py-1"
                  style={{ color: 'var(--text-muted)' }}
                  onClick={() => {
                    setStep('credentials')
                    setTotpCode('')
                    setRecoveryCode('')
                    setShowRecovery(false)
                  }}
                >
                  ← Back to Sign In
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Email OTP 2FA step ─────────────────────────────────────────── */}
          {step === '2fa-email' && (
            <motion.div
              key="2fa-email"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="auth-card-pad"
            >
              <div className="flex flex-col items-center mb-6">
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
                  <ShieldCheck size={26} />
                </motion.div>
                <h1 className="text-[20px] font-bold tracking-tight text-center mb-1"
                  style={{ color: 'var(--text-primary)' }}>
                  Verify your identity
                </h1>
                <p className="text-[13px] text-center mb-1" style={{ color: 'var(--text-muted)' }}>
                  Two-factor authentication is enabled for your LifeFlow account.
                </p>
                {emailMasked && (
                  <p className="text-[13px] text-center" style={{ color: 'var(--text-secondary)' }}>
                    We sent a verification code to{' '}
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {emailMasked}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-4">
                <OtpInput
                  value={emailOtpCode}
                  onChange={(v) => { setEmailOtpCode(v); setEmailOtpError(null) }}
                  disabled={emailOtpLoading}
                  hasError={!!emailOtpError}
                  onSubmit={emailOtpCode.length === 6 ? onVerifyEmailOtp : undefined}
                />

                {emailOtpError && (
                  <p className="text-[12px] text-center" style={{ color: '#dc2626' }} role="alert">
                    {emailOtpError}
                  </p>
                )}

                {emailOtpCountdown > 0 ? (
                  <p className="text-[12px] text-center" style={{ color: 'var(--text-muted)' }}>
                    Code expires in{' '}
                    <span className="font-mono font-semibold">{formatCountdown(emailOtpCountdown)}</span>
                  </p>
                ) : (
                  <p className="text-[12px] text-center" style={{ color: '#dc2626' }}>
                    Code expired — click &ldquo;Resend code&rdquo; to get a new one.
                  </p>
                )}

                <GlassButton
                  variant="primary"
                  fullWidth
                  size="lg"
                  loading={emailOtpLoading}
                  disabled={emailOtpCode.length !== 6 || emailOtpCountdown === 0}
                  onClick={onVerifyEmailOtp}
                >
                  Verify &amp; Sign In
                </GlassButton>

                <button
                  type="button"
                  className="w-full text-center text-[13px] transition-colors py-1 disabled:opacity-40"
                  style={{ color: 'var(--accent)' }}
                  onClick={handleEmailResend}
                  disabled={emailResendCooldown > 0 || emailResending}
                >
                  {emailResending
                    ? 'Sending…'
                    : emailResendCooldown > 0
                      ? `Resend code (${emailResendCooldown}s)`
                      : 'Resend code'}
                </button>

                <button
                  type="button"
                  className="w-full text-center text-[12px] transition-colors py-1"
                  style={{ color: 'var(--text-muted)' }}
                  onClick={() => {
                    setStep('credentials')
                    setEmailOtpCode('')
                    setEmailOtpError(null)
                    if (emailResendTimerRef.current) clearInterval(emailResendTimerRef.current)
                  }}
                >
                  ← Back to Sign In
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
