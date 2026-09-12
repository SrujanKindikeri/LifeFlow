'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { User, Mail, Lock, LogOut, Trash2, Save, Eye, EyeOff, Shield, Bell, Copy, Check, Fingerprint } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassSelect } from '@/components/ui/GlassInput'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { SkeletonCard } from '@/components/ui/Loading'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import type { User as UserType } from '@/types'

const CURRENCIES = [
  { value: 'INR', label: '₹ INR — Indian Rupee'        },
  { value: 'USD', label: '$ USD — US Dollar'            },
  { value: 'EUR', label: '€ EUR — Euro'                 },
  { value: 'GBP', label: '£ GBP — British Pound'        },
  { value: 'JPY', label: '¥ JPY — Japanese Yen'         },
  { value: 'AUD', label: 'A$ AUD — Australian Dollar'   },
  { value: 'CAD', label: 'C$ CAD — Canadian Dollar'     },
  { value: 'SGD', label: 'S$ SGD — Singapore Dollar'    },
]
const TIMEZONES = [
  { value: 'Asia/Kolkata',       label: 'Asia/Kolkata (IST)'          },
  { value: 'America/New_York',   label: 'America/New_York (EST)'      },
  { value: 'America/Los_Angeles',label: 'America/Los_Angeles (PST)'   },
  { value: 'Europe/London',      label: 'Europe/London (GMT)'         },
  { value: 'Europe/Paris',       label: 'Europe/Paris (CET)'          },
  { value: 'Asia/Tokyo',         label: 'Asia/Tokyo (JST)'            },
  { value: 'Asia/Singapore',     label: 'Asia/Singapore (SGT)'        },
  { value: 'Australia/Sydney',   label: 'Australia/Sydney (AEDT)'     },
]

const fadeUp = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

