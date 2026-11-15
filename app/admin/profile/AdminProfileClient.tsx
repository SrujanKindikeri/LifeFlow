'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Shield, Calendar, Clock, Key,
  LogOut, Save, Eye, EyeOff, CheckCircle, AlertCircle,
  Edit3, X,
} from 'lucide-react'
import { AdminCard, SectionHeader, LoadingSpinner, StatusBadge } from '@/components/admin/AdminCard'
import type { AdminRole } from '@/models/AdminUser'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminProfile {
  adminId:     string
  name:        string
  email:       string
  role:        AdminRole
  isActive:    boolean
  avatar:      string | null
  createdAt:   string
  updatedAt:   string
  lastLoginAt: string | null
  createdBy:   string
}

interface AdminProfileClientProps {
  initialAdminId: string
  initialName:    string
  initialEmail:   string
  initialRole:    AdminRole
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  support:     'Support',
  auditor:     'Auditor',
}

const ROLE_COLORS: Record<AdminRole, string> = {
  super_admin: '#dc2626',
  admin:       '#2563eb',
  support:     '#16a34a',
  auditor:     '#d97706',
}

// ── Feedback banner ───────────────────────────────────────────────────────────

function Feedback({ type, message, onDismiss }: { type: 'success' | 'error'; message: string; onDismiss: () => void }) {
  const Icon = type === 'success' ? CheckCircle : AlertCircle
  return (
    <AnimatePresence>
      <motion.div
        role="alert"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="flex items-start gap-2.5 rounded-xl"
        style={{
          padding: '0.625rem 0.875rem',
          background: type === 'success' ? 'var(--success-dim)' : 'var(--danger-dim)',
          border:     `1px solid ${type === 'success' ? 'rgba(22,163,74,0.22)' : 'rgba(220,38,38,0.22)'}`,
          color:      type === 'success' ? 'var(--success-text)' : 'var(--danger-text)',
          fontSize: '0.8125rem',
        }}
      >
        <Icon size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span className="flex-1">{message}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="ml-1 shrink-0" style={{ color: 'inherit', opacity: 0.6 }}>
          <X size={14} />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminProfileClient({
  initialAdminId,
  initialName,
  initialEmail,
  initialRole,
}: AdminProfileClientProps) {
  const router = useRouter()

  // Full profile data (fetched from API)
  const [profile, setProfile]         = useState<AdminProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError]     = useState<string | null>(null)

  // Edit name state
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName]     = useState(initialName)
  const [nameSaving, setNameSaving]   = useState(false)
  const [nameFeedback, setNameFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Password change state
  const [pwSection, setPwSection]         = useState(false)
  const [currentPw, setCurrentPw]         = useState('')
  const [newPw, setNewPw]                 = useState('')
  const [confirmPw, setConfirmPw]         = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw]         = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [pwSaving, setPwSaving]           = useState(false)
  const [pwFeedback, setPwFeedback]       = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Logout
  const [loggingOut, setLoggingOut] = useState(false)

  // ── Load profile ────────────────────────────────────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch('/api/admin/profile')
        const json = await res.json() as { profile?: AdminProfile; error?: { message?: string } }
        if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load profile')
        setProfile(json.profile ?? null)
        if (json.profile) setDraftName(json.profile.name)
      } catch (e) {
        setProfileError(e instanceof Error ? e.message : 'Failed to load profile')
      } finally {
        setProfileLoading(false)
      }
    })()
  }, [])

  // Focus name input when editing starts
  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = draftName.trim()
    if (!trimmed || trimmed === profile?.name) { setEditingName(false); return }
    setNameSaving(true); setNameFeedback(null)
    try {
      const res  = await fetch('/api/admin/profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: trimmed }),
      })
      const json = await res.json() as { ok?: boolean; profile?: AdminProfile; error?: { message?: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Update failed')
      setProfile(json.profile ?? null)
      setEditingName(false)
      setNameFeedback({ type: 'success', msg: 'Display name updated.' })
    } catch (err) {
      setNameFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Update failed' })
    } finally {
      setNameSaving(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwFeedback(null)
    if (newPw !== confirmPw) {
      setPwFeedback({ type: 'error', msg: 'New passwords do not match.' })
      return
    }
    if (newPw.length < 12) {
      setPwFeedback({ type: 'error', msg: 'Password must be at least 12 characters.' })
      return
    }
    setPwSaving(true)
    try {
      const res  = await fetch('/api/admin/profile/change-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const json = await res.json() as { ok?: boolean; error?: { message?: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Password change failed')
      setPwFeedback({ type: 'success', msg: 'Password updated successfully.' })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setPwSection(false)
    } catch (err) {
      setPwFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Password change failed' })
    } finally {
      setPwSaving(false)
    }
  }

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/admin/auth/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // Use session data as fallback while full profile loads
  const displayName  = profile?.name        ?? initialName
  const displayEmail = profile?.email       ?? initialEmail
  const displayRole  = (profile?.role       ?? initialRole) as AdminRole
  const displayId    = profile?.adminId     ?? initialAdminId

  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: 720 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* ── Identity card ─────────────────────────────────────────── */}
        <AdminCard padding="md">
          {profileLoading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : profileError ? (
            <Feedback type="error" message={profileError} onDismiss={() => setProfileError(null)} />
          ) : (
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Avatar */}
              <div
                className="flex items-center justify-center rounded-2xl shrink-0"
                style={{
                  width: 72, height: 72,
                  background: `${ROLE_COLORS[displayRole]}18`,
                  border:     `2px solid ${ROLE_COLORS[displayRole]}30`,
                  color:       ROLE_COLORS[displayRole],
                  fontSize:   '1.375rem',
                  fontWeight:  700,
                }}
                aria-hidden="true"
              >
                {getInitials(displayName)}
              </div>

              {/* Info grid */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: '0.625rem' }}>
                  <p
                    className="font-bold tracking-tight"
                    style={{ color: 'var(--text-primary)', fontSize: '1.125rem', lineHeight: 1.2 }}
                  >
                    {displayName}
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
                    {displayEmail}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
                  <StatusBadge status={displayRole} />
                  {profile?.isActive === false && <StatusBadge status="deleted" />}
                </div>

                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '0.5rem 1.5rem',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    <dt style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                      Admin ID
                    </dt>
                    <dd className="font-mono" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                      {displayId}
                    </dd>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    <dt style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                      Role
                    </dt>
                    <dd style={{ color: ROLE_COLORS[displayRole], fontWeight: 600, fontSize: '0.75rem' }}>
                      {ROLE_LABELS[displayRole]}
                    </dd>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    <dt style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                      Member since
                    </dt>
                    <dd style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {formatDate(profile?.createdAt)}
                    </dd>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    <dt style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                      Last login
                    </dt>
                    <dd style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {formatDate(profile?.lastLoginAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </AdminCard>

        {/* ── Profile settings ──────────────────────────────────────── */}
        <AdminCard padding="md">
          <SectionHeader
            title="Profile Settings"
            subtitle="Update your display name."
          />

          {nameFeedback && (
            <div style={{ marginBottom: '1rem' }}>
              <Feedback type={nameFeedback.type} message={nameFeedback.msg} onDismiss={() => setNameFeedback(null)} />
            </div>
          )}

          {/* Display name */}
          <div>
            <label
              htmlFor="admin-display-name"
              className="block font-semibold"
              style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.4rem' }}
            >
              Display Name
            </label>

            {editingName ? (
              <form onSubmit={saveName} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  id="admin-display-name"
                  ref={nameInputRef}
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={100}
                  required
                  disabled={nameSaving}
                  className="flex-1 rounded-xl outline-none transition-all"
                  style={{
                    minWidth: 0,
                    padding: '0.5625rem 0.75rem',
                    fontSize: '0.875rem',
                    background: 'var(--glass-subtle-bg)',
                    border: '1px solid var(--border-focus)',
                    color: 'var(--text-primary)',
                    minHeight: '44px',
                  }}
                />
                <button
                  type="submit"
                  disabled={nameSaving || !draftName.trim()}
                  className="flex items-center gap-1.5 rounded-xl font-semibold transition-all disabled:opacity-50"
                  style={{
                    padding: '0.5625rem 0.875rem',
                    background: 'var(--accent)',
                    color: '#fff',
                    fontSize: '0.8125rem',
                    minHeight: '44px',
                  }}
                >
                  {nameSaving ? <LoadingSpinner size="sm" /> : <Save size={13} />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingName(false); setDraftName(profile?.name ?? initialName) }}
                  disabled={nameSaving}
                  className="flex items-center gap-1.5 rounded-xl font-medium transition-all disabled:opacity-50"
                  style={{
                    padding: '0.5625rem 0.875rem',
                    background: 'var(--glass-subtle-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    fontSize: '0.8125rem',
                    minHeight: '44px',
                  }}
                >
                  <X size={13} /> Cancel
                </button>
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <p
                  className="flex-1"
                  style={{
                    padding: '0.5625rem 0.75rem',
                    background: 'var(--glass-subtle-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.75rem',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {displayName}
                </p>
                <button
                  onClick={() => setEditingName(true)}
                  aria-label="Edit display name"
                  className="flex items-center gap-1.5 rounded-xl font-medium transition-all shrink-0"
                  style={{
                    padding: '0.5625rem 0.875rem',
                    background: 'var(--accent-dim)',
                    border: '1px solid rgba(37,99,235,0.15)',
                    color: 'var(--accent-text)',
                    fontSize: '0.8125rem',
                    minHeight: '44px',
                  }}
                >
                  <Edit3 size={13} /> Edit
                </button>
              </div>
            )}
          </div>

          {/* Email — read only */}
          <div style={{ marginTop: '0.875rem' }}>
            <label
              className="block font-semibold"
              style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.4rem' }}
            >
              Email Address
            </label>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: '0.5625rem 0.75rem',
                background: 'var(--glass-subtle-bg)',
                border: '1px solid var(--border)',
                borderRadius: '0.75rem',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                minHeight: '44px',
                opacity: 0.8,
              }}
            >
              <Mail size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
              {displayEmail}
            </div>
            <p style={{ color: 'var(--text-faint)', fontSize: '0.6875rem', marginTop: '0.25rem' }}>
              Email cannot be changed here. Contact a super admin.
            </p>
          </div>
        </AdminCard>

        {/* ── Security ─────────────────────────────────────────────── */}
        <AdminCard padding="md">
          <SectionHeader
            title="Security"
            subtitle="Change your password. Sessions expire after 8 hours of activity or 30 minutes of inactivity."
          />

          {pwFeedback && (
            <div style={{ marginBottom: '1rem' }}>
              <Feedback type={pwFeedback.type} message={pwFeedback.msg} onDismiss={() => setPwFeedback(null)} />
            </div>
          )}

          {!pwSection ? (
            <button
              onClick={() => setPwSection(true)}
              className="flex items-center gap-2 rounded-xl font-medium transition-all"
              style={{
                padding: '0.5625rem 0.875rem',
                background: 'var(--glass-subtle-bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                fontSize: '0.8125rem',
                minHeight: '44px',
              }}
            >
              <Key size={14} aria-hidden="true" />
              Change Password
            </button>
          ) : (
            <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {(
                [
                  { id: 'cp-current', label: 'Current Password',  value: currentPw,  setter: setCurrentPw,  show: showCurrentPw,  toggleShow: () => setShowCurrentPw((v) => !v) },
                  { id: 'cp-new',     label: 'New Password',      value: newPw,      setter: setNewPw,      show: showNewPw,      toggleShow: () => setShowNewPw((v) => !v)     },
                  { id: 'cp-confirm', label: 'Confirm New Password', value: confirmPw, setter: setConfirmPw, show: showConfirmPw,  toggleShow: () => setShowConfirmPw((v) => !v) },
                ] as const
              ).map(({ id, label, value, setter, show, toggleShow }) => (
                <div key={id}>
                  <label
                    htmlFor={id}
                    className="block font-semibold"
                    style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.4rem' }}
                  >
                    {label}
                  </label>
                  <div className="relative">
                    <input
                      id={id}
                      type={show ? 'text' : 'password'}
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      required
                      disabled={pwSaving}
                      autoComplete={id === 'cp-current' ? 'current-password' : 'new-password'}
                      className="w-full rounded-xl outline-none transition-all disabled:opacity-60"
                      style={{
                        padding: '0.5625rem 2.5rem 0.5625rem 0.75rem',
                        fontSize: '0.875rem',
                        background: 'var(--glass-subtle-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        minHeight: '44px',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
                      onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
                    />
                    <button
                      type="button"
                      onClick={toggleShow}
                      disabled={pwSaving}
                      aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-lg transition-colors"
                      style={{ right: '0.5rem', width: '2rem', height: '2rem', color: 'var(--text-muted)' }}
                    >
                      {show ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {id === 'cp-new' && (
                    <p style={{ color: 'var(--text-faint)', fontSize: '0.6875rem', marginTop: '0.2rem' }}>
                      Minimum 12 characters.
                    </p>
                  )}
                </div>
              ))}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                  className="flex items-center gap-1.5 rounded-xl font-semibold transition-all disabled:opacity-50"
                  style={{
                    padding: '0.5625rem 0.875rem',
                    background: 'var(--danger)',
                    color: '#fff',
                    fontSize: '0.8125rem',
                    boxShadow: '0 2px 8px rgba(220,38,38,0.18)',
                    minHeight: '44px',
                  }}
                >
                  {pwSaving ? <LoadingSpinner size="sm" /> : <Key size={13} />}
                  {pwSaving ? 'Updating…' : 'Update Password'}
                </button>
                <button
                  type="button"
                  onClick={() => { setPwSection(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwFeedback(null) }}
                  disabled={pwSaving}
                  className="flex items-center gap-1.5 rounded-xl font-medium transition-all disabled:opacity-50"
                  style={{
                    padding: '0.5625rem 0.875rem',
                    background: 'var(--glass-subtle-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    fontSize: '0.8125rem',
                    minHeight: '44px',
                  }}
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            </form>
          )}
        </AdminCard>

        {/* ── Sign out ──────────────────────────────────────────────── */}
        <AdminCard padding="md">
          <SectionHeader
            title="Session"
            subtitle="Sign out of the Control Panel. Your session will be destroyed immediately."
          />
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-2 rounded-xl font-semibold transition-all disabled:opacity-50"
            style={{
              padding: '0.625rem 1rem',
              background: 'var(--danger-dim)',
              border: '1px solid rgba(220,38,38,0.18)',
              color: 'var(--danger-text)',
              fontSize: '0.875rem',
              minHeight: '44px',
            }}
          >
            {loggingOut ? <LoadingSpinner size="sm" /> : <LogOut size={15} aria-hidden="true" />}
            {loggingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        </AdminCard>

      </div>
    </div>
  )
}
