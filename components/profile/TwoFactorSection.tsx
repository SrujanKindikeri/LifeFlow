'use client'

/**
 * TwoFactorSection — Email OTP 2FA management in the Profile Security section.
 *
 * Renders the current 2FA status row and controls the full enable/disable flow:
 *
 * Enable flow:
 *   1. User clicks "Enable 2FA"
 *   2. Password confirmation modal
 *   3. POST /api/auth/2fa/email/enable-request  (password → OTP emailed)
 *   4. OTP verification modal (6 boxes, timer, resend)
 *   5. POST /api/auth/2fa/email/enable-verify   (OTP → 2FA enabled)
 *   6. Success — parent notified via onStatusChange(true)
 *
 * Disable flow:
 *   1. User clicks "Disable 2FA"
 *   2. Password confirmation modal
 *   3. POST /api/auth/2fa/email/disable-request (password → OTP emailed)
 *   4. OTP verification modal
 *   5. POST /api/auth/2fa/email/disable-verify  (OTP → 2FA disabled)
 *   6. Success — parent notified via onStatusChange(false)
 *
 * CHALLENGE LIFECYCLE
 * ───────────────────
 * The server owns the challenge — it is identified entirely by the
 * authenticated session cookie.  No challengeId is passed from the browser.
 *
 * The challenge is created in step 3 and must survive until step 5.
 * The "← Back" button returns the user to the password step WITHOUT
 * invalidating the existing challenge — the same OTP remains valid.
 * Only a completely fresh submit of the password step issues a new OTP
 * (which replaces the old one atomically on the server via the resend path
 * if within the 60-second cooldown, or via enable-request otherwise).
 *
 * DOUBLE-SUBMIT PREVENTION
 * ────────────────────────
 * Both handlePasswordSubmit and handleOtpSubmit are guarded by in-flight
 * flags (pwLoading / otpLoading) that are set before the fetch and cleared
 * in the finally block.  The submit buttons are disabled while loading.
 * No duplicate requests can be issued by clicking the button repeatedly.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { ShieldCheck, ShieldOff, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { Modal } from '@/components/ui/Modal'
import { OtpInput } from '@/components/ui/OtpInput'
import { useToast } from '@/components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

type Flow = 'enable' | 'disable'
type ModalStep = 'password' | 'otp'

interface TwoFactorSectionProps {
  /** Current 2FA enabled state from the parent's user object */
  emailOtpEnabled: boolean
  /** Called after a successful enable or disable so parent can sync state */
  onStatusChange: (enabled: boolean) => void
}

// ── OTP countdown hook ────────────────────────────────────────────────────────

