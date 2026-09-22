'use client'

import {
  Suspense,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye,
  EyeOff,
  ArrowLeft,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

// ── Constants ─────────────────────────────────────────────────────────────────

const OTP_DIGITS      = 6
const RESEND_COOLDOWN = 60         // seconds

// ── Page phase types ──────────────────────────────────────────────────────────

type PageState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'expired' }
  | { phase: 'gone' }
  | { phase: 'confirm'; name: string; deletedAt: string | null; scheduledPermanentDeletionAt: string }
  | {
      phase: 'otp'
      name: string
      maskedEmail: string
      otpExpiresAt: string
      deletedAt: string | null
      scheduledPermanentDeletionAt: string
    }
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
      <div
        className="p-8 flex flex-col items-center justify-center"
        style={{ minHeight: '280px' }}
      >
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

// ── Invalid token ─────────────────────────────────────────────────────────────

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
            This restoration link is invalid or has already been used. Each
            link is single-use — you&apos;ll need to delete your account again
            to receive a new one.
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

// ── Expired token ─────────────────────────────────────────────────────────────

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
            The 30-day recovery window has closed and this account can no
            longer be restored.
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

// ── Account permanently gone ──────────────────────────────────────────────────

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
            Your account recovery period has expired. This account can no
            longer be restored.
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

// ── Success ───────────────────────────────────────────────────────────────────

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

// ── OTP digit input component ─────────────────────────────────────────────────

interface OtpInputProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  error?: boolean
}

function OtpInput({ value, onChange, disabled, error }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Sync external value → individual boxes
  const digits = value.padEnd(OTP_DIGITS, '').slice(0, OTP_DIGITS).split('')

  function focusBox(index: number) {
    inputRefs.current[index]?.focus()
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[index] && digits[index] !== ' ') {
        // Clear current box
        const next = digits.map((d, i) => (i === index ? '' : d)).join('').replace(/ /g, '')
        onChange(next.padEnd(index, digits.slice(0, index).join('')))
        // rebuild: keep all digits up to index-1, drop current
        const arr = value.split('')
        arr[index] = ''
        onChange(arr.join('').replace(/[^0-9]/g, ''))
      } else if (index > 0) {
        // Move back and clear previous
        const arr = value.split('')
        arr[index - 1] = ''
        onChange(arr.join('').replace(/[^0-9]/g, ''))
        focusBox(index - 1)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusBox(index - 1)
    } else if (e.key === 'ArrowRight' && index < OTP_DIGITS - 1) {
      focusBox(index + 1)
    }
  }

  function handleInput(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    if (!raw) return

    if (raw.length > 1) {
      // Paste / auto-fill: distribute digits starting from this box
      const arr  = value.split('').filter(c => /\d/.test(c))
      const pasted = raw.slice(0, OTP_DIGITS)
      // Place pasted digits starting at current index, fill remaining from existing
      const result: string[] = Array(OTP_DIGITS).fill('')
      for (let i = 0; i < OTP_DIGITS; i++) result[i] = arr[i] ?? ''
      for (let i = 0; i < pasted.length && index + i < OTP_DIGITS; i++) {
        result[index + i] = pasted[i]
      }
      const joined = result.join('')
      onChange(joined)
      const nextFocus = Math.min(index + pasted.length, OTP_DIGITS - 1)
      focusBox(nextFocus)
      return
    }

    // Single digit
    const arr  = value.split('').slice(0, OTP_DIGITS)
    while (arr.length < OTP_DIGITS) arr.push('')
    arr[index] = raw
    onChange(arr.join('').replace(/[^0-9]/g, '').slice(0, OTP_DIGITS))
    if (index < OTP_DIGITS - 1) focusBox(index + 1)
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, OTP_DIGITS)
    if (!pasted) return
    onChange(pasted.padEnd(OTP_DIGITS, value.slice(pasted.length)).slice(0, OTP_DIGITS))
    const nextFocus = Math.min(pasted.length, OTP_DIGITS - 1)
    focusBox(nextFocus)
  }

  return (
    <div
      className="flex items-center justify-center gap-2"
      role="group"
      aria-label="One-time verification code"
    >
      {Array.from({ length: OTP_DIGITS }).map((_, i) => {
        const digit = value[i] ?? ''
        return (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={OTP_DIGITS}     // allow paste on mobile
            value={digit}
            disabled={disabled}
            aria-label={`Digit ${i + 1} of ${OTP_DIGITS}`}
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            className="text-center text-[22px] font-bold rounded-xl transition-all outline-none select-none"
            style={{
              width:        '44px',
              height:       '52px',
              background:   error
                ? 'rgba(239,68,68,0.06)'
                : digit
                  ? 'rgba(37,99,235,0.06)'
                  : 'rgba(15,23,42,0.04)',
              border: error
                ? '1.5px solid rgba(239,68,68,0.50)'
                : digit
                  ? '1.5px solid rgba(37,99,235,0.35)'
                  : '1.5px solid rgba(15,23,42,0.14)',
              color:        error ? '#dc2626' : 'var(--text-primary)',
              caretColor:   'transparent',
              boxShadow:    digit && !error
                ? '0 0 0 3px rgba(37,99,235,0.10)'
                : 'none',
              opacity:      disabled ? 0.55 : 1,
            }}
            onChange={e => handleInput(i, e)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={e => e.target.select()}
          />
        )
      })}
    </div>
  )
}