export function ProfileClient() {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [user,         setUser]        = useState<UserType | null>(null)
  const [loading,      setLoading]     = useState(true)
  const [profileForm,  setProfileForm] = useState({ name: '', currency: 'INR', timezone: 'Asia/Kolkata' })
  const [savingProfile,setSavingProfile]=useState(false)
  const [pwForm,       setPwForm]      = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' })
  const [showPw,       setShowPw]      = useState({ current: false, new: false, confirm: false })
  const [savingPw,     setSavingPw]    = useState(false)
  const [pwModalOpen,  setPwModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting,     setDeleting]    = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // ── Push notification state ──────────────────────────────────────────────────
  const [pushSupported,   setPushSupported]   = useState(false)
  const [pushSubscribed,  setPushSubscribed]  = useState(false)
  const [pushLoading,     setPushLoading]     = useState(false)

  const fetchUser = useCallback(async () => {
    try {
      const res  = await fetch('/api/auth/me')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUser(data.user)
      setProfileForm({ name: data.user.name, currency: data.user.currency, timezone: data.user.timezone })
    } catch { toastError('Failed to load profile') }
    finally   { setLoading(false) }
  }, [toastError])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchUser() }, [fetchUser])

  // ── Push subscription helpers ────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return
    const supported = 'serviceWorker' in navigator && 'PushManager' in window
    setPushSupported(supported)
    if (!supported) return

    // Check if already subscribed
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushSubscribed(!!sub))
      .catch(() => undefined)
  }, [])

  function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const buffer  = new ArrayBuffer(rawData.length)
    const output  = new Uint8Array(buffer)
    for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
    return output
  }

  async function enablePushNotifications() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) { toastError('Push notifications are not configured'); return }

    setPushLoading(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { toastError('Permission denied — enable notifications in your browser settings'); return }

      const reg = await navigator.serviceWorker.ready
      let sub   = await reg.pushManager.getSubscription()

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        })
      }

      const serialised = JSON.parse(JSON.stringify(sub)) as {
        endpoint: string
        expirationTime: number | null
        keys: { p256dh: string; auth: string }
      }

      const res = await fetch('/api/push-subscription', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(serialised),
      })

      if (!res.ok) throw new Error('Failed to save subscription')
      setPushSubscribed(true)
      success('Push notifications enabled')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to enable push notifications')
    } finally {
      setPushLoading(false)
    }
  }

  async function disablePushNotifications() {
    setPushLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()

      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe()
        await fetch('/api/push-subscription', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint }),
        })
      }

      setPushSubscribed(false)
      success('Push notifications disabled')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to disable push notifications')
    } finally {
      setPushLoading(false)
    }
  }

  async function saveProfile() {
    if (!profileForm.name.trim()) { toastError('Name is required'); return }
    setSavingProfile(true)
    try {
      const res  = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileForm) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed') }
      const data = await res.json()
      setUser(data.user); success('Profile saved')
    } catch (e) { toastError(e instanceof Error ? e.message : 'Failed to save profile') }
    finally     { setSavingProfile(false) }
  }

  async function changePassword() {
    if (!pwForm.currentPassword || !pwForm.newPassword) { toastError('All fields are required'); return }
    if (pwForm.newPassword !== pwForm.confirmNewPassword) { toastError('Passwords do not match'); return }
    if (pwForm.newPassword.length < 8) { toastError('Password must be at least 8 characters'); return }
    setSavingPw(true)
    try {
      const res = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'changePassword', ...pwForm }) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed') }
      success('Password changed'); setPwModalOpen(false)
      setPwForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' })
    } catch (e) { toastError(e instanceof Error ? e.message : 'Failed to change password') }
    finally     { setSavingPw(false) }
  }

  async function handleLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login') }
    catch { toastError('Failed to log out') }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch('/api/auth/me', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      router.push('/login')
    } catch { toastError('Failed to delete account'); setDeleting(false) }
  }

  async function saveNotifPrefs(prefs: UserType['notificationPreferences']) {
    try {
      const res = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateNotifications', notificationPreferences: prefs }) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUser(data.user); success('Preferences saved')
    } catch { toastError('Failed to save preferences') }
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-4 max-w-2xl mx-auto">
        {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }
  if (!user) {
    return (
      <div className="text-center py-16 px-4">
        <p className="mb-4" style={{ color: 'var(--text-muted)' }}>Failed to load profile.</p>
        <GlassButton variant="primary" size="sm" onClick={fetchUser}>Retry</GlassButton>
      </div>
    )
  }

  const initials = user.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  return (
    <motion.div
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
      initial="hidden" animate="show"
      className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-4 max-w-2xl mx-auto"
    >
      {/* ── Profile hero ── */}
      <motion.div variants={fadeUp} className="glass-elevated rounded-2xl p-6 flex items-center gap-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-indigo-500/08 rounded-full blur-2xl pointer-events-none" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/15 border border-indigo-500/25 flex items-center justify-center text-[22px] font-bold text-indigo-600 flex-shrink-0 shadow-[0_4px_16px_rgba(99,102,241,0.15)]">
          {initials}
        </div>
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{user.name}</h2>
          <p className="text-[13px] truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600">
              {user.publicId}
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── LifeFlow ID ── */}
      <LifeFlowIdSection publicId={user.publicId} variants={fadeUp} />

      {/* ── Account ── */}
      <ProfileSection title="Account" icon={<User size={14} />} variants={fadeUp}>
        <div className="flex flex-col gap-4">
          <GlassInput label="Full Name" value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} leftIcon={<User size={13} />} />
          <div className="flex items-center gap-3 glass-subtle rounded-xl px-3.5 py-2.5">
            <Mail size={13} style={{ color: 'var(--text-faint)' }} />
            <span className="text-[13px] flex-1 truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</span>
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>Cannot change</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <GlassSelect label="Currency" value={profileForm.currency} onChange={(v) => setProfileForm((f) => ({ ...f, currency: v }))} options={CURRENCIES} />
            <GlassSelect label="Timezone" value={profileForm.timezone} onChange={(v) => setProfileForm((f) => ({ ...f, timezone: v }))} options={TIMEZONES} />
          </div>
          <div className="flex justify-end">
            <GlassButton variant="primary" onClick={saveProfile} loading={savingProfile}>
              <Save size={13} /> Save Changes
            </GlassButton>
          </div>
        </div>
      </ProfileSection>

      {/* ── Notifications ── */}
      <ProfileSection title="Notifications" icon={<Bell size={14} />} variants={fadeUp}>
        <div className="flex flex-col gap-3">
          {([
            { key: 'taskReminders',  label: 'Task reminders',  desc: 'Reminders for upcoming and overdue tasks' },
            { key: 'habitReminders', label: 'Habit reminders', desc: 'Daily reminders to complete your habits'  },
            { key: 'spendingAlerts', label: 'Spending alerts',  desc: 'Alerts when spending exceeds thresholds' },
            { key: 'dailySummary',   label: 'Daily summary',   desc: 'Morning summary of your day ahead'       },
          ] as { key: keyof UserType['notificationPreferences']; label: string; desc: string }[]).map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{label}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>
              </div>
              <Toggle
                checked={user.notificationPreferences[key]}
                onChange={(v) => {
                  const updated = { ...user.notificationPreferences, [key]: v }
                  setUser((u) => u ? { ...u, notificationPreferences: updated } : u)
                  saveNotifPrefs(updated)
                }}
              />
            </div>
          ))}

          {/* ── Push notifications row ── */}
          {pushSupported && (
            <div className="flex items-center justify-between gap-4 py-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>Browser push notifications</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {pushSubscribed
                    ? 'Push notifications are enabled on this device'
                    : 'Get push alerts on this device'}
                </p>
              </div>
              <GlassButton
                variant={pushSubscribed ? 'secondary' : 'primary'}
                size="sm"
                loading={pushLoading}
                onClick={pushSubscribed ? disablePushNotifications : enablePushNotifications}
              >
                <Bell size={12} />
                {pushSubscribed ? 'Disable' : 'Enable'}
              </GlassButton>
            </div>
          )}
        </div>
      </ProfileSection>

      {/* ── Security ── */}
      <ProfileSection title="Security" icon={<Shield size={14} />} variants={fadeUp}>
        <div className="flex flex-col gap-3">
          {[
            {
              label: 'Password', desc: 'Change your account password',
              action: <GlassButton variant="secondary" size="sm" onClick={() => setPwModalOpen(true)}><Lock size={12} /> Change</GlassButton>
            },
            {
              label: 'Sign out', desc: 'End your current session',
              action: <GlassButton variant="secondary" size="sm" onClick={handleLogout}><LogOut size={12} /> Logout</GlassButton>
            },
          ].map(({ label, desc, action }) => (
            <div key={label} className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{label}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>
              </div>
              {action}
            </div>
          ))}
        </div>
      </ProfileSection>

      {/* ── Danger zone ── */}
      <ProfileSection title="Danger Zone" icon={<Trash2 size={14} className="text-red-500" />} danger variants={fadeUp}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>Delete Account</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Permanently delete your account and all data</p>
          </div>
          <GlassButton variant="danger" size="sm" onClick={() => { setDeleteConfirmText(''); setDeleteModalOpen(true) }}>
            <Trash2 size={12} /> Delete
          </GlassButton>
        </div>
      </ProfileSection>

      {/* Change password modal */}
      <Modal isOpen={pwModalOpen} onClose={() => setPwModalOpen(false)} title="Change Password" size="sm">
        <div className="flex flex-col gap-4">
          {(['currentPassword', 'newPassword', 'confirmNewPassword'] as const).map((field) => {
            const labels = { currentPassword: 'Current Password', newPassword: 'New Password', confirmNewPassword: 'Confirm New Password' }
            const showKey = field === 'currentPassword' ? 'current' : field === 'newPassword' ? 'new' : 'confirm'
            return (
              <GlassInput
                key={field}
                label={labels[field]}
                type={showPw[showKey as keyof typeof showPw] ? 'text' : 'password'}
                value={pwForm[field]}
                onChange={(e) => setPwForm((f) => ({ ...f, [field]: e.target.value }))}
                rightIcon={
                  <button type="button" onClick={() => setShowPw((s) => ({ ...s, [showKey]: !s[showKey as keyof typeof s] }))} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
                    {showPw[showKey as keyof typeof showPw] ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                }
              />
            )
          })}
          <div className="flex gap-2 justify-end pt-1">
            <GlassButton variant="secondary" onClick={() => setPwModalOpen(false)}>Cancel</GlassButton>
            <GlassButton variant="primary" onClick={changePassword} loading={savingPw}>Change Password</GlassButton>
          </div>
        </div>
      </Modal>

      {/* Delete account modal */}
      <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Account" size="sm">
        <div className="flex flex-col gap-4">
          <div className="glass-subtle rounded-xl p-3.5 border border-red-500/15">
            <p className="text-[13px] text-red-500 font-semibold mb-1">⚠️ This action is irreversible</p>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              All your notes, tasks, habits, expenses, and data will be permanently deleted.
            </p>
          </div>
          <div>
            <label className="text-[12px] block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Type <span className="font-mono text-red-500">DELETE</span> to confirm
            </label>
            <input
              className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <GlassButton variant="secondary" onClick={() => setDeleteModalOpen(false)}>Cancel</GlassButton>
            <GlassButton variant="danger" onClick={handleDeleteAccount} loading={deleting} disabled={deleteConfirmText !== 'DELETE'}>Delete Account</GlassButton>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}