/** Returns seconds remaining until expiresAt, updating every second */
function useCountdown(expiresAt: string | null): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!expiresAt) { setSeconds(0); return }

    function update() {
      const diff = Math.max(0, Math.floor((new Date(expiresAt!).getTime() - Date.now()) / 1000))
      setSeconds(diff)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return seconds
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TwoFactorSection({ emailOtpEnabled, onStatusChange }: TwoFactorSectionProps) {
  const { success, error: toastError } = useToast()

  // Which flow is in progress
  const [flow,       setFlow]       = useState<Flow | null>(null)
  const [modalStep,  setModalStep]  = useState<ModalStep>('password')
  const [modalOpen,  setModalOpen]  = useState(false)

  // Password step state
  const [password,    setPassword]    = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [pwLoading,   setPwLoading]   = useState(false)
  const [pwError,     setPwError]     = useState<string | null>(null)

  // OTP step state
  const [otp,          setOtp]          = useState('')
  const [otpLoading,   setOtpLoading]   = useState(false)
  const [otpError,     setOtpError]     = useState<string | null>(null)
  const [maskedEmail,  setMaskedEmail]  = useState<string>('')
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)

  // Resend cooldown (60 s, tracked client-side for UX — server enforces independently)
  const [resending,       setResending]       = useState(false)
  const [resendCooldown,  setResendCooldown]  = useState(0)
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const otpCountdown = useCountdown(otpExpiresAt)

  // ── Reset all state ───────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setFlow(null)
    setModalStep('password')
    setModalOpen(false)
    setPassword('')
    setShowPw(false)
    setPwLoading(false)
    setPwError(null)
    setOtp('')
    setOtpLoading(false)
    setOtpError(null)
    setMaskedEmail('')
    setOtpExpiresAt(null)
    setAttemptsLeft(null)
    setResending(false)
    setResendCooldown(0)
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
  }, [])

  // Start the 60-second resend cooldown
  const startResendCooldown = useCallback(() => {
    setResendCooldown(60)
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
    resendTimerRef.current = setInterval(() => {
      setResendCooldown((v) => {
        if (v <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current)
          return 0
        }
        return v - 1
      })
    }, 1000)
  }, [])

  // Cleanup timer on unmount
  useEffect(() => () => { if (resendTimerRef.current) clearInterval(resendTimerRef.current) }, [])

  // ── Open flow ─────────────────────────────────────────────────────────────
  function openFlow(f: Flow) {
    reset()
    setFlow(f)
    setModalStep('password')
    setModalOpen(true)
  }

  // ── Step 1: Submit password ────────────────────────────────────────────────
  async function handlePasswordSubmit() {
    // Guard: must have a password and a flow; must not already be in-flight
    if (!password.trim() || !flow || pwLoading) return
    setPwLoading(true)
    setPwError(null)

    const endpoint =
      flow === 'enable'
        ? '/api/auth/2fa/email/enable-request'
        : '/api/auth/2fa/email/disable-request'

    try {
      const res  = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          setPwError(json.error ?? 'Please wait before requesting another code.')
          return
        }
        if (json.code === 'WRONG_PASSWORD') {
          setPwError('Incorrect password. Please try again.')
          return
        }
        setPwError(json.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Challenge created and confirmed on server — advance to OTP step.
      // The server has already written and confirmed the challenge in MongoDB
      // before returning 200, so the OTP step is guaranteed to find it.
      setMaskedEmail(json.maskedEmail ?? '')
      setOtpExpiresAt(json.otpExpiresAt ?? null)
      setOtp('')
      setOtpError(null)
      setAttemptsLeft(null)
      setModalStep('otp')
      startResendCooldown()
    } catch {
      setPwError('Something went wrong. Please try again.')
    } finally {
      setPwLoading(false)
    }
  }

  // ── Step 2: Submit OTP ────────────────────────────────────────────────────
  async function handleOtpSubmit() {
    // Guard: must have exactly 6 digits, a flow, and must not already be in-flight
    if (otp.length !== 6 || !flow || otpLoading) return
    setOtpLoading(true)
    setOtpError(null)

    const endpoint =
      flow === 'enable'
        ? '/api/auth/2fa/email/enable-verify'
        : '/api/auth/2fa/email/disable-verify'

    try {
      const res  = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ otp }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (json.code === 'OTP_MAX_ATTEMPTS') {
          setOtpError('Too many incorrect attempts. Please request a new verification code.')
          setOtp('')
          setAttemptsLeft(null)
          return
        }
        if (json.code === 'OTP_EXPIRED') {
          setOtpError('This code has expired. Please request a new one.')
          setOtp('')
          return
        }
        if (json.code === 'OTP_INVALID' && typeof json.attemptsLeft === 'number') {
          setAttemptsLeft(json.attemptsLeft)
          setOtpError(
            json.attemptsLeft === 1
              ? 'Incorrect code. 1 attempt remaining.'
              : `Incorrect code. ${json.attemptsLeft} attempts remaining.`
          )
          setOtp('')
          return
        }
        setOtpError(json.error ?? 'Verification failed. Please try again.')
        setOtp('')
        return
      }

      // ── Success ──────────────────────────────────────────────────────────
      const enabled = flow === 'enable'
      success(
        enabled
          ? 'Two-factor authentication has been enabled.'
          : 'Two-factor authentication has been disabled.'
      )
      onStatusChange(enabled)
      reset()
    } catch {
      setOtpError('Something went wrong. Please try again.')
      setOtp('')
    } finally {
      setOtpLoading(false)
    }
  }

  // ── Resend OTP ────────────────────────────────────────────────────────────
  async function handleResend() {
    if (!flow || resendCooldown > 0 || resending) return
    setResending(true)
    setOtpError(null)

    const purpose = flow === 'enable' ? '2fa_enable' : '2fa_disable'

    try {
      const res  = await fetch('/api/auth/2fa/email/resend', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ purpose }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429 || json.code === 'OTP_COOLDOWN') {
          toastError(json.error ?? 'Please wait before requesting another code.')
          return
        }
        toastError(json.error ?? 'Failed to resend code. Please try again.')
        return
      }

      setOtp('')
      setOtpExpiresAt(json.otpExpiresAt ?? null)
      setAttemptsLeft(null)
      startResendCooldown()
    } catch {
      toastError('Failed to resend code. Please try again.')
    } finally {
      setResending(false)
    }
  }

  // ── Go back to password step ──────────────────────────────────────────────
  // Does NOT call a server endpoint — the existing challenge remains valid in
  // MongoDB and can still be verified with the OTP that was already sent.
  // The user can re-enter their password to request a fresh OTP, which will
  // atomically replace the old one on the server.
  function handleBackToPassword() {
    setModalStep('password')
    setOtp('')
    setOtpError(null)
    setAttemptsLeft(null)
    // Keep maskedEmail and otpExpiresAt — they're still valid and will be
    // repopulated correctly when the user resubmits the password step.
    // Do NOT clear otpExpiresAt here; the server-side challenge is still live.
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isEnabled = emailOtpEnabled

  return (
    <>
      {/* ── Status row ── */}
      <div className="flex items-center justify-between gap-4 py-1">
        <div>
          <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
            Two-Factor Authentication
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {isEnabled
              ? 'Your account requires an email verification code when signing in.'
              : 'Protect your account with an additional verification code sent to your email.'}
          </p>
          {isEnabled && (
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium text-emerald-600">Enabled</span>
            </div>
          )}
          {!isEnabled && (
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--text-faint)' }}
                aria-hidden="true"
              />
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Disabled</span>
            </div>
          )}
        </div>

        {isEnabled ? (
          <GlassButton
            variant="danger"
            size="sm"
            onClick={() => openFlow('disable')}
          >
            <ShieldOff size={12} />
            Disable 2FA
          </GlassButton>
        ) : (
          <GlassButton
            variant="secondary"
            size="sm"
            onClick={() => openFlow('enable')}
          >
            <ShieldCheck size={12} />
            Enable 2FA
          </GlassButton>
        )}
      </div>

      {/* ── Modal ── */}
      <Modal
        isOpen={modalOpen}
        onClose={() => !pwLoading && !otpLoading && reset()}
        title={
          flow === 'enable'
            ? 'Enable Two-Factor Authentication'
            : 'Disable Two-Factor Authentication'
        }
        size="sm"
      >
        {/* ── Password step ── */}
        {modalStep === 'password' && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {flow === 'enable'
                ? 'Confirm your password to continue enabling Email 2FA.'
                : 'Confirm your password to continue disabling Email 2FA.'}
            </p>

            <GlassInput
              label="Password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !pwLoading && password.trim()) {
                  void handlePasswordSubmit()
                }
              }}
              autoComplete="current-password"
              leftIcon={<Lock size={13} />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              }
              error={pwError ?? undefined}
            />

            <div className="flex gap-2 justify-end pt-1">
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={pwLoading}
              >
                Cancel
              </GlassButton>
              <GlassButton
                variant="primary"
                size="sm"
                loading={pwLoading}
                onClick={() => { void handlePasswordSubmit() }}
                disabled={!password.trim() || pwLoading}
              >
                Continue
              </GlassButton>
            </div>
          </div>
        )}

        {/* ── OTP step ── */}
        {modalStep === 'otp' && (
          <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex flex-col items-center gap-1 pt-1 pb-1">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2"
                style={{
                  background: 'rgba(37,99,235,0.08)',
                  border: '1px solid rgba(37,99,235,0.16)',
                  color: '#2563eb',
                }}
              >
                <Mail size={20} />
              </div>
              <p className="text-[13px] text-center" style={{ color: 'var(--text-secondary)' }}>
                We sent a 6-digit verification code to
              </p>
              {maskedEmail && (
                <p className="text-[13px] font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
                  {maskedEmail}
                </p>
              )}
            </div>

            {/* 6-box OTP input */}
            <OtpInput
              value={otp}
              onChange={(v) => { setOtp(v); setOtpError(null) }}
              disabled={otpLoading}
              hasError={!!otpError}
              onSubmit={otp.length === 6 && !otpLoading ? () => { void handleOtpSubmit() } : undefined}
            />

            {/* Error message */}
            {otpError && (
              <p
                className="text-[12px] text-center leading-snug"
                style={{ color: 'var(--danger-text, #dc2626)' }}
                role="alert"
              >
                {otpError}
              </p>
            )}

            {/* Countdown */}
            {otpCountdown > 0 ? (
              <p className="text-[12px] text-center" style={{ color: 'var(--text-muted)' }}>
                Code expires in{' '}
                <span className="font-mono font-semibold">{formatCountdown(otpCountdown)}</span>
              </p>
            ) : (
              <p className="text-[12px] text-center" style={{ color: 'var(--danger-text, #dc2626)' }}>
                Code has expired — please request a new one.
              </p>
            )}

            {/* Verify button */}
            <GlassButton
              variant="primary"
              size="md"
              fullWidth
              loading={otpLoading}
              disabled={otp.length !== 6 || otpCountdown === 0 || otpLoading}
              onClick={() => { void handleOtpSubmit() }}
            >
              {flow === 'enable' ? 'Verify & Enable 2FA' : 'Verify & Disable 2FA'}
            </GlassButton>

            {/* Resend + Back */}
            <div className="flex items-center justify-between pt-0">
              <button
                type="button"
                className="text-[12px] transition-colors disabled:opacity-40"
                style={{ color: 'var(--accent)' }}
                onClick={() => { void handleResend() }}
                disabled={resendCooldown > 0 || resending}
              >
                {resending
                  ? 'Sending…'
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : 'Resend code'}
              </button>

              <button
                type="button"
                className="text-[12px] transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onClick={handleBackToPassword}
              >
                ← Back
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