// ── OTP countdown timer hook ──────────────────────────────────────────────────

function useCountdown(targetIso: string | null) {
  const [secsLeft, setSecsLeft] = useState<number>(0)

  useEffect(() => {
    if (!targetIso) { setSecsLeft(0); return }

    function tick() {
      const diff = Math.max(0, Math.floor((new Date(targetIso!).getTime() - Date.now()) / 1000))
      setSecsLeft(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  return secsLeft
}

// ── Main content ──────────────────────────────────────────────────────────────

function RestoreAccountContent() {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const { error: toastError, success: toastSuccess } = useToast()

  const rawToken = searchParams.get('token') ?? ''

  const [state, setState]             = useState<PageState>({ phase: 'loading' })
  const [password, setPassword]       = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [pwError, setPwError]         = useState('')

  // OTP phase state
  const [otpValue, setOtpValue]       = useState('')
  const [otpError, setOtpError]       = useState('')
  const [verifying, setVerifying]     = useState(false)
  const [resendSecsLeft, setResendSecsLeft] = useState(0)
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // OTP expiry countdown
  const otpExpiresAt  = state.phase === 'otp' ? state.otpExpiresAt : null
  const otpSecsLeft   = useCountdown(otpExpiresAt)
  const otpMinutes    = String(Math.floor(otpSecsLeft / 60)).padStart(2, '0')
  const otpSeconds    = String(otpSecsLeft % 60).padStart(2, '0')

  // ── Kick off resend cooldown timer ────────────────────────────────────────
  function startResendCooldown() {
    setResendSecsLeft(RESEND_COOLDOWN)
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
    resendTimerRef.current = setInterval(() => {
      setResendSecsLeft(s => {
        if (s <= 1) {
          clearInterval(resendTimerRef.current!)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  useEffect(() => () => {
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
  }, [])

  // ── Validate restore token on mount ──────────────────────────────────────
  useEffect(() => {
    if (!rawToken) { setState({ phase: 'invalid' }); return }

    let cancelled = false

    async function validate() {
      try {
        const res = await fetch(
          `/api/auth/validate-restore-token?token=${encodeURIComponent(rawToken)}`,
          { method: 'GET' }
        )
        if (cancelled) return

        if (res.status === 429) { setState({ phase: 'invalid' }); return }

        let json: {
          valid?: boolean
          code?: string
          name?: string
          deletedAt?: string | null
          scheduledPermanentDeletionAt?: string
        } = {}
        try { json = await res.json() } catch { /* ignore */ }
        if (cancelled) return

        if (json.valid && json.name && json.scheduledPermanentDeletionAt) {
          setState({
            phase:                        'confirm',
            name:                         json.name,
            deletedAt:                    json.deletedAt ?? null,
            scheduledPermanentDeletionAt: json.scheduledPermanentDeletionAt,
          })
          return
        }
        if (json.code === 'TOKEN_EXPIRED') { setState({ phase: 'expired' }); return }
        if (json.code === 'ACCOUNT_GONE' || res.status === 410) {
          setState({ phase: 'gone' }); return
        }
        setState({ phase: 'invalid' })
      } catch {
        if (!cancelled) setState({ phase: 'invalid' })
      }
    }

    validate()
    return () => { cancelled = true }
  }, [rawToken])

  // ── Step 1: password → request OTP ───────────────────────────────────────
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || state.phase !== 'confirm') return
    setPwError('')

    if (!password.trim()) {
      setPwError('Please enter your password.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/restore-account/request-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: rawToken, password }),
      })

      let json: {
        maskedEmail?: string
        otpExpiresAt?: string
        error?: string
        code?: string
      } = {}
      try { json = await res.json() } catch { /* ignore */ }

      if (!res.ok) {
        if (json.code === 'TOKEN_EXPIRED')         { setState({ phase: 'expired' }); return }
        if (json.code === 'RECOVERY_WINDOW_EXPIRED' ||
            json.code === 'ACCOUNT_GONE'           ||
            res.status === 410)                    { setState({ phase: 'gone' }); return }
        if (json.code === 'INVALID_TOKEN')         { setState({ phase: 'invalid' }); return }
        if (res.status === 429 || json.code === 'OTP_COOLDOWN') {
          setPwError(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        // Wrong password or other error — stay on password screen
        setPwError(json.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Password correct, OTP sent — move to OTP screen
      const { maskedEmail = '', otpExpiresAt: exp = '' } = json
      setState(prev => ({
        phase:                        'otp',
        name:                         prev.phase === 'confirm' ? prev.name : '',
        maskedEmail,
        otpExpiresAt:                 exp,
        deletedAt:                    prev.phase === 'confirm' ? prev.deletedAt : null,
        scheduledPermanentDeletionAt: prev.phase === 'confirm'
          ? prev.scheduledPermanentDeletionAt
          : '',
      }))
      startResendCooldown()
    } catch {
      setPwError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 2: OTP → verify & restore ───────────────────────────────────────
  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (verifying || state.phase !== 'otp') return
    setOtpError('')

    if (otpValue.length < OTP_DIGITS) {
      setOtpError(`Please enter all ${OTP_DIGITS} digits.`)
      return
    }

    setVerifying(true)
    try {
      const res = await fetch('/api/auth/restore-account/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: rawToken, otp: otpValue }),
      })

      let json: {
        message?: string
        error?: string
        code?: string
        attemptsLeft?: number
      } = {}
      try { json = await res.json() } catch { /* ignore */ }

      if (!res.ok) {
        if (json.code === 'TOKEN_EXPIRED')         { setState({ phase: 'expired' }); return }
        if (json.code === 'RECOVERY_WINDOW_EXPIRED' ||
            json.code === 'ACCOUNT_GONE'           ||
            res.status === 410)                    { setState({ phase: 'gone' }); return }
        if (json.code === 'INVALID_TOKEN')         { setState({ phase: 'invalid' }); return }

        if (json.code === 'OTP_EXPIRED') {
          setOtpError('This verification code has expired. Please request a new code.')
          setOtpValue('')
          // Zero the resend cooldown so the button is immediately available
          setResendSecsLeft(0)
          if (resendTimerRef.current) { clearInterval(resendTimerRef.current); resendTimerRef.current = null }
          return
        }
        if (json.code === 'OTP_NOT_FOUND') {
          setOtpError('Your verification code has expired or was already used. Please request a new one using the button below.')
          setOtpValue('')
          // Zero the resend cooldown so the button is immediately available
          setResendSecsLeft(0)
          if (resendTimerRef.current) { clearInterval(resendTimerRef.current); resendTimerRef.current = null }
          return
        }
        if (json.code === 'OTP_MAX_ATTEMPTS') {
          setOtpError('Too many incorrect attempts. Please request a new verification code.')
          setOtpValue('')
          // Zero the resend cooldown so the button is immediately available
          setResendSecsLeft(0)
          if (resendTimerRef.current) { clearInterval(resendTimerRef.current); resendTimerRef.current = null }
          return
        }
        if (json.code === 'OTP_INVALID') {
          const suffix = typeof json.attemptsLeft === 'number'
            ? ` (${json.attemptsLeft} ${json.attemptsLeft === 1 ? 'attempt' : 'attempts'} remaining)`
            : ''
          setOtpError(`Incorrect verification code. Please try again.${suffix}`)
          setOtpValue('')
          return
        }
        if (res.status === 429) {
          setOtpError(json.error ?? 'Too many attempts. Please try again later.')
          return
        }
        setOtpError(json.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Success
      setState({ phase: 'success' })
      toastSuccess('Your LifeFlow account has been restored successfully.')
      setTimeout(() => {
        window.location.assign('/app/dashboard')
      }, 2500)
    } catch {
      setOtpError('Something went wrong. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  // ── Resend OTP ────────────────────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (resendSecsLeft > 0 || state.phase !== 'otp') return
    setOtpError('')
    setOtpValue('')

    try {
      const res = await fetch('/api/auth/restore-account/request-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Re-use password stored in closure — user never re-enters it on OTP screen.
        // Password was already verified in handlePasswordSubmit; the server will
        // re-verify it again as the trust anchor for this new OTP.
        body:    JSON.stringify({ token: rawToken, password }),
      })

      let json: {
        maskedEmail?: string
        otpExpiresAt?: string
        error?: string
        code?: string
      } = {}
      try { json = await res.json() } catch { /* ignore */ }

      if (!res.ok) {
        if (json.code === 'TOKEN_EXPIRED')         { setState({ phase: 'expired' }); return }
        if (json.code === 'RECOVERY_WINDOW_EXPIRED' ||
            json.code === 'ACCOUNT_GONE'           ||
            res.status === 410)                    { setState({ phase: 'gone' }); return }
        if (json.code === 'INVALID_TOKEN')         { setState({ phase: 'invalid' }); return }
        if (res.status === 429 || json.code === 'OTP_COOLDOWN') {
          setOtpError('Please wait before requesting another code.')
          return
        }
        setOtpError(json.error ?? 'Failed to send a new code. Please try again.')
        return
      }

      // Update OTP expiry and masked email in state
      setState(prev => prev.phase === 'otp'
        ? {
            ...prev,
            maskedEmail:  json.maskedEmail  ?? prev.maskedEmail,
            otpExpiresAt: json.otpExpiresAt ?? prev.otpExpiresAt,
          }
        : prev
      )
      startResendCooldown()
      toastSuccess(`Verification code sent to ${json.maskedEmail ?? 'your email'}.`)
    } catch {
      setOtpError('Failed to send a new code. Please try again.')
    }
  }, [resendSecsLeft, state.phase, rawToken, password, toastSuccess])

  // ── Back from OTP to password screen ────────────────────────────────────
  function handleBackToPassword() {
    if (state.phase !== 'otp') return
    const { name, deletedAt, scheduledPermanentDeletionAt } = state
    setOtpValue('')
    setOtpError('')
    setPassword('')
    setPwError('')
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
    setState({ phase: 'confirm', name, deletedAt, scheduledPermanentDeletionAt })
  }

  // ── Phase renders ─────────────────────────────────────────────────────────

  if (state.phase === 'loading') return <LoadingState />
  if (state.phase === 'invalid') return <InvalidState />
  if (state.phase === 'expired') return <ExpiredState />
  if (state.phase === 'gone')    return <GoneState />
  if (state.phase === 'success') return <SuccessState />

  // ── Password confirm phase ────────────────────────────────────────────────

  if (state.phase === 'confirm') {
    const { name, deletedAt, scheduledPermanentDeletionAt } = state
    const firstName        = name.split(' ')[0] ?? name
    const permanentDateStr = new Date(scheduledPermanentDeletionAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
    const deletedDateStr = deletedAt
      ? new Date(deletedAt).toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : null

    return (
      <Card>
        <div className="auth-card-pad">
          {/* Icon + branding */}
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
              Account scheduled for deletion
            </h1>
            <p
              className="text-[13px] text-center leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              Hi {firstName} — your account is in the 30-day recovery window.
              You can restore it and keep all your data.
            </p>
          </div>

          {/* Deletion timeline box */}
          <div
            className="rounded-xl px-4 py-3 mb-6 text-[12.5px] leading-relaxed"
            style={{
              background: 'rgba(234,179,8,0.06)',
              border:     '1px solid rgba(234,179,8,0.22)',
              color:      'var(--text-muted)',
            }}
            role="note"
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {deletedDateStr && (
                  <tr>
                    <td
                      className="text-[12.5px] font-semibold pr-3 py-0.5"
                      style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                    >
                      Account deleted
                    </td>
                    <td
                      className="text-[12.5px] py-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {deletedDateStr}
                    </td>
                  </tr>
                )}
                <tr>
                  <td
                    className="text-[12.5px] font-semibold pr-3 py-0.5"
                    style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                  >
                    Permanent deletion
                  </td>
                  <td
                    className="text-[12.5px] py-0.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {permanentDateStr}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Password form */}
          <form onSubmit={handlePasswordSubmit} className="space-y-4" noValidate>
            <GlassInput
              label="Confirm your password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your current password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={e => { setPassword(e.target.value); setPwError('') }}
              error={pwError || undefined}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
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
              {submitting ? 'Verifying…' : 'Restore My Account'}
            </GlassButton>
          </form>

          {/* Back to login */}
          <div className="flex items-center justify-center mt-6">
            <Link
              href="/login"
              className="flex items-center gap-1.5 text-[13px] font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeft size={13} />
              Back to Sign In
            </Link>
          </div>
        </div>
      </Card>
    )
  }

  // ── OTP phase ─────────────────────────────────────────────────────────────

  if (state.phase === 'otp') {
    const { maskedEmail } = state
    const otpExpired = otpSecsLeft === 0

    return (
      <Card>
        <div className="auth-card-pad">
          {/* Icon + branding */}
          <div className="flex flex-col items-center mb-6">
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
              Verify your email
            </h1>
            <p
              className="text-[13px] text-center leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              We sent a 6-digit verification code to
            </p>
            <p
              className="text-[13px] font-semibold text-center mt-0.5"
              style={{ color: 'var(--text-primary)' }}
              aria-label={`Verification code sent to ${maskedEmail}`}
            >
              {maskedEmail}
            </p>
          </div>

          {/* OTP form */}
          <form onSubmit={handleOtpSubmit} className="space-y-5" noValidate>
            <OtpInput
              value={otpValue}
              onChange={v => { setOtpValue(v); setOtpError('') }}
              disabled={verifying || otpExpired}
              error={!!otpError}
            />

            {/* Error message */}
            <AnimatePresence mode="wait">
              {otpError && (
                <motion.p
                  key={otpError}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[12.5px] text-center"
                  style={{ color: 'var(--danger, #dc2626)' }}
                  role="alert"
                  aria-live="assertive"
                >
                  {otpError}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Expiry countdown */}
            {!otpExpired ? (
              <p
                className="text-[12px] text-center"
                style={{ color: 'var(--text-muted)' }}
                aria-live="off"
              >
                Code expires in{' '}
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: otpSecsLeft < 60 ? '#dc2626' : 'var(--text-primary)' }}
                >
                  {otpMinutes}:{otpSeconds}
                </span>
              </p>
            ) : (
              <p
                className="text-[12.5px] text-center"
                style={{ color: '#dc2626' }}
                role="alert"
                aria-live="polite"
              >
                This verification code has expired. Please request a new code.
              </p>
            )}

            {/* Verify button */}
            <GlassButton
              type="submit"
              variant="primary"
              fullWidth
              size="lg"
              loading={verifying}
              disabled={otpValue.length < OTP_DIGITS || verifying || otpExpired}
            >
              {verifying ? 'Verifying…' : 'Verify & Restore'}
            </GlassButton>
          </form>

          {/* Resend + Back */}
          <div className="flex flex-col items-center gap-3 mt-5">
            {/* Resend */}
            <button
              type="button"
              onClick={handleResend}
              disabled={resendSecsLeft > 0}
              className="text-[13px] font-medium transition-colors flex items-center gap-1.5"
              style={{
                color:  resendSecsLeft > 0 ? 'var(--text-muted)' : 'var(--accent, #2563eb)',
                cursor: resendSecsLeft > 0 ? 'default' : 'pointer',
              }}
              aria-disabled={resendSecsLeft > 0}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {resendSecsLeft > 0
                ? `Resend code in ${resendSecsLeft}s`
                : 'Resend code'}
            </button>

            {/* Back to password step */}
            <button
              type="button"
              onClick={handleBackToPassword}
              className="flex items-center gap-1.5 text-[13px] font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeft size={13} aria-hidden="true" />
              Back
            </button>
          </div>
        </div>
      </Card>
    )
  }

  return null
}

// ── Suspense boundary — required because useSearchParams() suspends ────────────

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
