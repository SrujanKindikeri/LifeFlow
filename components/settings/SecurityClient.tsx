'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, ShieldOff, ShieldAlert, CheckCircle,
  Copy, Eye, EyeOff, RefreshCw, KeyRound, Lock,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { useToast } from '@/components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserSecurity {
  emailVerified: boolean
  twoFactorEnabled: boolean
  twoFactorVerifiedAt: string | null
}

type TwoFaPanel =
  | 'idle'
  | 'setup-loading'
  | 'setup-ready'
  | 'recovery-codes'
  | 'disable'
  | 'regen-codes'

// ── Main component ────────────────────────────────────────────────────────────

export function SecurityClient() {
  const { success, error, info, warning } = useToast()

  const [userData, setUserData]           = useState<UserSecurity | null>(null)
  const [loadingUser, setLoadingUser]     = useState(true)
  const [panel, setPanel]                 = useState<TwoFaPanel>('idle')
  const [codesRemaining, setCodesRemaining] = useState<number | null>(null)

  // Setup state
  const [qrCodeDataUrl, setQrCodeDataUrl]   = useState('')
  const [manualKey, setManualKey]           = useState('')
  const [showManualKey, setShowManualKey]   = useState(false)
  const [setupCode, setSetupCode]           = useState('')
  const [setupLoading, setSetupLoading]     = useState(false)

  // Recovery codes display (shown once after enable / regen)
  const [displayedCodes, setDisplayedCodes] = useState<string[]>([])
  const [codesCopied, setCodesCopied]       = useState(false)

  // Disable 2FA form
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode]         = useState('')
  const [disableShowPw, setDisableShowPw]     = useState(false)
  const [disableLoading, setDisableLoading]   = useState(false)

  // Regen codes form
  const [regenPassword, setRegenPassword] = useState('')
  const [regenCode, setRegenCode]         = useState('')
  const [regenShowPw, setRegenShowPw]     = useState(false)
  const [regenLoading, setRegenLoading]   = useState(false)

  // ── Load remaining recovery code count ───────────────────────────────────
  async function fetchCodesRemaining() {
    try {
      const res  = await fetch('/api/auth/2fa/recovery')
      const json = await res.json()
      if (res.ok) setCodesRemaining(json.codesRemaining)
    } catch {
      // Non-critical
    }
  }

  // ── Load current user security status ──────────────────────────────────────
  const loadUser = useCallback(async () => {
    setLoadingUser(true)
    try {
      const res  = await fetch('/api/auth/me')
      const json = await res.json()
      if (res.ok && json.user) {
        setUserData({
          emailVerified:      json.user.emailVerified ?? false,
          twoFactorEnabled:   json.user.twoFactorEnabled ?? false,
          twoFactorVerifiedAt: json.user.twoFactorVerifiedAt ?? null,
        })
        // Load remaining recovery code count if 2FA is enabled
        if (json.user.twoFactorEnabled) {
          fetchCodesRemaining()
        }
      }
    } catch {
      error('Failed to load security settings.')
    } finally {
      setLoadingUser(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadUser() }, [loadUser])

  // ── Start 2FA setup ────────────────────────────────────────────────────────
  async function handleStartSetup() {
    setPanel('setup-loading')
    setSetupCode('')
    setQrCodeDataUrl('')
    setManualKey('')
    try {
      const res  = await fetch('/api/auth/2fa/setup', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        error(json.error ?? 'Failed to start 2FA setup.')
        setPanel('idle')
        return
      }
      setQrCodeDataUrl(json.qrCodeDataUrl ?? '')
      setManualKey(json.manualKey ?? '')
      setPanel('setup-ready')
    } catch {
      error('Something went wrong. Please try again.')
      setPanel('idle')
    }
  }

  // ── Enable 2FA (verify first TOTP code) ───────────────────────────────────
  async function handleEnable() {
    if (!setupCode || setupCode.length !== 6) {
      error('Please enter the 6-digit code from your authenticator app.')
      return
    }
    setSetupLoading(true)
    try {
      const res  = await fetch('/api/auth/2fa/enable', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: setupCode }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429) { error(json.error ?? 'Too many attempts.'); return }
        error(json.error ?? 'Invalid code. Please try again.')
        return
      }

      // Show recovery codes exactly once
      setDisplayedCodes(json.recoveryCodes ?? [])
      setPanel('recovery-codes')
      setCodesRemaining(json.recoveryCodes?.length ?? 10)
      await loadUser()
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setSetupLoading(false)
    }
  }

  // ── Disable 2FA ────────────────────────────────────────────────────────────
  async function handleDisable() {
    if (!disablePassword || !disableCode) {
      error('Please enter your password and authenticator code.')
      return
    }
    setDisableLoading(true)
    try {
      const res  = await fetch('/api/auth/2fa/disable', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: disablePassword, code: disableCode }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429) { error(json.error ?? 'Too many attempts.'); return }
        error(json.error ?? 'Failed to disable 2FA. Check your password and code.')
        return
      }

      success('Two-factor authentication has been disabled.')
      setPanel('idle')
      setDisablePassword('')
      setDisableCode('')
      setCodesRemaining(null)
      await loadUser()
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setDisableLoading(false)
    }
  }

  // ── Regenerate recovery codes ──────────────────────────────────────────────
  async function handleRegen() {
    if (!regenPassword || !regenCode) {
      error('Please enter your password and authenticator code.')
      return
    }
    setRegenLoading(true)
    try {
      const res  = await fetch('/api/auth/2fa/recovery', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: regenPassword, code: regenCode }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 429) { error(json.error ?? 'Too many attempts.'); return }
        error(json.error ?? 'Failed to regenerate codes.')
        return
      }

      setDisplayedCodes(json.recoveryCodes ?? [])
      setPanel('recovery-codes')
      setCodesRemaining(json.recoveryCodes?.length ?? 10)
      setRegenPassword('')
      setRegenCode('')
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setRegenLoading(false)
    }
  }

  // ── Copy recovery codes ────────────────────────────────────────────────────
  function copyRecoveryCodes() {
    const text = displayedCodes.join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCodesCopied(true)
      success('Recovery codes copied to clipboard.')
      setTimeout(() => setCodesCopied(false), 3000)
    }).catch(() => {
      warning('Could not copy automatically — please copy the codes manually.')
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingUser) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin"
          style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Email verification status card ──────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: userData?.emailVerified
                  ? 'rgba(22,163,74,0.10)'
                  : 'rgba(234,179,8,0.10)',
                color: userData?.emailVerified ? '#16a34a' : '#b45309',
              }}>
              {userData?.emailVerified
                ? <CheckCircle size={20} />
                : <ShieldAlert size={20} />}
            </div>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Email verification
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {userData?.emailVerified ? 'Your email is verified.' : 'Email not yet verified.'}
              </p>
            </div>
          </div>
          <StatusBadge active={userData?.emailVerified ?? false}
            activeLabel="Verified" inactiveLabel="Unverified" />
        </div>
      </SectionCard>

      {/* ── Two-factor authentication card ──────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: userData?.twoFactorEnabled
                  ? 'rgba(37,99,235,0.10)'
                  : 'rgba(100,116,139,0.10)',
                color: userData?.twoFactorEnabled ? '#2563eb' : '#64748b',
              }}>
              {userData?.twoFactorEnabled ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
            </div>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Two-factor authentication
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {userData?.twoFactorEnabled
                  ? 'Google Authenticator is enabled.'
                  : 'Add a second layer of security to your account.'}
              </p>
            </div>
          </div>
          <StatusBadge active={userData?.twoFactorEnabled ?? false}
            activeLabel="Enabled" inactiveLabel="Disabled" />
        </div>

        {/* Recovery codes remaining warning */}
        {userData?.twoFactorEnabled && codesRemaining !== null && codesRemaining <= 3 && (
          <div className="mb-4 rounded-xl p-3"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.20)' }}>
            <p className="text-[12px] font-medium" style={{ color: '#b45309' }}>
              ⚠ Only {codesRemaining} recovery code{codesRemaining !== 1 ? 's' : ''} remaining.
              Consider regenerating them.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {!userData?.twoFactorEnabled ? (
            <GlassButton
              variant="primary"
              size="sm"
              icon={<ShieldCheck size={14} />}
              loading={panel === 'setup-loading'}
              onClick={handleStartSetup}
              disabled={!userData?.emailVerified}
            >
              Enable 2FA
            </GlassButton>
          ) : (
            <>
              <GlassButton
                variant="ghost"
                size="sm"
                icon={<KeyRound size={14} />}
                onClick={() => {
                  setPanel('regen-codes')
                  setRegenPassword('')
                  setRegenCode('')
                }}
              >
                Regenerate recovery codes
              </GlassButton>
              <GlassButton
                variant="danger"
                size="sm"
                icon={<ShieldOff size={14} />}
                onClick={() => {
                  setPanel('disable')
                  setDisablePassword('')
                  setDisableCode('')
                }}
              >
                Disable 2FA
              </GlassButton>
            </>
          )}
        </div>

        {!userData?.emailVerified && !userData?.twoFactorEnabled && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            You must verify your email before enabling two-factor authentication.
          </p>
        )}
      </SectionCard>

      {/* ── Panels (animated) ─────────────────────────────────────────────────── */}
      <AnimatePresence>

        {/* Setup ready — QR code */}
        {panel === 'setup-ready' && (
          <PanelCard key="setup-ready">
            <h2 className="text-[16px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Scan QR code
            </h2>
            <p className="text-[13px] mb-5" style={{ color: 'var(--text-muted)' }}>
              Open Google Authenticator, tap <strong>+</strong>, then scan the QR code below.
            </p>

            {/* QR code */}
            {qrCodeDataUrl ? (
              <div className="flex justify-center mb-5">
                <div className="rounded-2xl overflow-hidden p-3 w-[min(216px,100%)]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCodeDataUrl} alt="2FA QR code" width={200} height={200}
                    className="block w-full h-auto" />
                </div>
              </div>
            ) : (
              <div className="flex justify-center mb-5">
                <div className="w-[min(200px,100%)] aspect-square rounded-2xl flex items-center justify-center"
                  style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}>
                  <p className="text-[12px] text-center px-4" style={{ color: 'var(--text-muted)' }}>
                    QR code unavailable — use the manual key below.
                  </p>
                </div>
              </div>
            )}

            {/* Manual key */}
            <div className="mb-5">
              <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                Can&apos;t scan? Enter this key manually:
              </p>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{
                  background: 'var(--glass-subtle-bg)',
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace',
                }}>
                <span className="flex-1 text-[13px] break-all select-all"
                  style={{ color: 'var(--text-primary)', filter: showManualKey ? 'none' : 'blur(5px)' }}>
                  {manualKey}
                </span>
                <button
                  type="button"
                  onClick={() => setShowManualKey((v) => !v)}
                  className="flex-shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label={showManualKey ? 'Hide key' : 'Show key'}
                >
                  {showManualKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Verify code input */}
            <GlassInput
              label="Enter the 6-digit code to confirm"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              autoComplete="one-time-code"
              leftIcon={<ShieldCheck size={14} />}
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />

            <div className="flex gap-2 mt-4">
              <GlassButton
                variant="primary"
                size="md"
                loading={setupLoading}
                onClick={handleEnable}
                className="flex-1"
              >
                Enable 2FA
              </GlassButton>
              <GlassButton
                variant="ghost"
                size="md"
                onClick={() => { setPanel('idle'); setManualKey(''); setQrCodeDataUrl('') }}
              >
                Cancel
              </GlassButton>
            </div>
          </PanelCard>
        )}

        {/* Recovery codes — shown once */}
        {panel === 'recovery-codes' && (
          <PanelCard key="recovery-codes">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound size={18} style={{ color: '#2563eb' }} />
              <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>
                Save your recovery codes
              </h2>
            </div>
            <div className="mb-4 rounded-xl p-3"
              style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.20)' }}>
              <p className="text-[12px] font-medium" style={{ color: '#b45309' }}>
                ⚠ Save these codes now. They will not be shown again.
                Each code can only be used once.
              </p>
            </div>

            {/* Code grid */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {displayedCodes.map((code, i) => (
                <div key={i}
                  className="rounded-xl px-3 py-2 text-center font-mono text-[13px] select-all"
                  style={{
                    background: 'var(--glass-subtle-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    letterSpacing: '0.08em',
                  }}>
                  {code}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <GlassButton
                variant="secondary"
                size="md"
                icon={<Copy size={14} />}
                onClick={copyRecoveryCodes}
                className="flex-1"
              >
                {codesCopied ? 'Copied!' : 'Copy all'}
              </GlassButton>
              <GlassButton
                variant="primary"
                size="md"
                onClick={() => {
                  setPanel('idle')
                  setDisplayedCodes([])
                }}
              >
                Done
              </GlassButton>
            </div>
          </PanelCard>
        )}

        {/* Disable 2FA */}
        {panel === 'disable' && (
          <PanelCard key="disable">
            <div className="flex items-center gap-2 mb-4">
              <ShieldOff size={18} style={{ color: '#dc2626' }} />
              <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>
                Disable 2FA
              </h2>
            </div>
            <p className="text-[13px] mb-4" style={{ color: 'var(--text-muted)' }}>
              Enter your password and a current authenticator code to disable two-factor authentication.
            </p>

            <div className="space-y-3">
              <GlassInput
                label="Current password"
                type={disableShowPw ? 'text' : 'password'}
                placeholder="Your password"
                autoComplete="current-password"
                leftIcon={<Lock size={14} />}
                rightIcon={
                  <button type="button" onClick={() => setDisableShowPw((v) => !v)}
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={disableShowPw ? 'Hide password' : 'Show password'}>
                    {disableShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
              <GlassInput
                label="Authenticator code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                autoComplete="one-time-code"
                leftIcon={<ShieldCheck size={14} />}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>

            <div className="flex gap-2 mt-4">
              <GlassButton
                variant="danger"
                size="md"
                loading={disableLoading}
                onClick={handleDisable}
                className="flex-1"
              >
                Disable 2FA
              </GlassButton>
              <GlassButton
                variant="ghost"
                size="md"
                onClick={() => setPanel('idle')}
              >
                Cancel
              </GlassButton>
            </div>
          </PanelCard>
        )}

        {/* Regenerate recovery codes */}
        {panel === 'regen-codes' && (
          <PanelCard key="regen-codes">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={18} style={{ color: '#2563eb' }} />
              <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>
                Regenerate recovery codes
              </h2>
            </div>
            <p className="text-[13px] mb-4" style={{ color: 'var(--text-muted)' }}>
              This will invalidate all existing recovery codes and generate 10 new ones.
              Enter your password and current authenticator code to confirm.
            </p>

            <div className="space-y-3">
              <GlassInput
                label="Current password"
                type={regenShowPw ? 'text' : 'password'}
                placeholder="Your password"
                autoComplete="current-password"
                leftIcon={<Lock size={14} />}
                rightIcon={
                  <button type="button" onClick={() => setRegenShowPw((v) => !v)}
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={regenShowPw ? 'Hide password' : 'Show password'}>
                    {regenShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
                value={regenPassword}
                onChange={(e) => setRegenPassword(e.target.value)}
              />
              <GlassInput
                label="Authenticator code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                autoComplete="one-time-code"
                leftIcon={<ShieldCheck size={14} />}
                value={regenCode}
                onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>

            <div className="flex gap-2 mt-4">
              <GlassButton
                variant="primary"
                size="md"
                loading={regenLoading}
                onClick={handleRegen}
                className="flex-1"
              >
                Regenerate codes
              </GlassButton>
              <GlassButton
                variant="ghost"
                size="md"
                onClick={() => setPanel('idle')}
              >
                Cancel
              </GlassButton>
            </div>
          </PanelCard>
        )}

      </AnimatePresence>
    </div>
  )
}

// ── Utility sub-components ────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      {children}
    </div>
  )
}

function PanelCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl p-5"
      style={{
        background: 'var(--glass-regular-bg)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(37,99,235,0.18)',
        boxShadow: '0 2px 12px rgba(37,99,235,0.08)',
      }}
    >
      {children}
    </motion.div>
  )
}

function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean
  activeLabel: string
  inactiveLabel: string
}) {
  return (
    <span
      className="text-[11px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
      style={{
        background: active ? 'rgba(22,163,74,0.10)' : 'rgba(100,116,139,0.10)',
        color:      active ? '#16a34a' : '#64748b',
        border:    `1px solid ${active ? 'rgba(22,163,74,0.20)' : 'rgba(100,116,139,0.15)'}`,
      }}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}