/* ── LifeFlow ID ─────────────────────────────────────────────────────────────── */
function LifeFlowIdSection({ publicId, variants }: { publicId: string; variants?: import('framer-motion').Variants }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers / non-secure contexts
      const el = document.createElement('textarea')
      el.value = publicId
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <motion.div variants={variants} className="glass rounded-2xl p-5">
      <div
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}
      >
        <Fingerprint size={14} style={{ color: 'var(--text-muted)' }} />
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Your LifeFlow ID
        </h3>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p
            className="text-[22px] font-bold font-mono tracking-widest"
            style={{ color: 'var(--text-primary)' }}
            aria-label={`LifeFlow ID: ${publicId}`}
          >
            {publicId}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Your unique, immutable LifeFlow identifier.
          </p>
        </div>
        <button
          onClick={copy}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-all shrink-0',
            copied
              ? 'bg-emerald-500/12 border border-emerald-500/25 text-emerald-600'
              : 'glass border border-black/[0.08] hover:bg-black/[0.04]'
          )}
          style={!copied ? { color: 'var(--text-secondary)' } : {}}
          aria-label="Copy LifeFlow ID to clipboard"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </motion.div>
  )
}

/* ── Section ─────────────────────────────────────────────────────────────────── */
function ProfileSection({ title, icon, children, danger, variants }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; danger?: boolean; variants?: import('framer-motion').Variants
}) {
  return (
    <motion.div
      variants={variants}
      className={cn('glass rounded-2xl p-5', danger && 'border-red-500/12')}
    >
      <div
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}
      >
        <span style={{ color: danger ? undefined : 'var(--text-muted)' }}
          className={danger ? 'text-red-500' : ''}>
          {icon}
        </span>
        <h3 className={cn('text-[13px] font-semibold', danger ? 'text-red-500' : '')}
          style={!danger ? { color: 'var(--text-secondary)' } : {}}
        >
          {title}
        </h3>
      </div>
      {children}
    </motion.div>
  )
}

/* ── Toggle ──────────────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0',
        checked ? 'bg-indigo-500' : ''
      )}
      style={!checked ? { background: 'rgba(0,0,0,0.12)' } : {}}
    >
      <motion.div
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? '22px' : '2px' }}
        transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      />
    </button>
  )
}
