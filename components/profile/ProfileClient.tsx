'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Mail, Lock, LogOut, Trash2, Save, Eye, EyeOff, Shield, Bell, Copy, Check, Fingerprint, ChevronDown, CheckCircle2, Loader2 } from 'lucide-react'
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

// ─── Push status type ─────────────────────────────────────────────────────────

/**
 * Represents the full state of browser push on this device:
 *   'checking'    — initial async detection in progress
 *   'unsupported' — browser/context doesn't support push (no SW, no PushManager, not HTTPS)
 *   'denied'      — user has blocked notifications at OS/browser level
 *   'subscribed'  — active push subscription exists for this device
 *   'unsubscribed'— supported + permitted but no active subscription
 *   'unavailable' — server VAPID not configured (push won't work server-side)
 */
type PushStatus = 'checking' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'unavailable'

// ─── VAPID helper ─────────────────────────────────────────────────────────────

        function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const buffer  = new ArrayBuffer(rawData.length)
  const output  = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  // ── Notifications section open/closed state (persisted) ───────────────────
  const [notifOpen, setNotifOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try {
      const stored = window.localStorage.getItem('lf_notif_section_open')
      return stored === null ? true : stored !== 'false'
    } catch {
      return true
    }
  })

  function toggleNotifSection() {
    setNotifOpen((prev) => {
      const next = !prev
      try { window.localStorage.setItem('lf_notif_section_open', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  // ── Push notification state ───────────────────────────────────────────────
  const [pushStatus,  setPushStatus]  = useState<PushStatus>('checking')
  const [pushLoading, setPushLoading] = useState(false)

  // ── Test notification state ───────────────────────────────────────────────
  const [testingEmail,    setTestingEmail]    = useState(false)
  const [testEmailError,  setTestEmailError]  = useState<string | null>(null)

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

  // ── Detect push support and current subscription status ──────────────────

  useEffect(() => {
    if (typeof window === 'undefined') { setPushStatus('unsupported'); return }

    // Basic API checks
    const hasServiceWorker = 'serviceWorker' in navigator
    const hasPushManager   = 'PushManager' in window
    const hasNotification  = 'Notification' in window
    const isSecureContext  = window.isSecureContext

    if (!hasServiceWorker || !hasPushManager || !hasNotification || !isSecureContext) {
      setPushStatus('unsupported')
      return
    }

    // Check if already denied at OS/browser level
    if (Notification.permission === 'denied') {
      setPushStatus('denied')
      return
    }

    // Check server-side VAPID config and current subscription in parallel
    async function checkStatus() {
      try {
        // Check VAPID config from server (runtime-safe, never exposes private key)
        const configRes = await fetch('/api/notifications/config')
        if (configRes.ok) {
          const config = await configRes.json() as { configured: boolean; vapidPublicKey: string | null }
          if (!config.configured) {
            setPushStatus('unavailable')
            return
          }
        }

        // Check if an active subscription already exists on this device
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setPushStatus(sub ? 'subscribed' : 'unsubscribed')
      } catch {
        // If we can't determine status, default to unsubscribed so user can try
        setPushStatus('unsubscribed')
      }
    }

    void checkStatus()
  }, [])

  // ── Enable push notifications ─────────────────────────────────────────────

  async function enablePushNotifications() {
    if (pushLoading) return
    setPushLoading(true)
    try {
      // 1. Fetch VAPID public key from server at runtime
      const configRes = await fetch('/api/notifications/config')
      if (!configRes.ok) throw new Error('Failed to load push configuration')
      const config = await configRes.json() as { configured: boolean; vapidPublicKey: string | null }

      if (!config.configured || !config.vapidPublicKey) {
        setPushStatus('unavailable')
        toastError('Push notifications are temporarily unavailable')
        return
      }

      // 2. Request notification permission
      const permission = await Notification.requestPermission()
      if (permission === 'denied') {
        setPushStatus('denied')
        toastError('Notifications are blocked. Enable them in your browser settings.')
        return
      }
      if (permission !== 'granted') {
        // User dismissed the prompt — don't change status
        return
      }

      // 3. Get service worker registration
      const reg = await navigator.serviceWorker.ready

      // 4. Subscribe (or reuse an existing subscription)
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
        })
      }

      // 5. Send subscription to server
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

      // 6. Update UI only after confirmed success
      setPushStatus('subscribed')
      success('Push notifications enabled')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to enable push notifications')
    } finally {
      setPushLoading(false)
    }
  }

  // ── Disable push notifications ────────────────────────────────────────────

  async function disablePushNotifications() {
    if (pushLoading) return
    setPushLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()

      if (sub) {
        const endpoint = sub.endpoint
        // Unsubscribe from browser first
        await sub.unsubscribe()
        // Remove from server (this device's endpoint only)
        await fetch('/api/push-subscription', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint }),
        })
      }

      setPushStatus('unsubscribed')
      success('Push notifications disabled')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to disable push notifications')
    } finally {
      setPushLoading(false)
    }
  }

  // ── Profile / account helpers ─────────────────────────────────────────────

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

  async function saveNotifPrefs(prefs: {
    notificationPreferences?: UserType['notificationPreferences']
    emailNotifications?: UserType['emailNotifications']
  }) {
    try {
      const res = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateNotifications', ...prefs }) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUser(data.user); success('Preferences saved')
    } catch { toastError('Failed to save preferences') }
  }

  /**
   * Send the one-time test notification.
   * Recipient is resolved server-side from the authenticated user record —
   * no email address is ever sent from the browser.
   */
  async function sendTestNotification() {
    setTestingEmail(true)
    setTestEmailError(null)
    try {
      const res = await fetch('/api/notifications/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json() as {
        ok?: boolean
        alreadyActive?: boolean
        testedAt?: string
        error?: string
      }

      if (!res.ok) {
        setTestEmailError(data.error ?? 'Failed to send test notification. Please try again.')
        return
      }

      // On success (or already active), refresh user state so the button hides
      const meRes = await fetch('/api/auth/me')
      if (meRes.ok) {
        const meData = await meRes.json()
        setUser(meData.user)
      }

      if (data.alreadyActive) {
        success('Email notifications are already active.')
      } else {
        success('Test email sent! Check your inbox. Email notifications are now active.')
      }
    } catch {
      setTestEmailError('Network error. Please try again.')
    } finally {
      setTestingEmail(false)
    }
  }

  /** Default email notification preferences for users without the field yet. */
  const defaultEmailNotifs: UserType['emailNotifications'] = {
    enabled:        false,
    taskReminders:  true,
    habitReminders: true,
    spendingAlerts: true,
    dailySummary:   true,
    weeklySummary:  true,
  }

  // ── Render guards ─────────────────────────────────────────────────────────

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

  // ── Push UI helpers ───────────────────────────────────────────────────────

  /** Human-readable description line below "Browser push notifications" */
  function pushStatusDesc(): string {
    switch (pushStatus) {
      case 'checking':    return 'Checking push support…'
      case 'unsupported': return 'Push notifications are not supported by this browser.'
      case 'denied':      return 'Notifications are blocked. Enable them in your browser settings.'
      case 'subscribed':  return 'Push notifications are enabled on this device.'
      case 'unsubscribed':return 'Get push alerts on this device.'
      case 'unavailable': return 'Push notifications are temporarily unavailable.'
    }
  }

  /** Whether the Enable/Disable button should be shown */
  const showPushButton = pushStatus === 'subscribed' || pushStatus === 'unsubscribed'

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

      {/* ── Notifications (collapsible) ── */}
      <CollapsibleNotifications
        isOpen={notifOpen}
        onToggle={toggleNotifSection}
        variants={fadeUp}
      >
        <div className="flex flex-col gap-3">

          {/* ── In-app / push categories ── */}
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Push &amp; In-app
          </p>
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
                  saveNotifPrefs({ notificationPreferences: updated })
                }}
              />
            </div>
          ))}

          {/* ── Browser push notifications row — always rendered, status-aware ── */}
          <div className="flex items-center justify-between gap-4 py-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>Browser push notifications</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {pushStatusDesc()}
              </p>
            </div>
            {showPushButton && (
              <GlassButton
                variant={pushStatus === 'subscribed' ? 'secondary' : 'primary'}
                size="sm"
                loading={pushLoading}
                onClick={pushStatus === 'subscribed' ? disablePushNotifications : enablePushNotifications}
                disabled={pushLoading}
              >
                <Bell size={12} />
                {pushStatus === 'subscribed' ? 'Disable' : 'Enable'}
              </GlassButton>
            )}
          </div>

          {/* ── Email notifications ── */}
          <div className="border-t pt-3 mt-1 flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>

            {/* ── BEFORE TEST: show description + button ── */}
            {!(user.notificationsTested ?? false) && (
              <>
                <div className="flex items-start justify-between gap-4 py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      Email notifications
                    </p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Verify your notification delivery once. After successful verification,
                      LifeFlow will automatically send your scheduled notifications to your
                      registered email.
                    </p>
                  </div>
                </div>

                {/* Error message */}
                {testEmailError && (
                  <p className="text-[11px] text-red-500 px-1">{testEmailError}</p>
                )}

                <GlassButton
                  variant="primary"
                  size="sm"
                  onClick={sendTestNotification}
                  loading={testingEmail}
                  disabled={testingEmail}
                  className="self-start"
                >
                  {testingEmail
                    ? <><Loader2 size={12} className="animate-spin" /> Sending…</>
                    : <><Bell size={12} /> Send Test Notification</>
                  }
                </GlassButton>
              </>
            )}

            {/* ── AFTER TEST: show active status ── */}
            {(user.notificationsTested ?? false) && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-[13px] font-medium text-emerald-600">
                      Email notifications active
                    </p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      LifeFlow will automatically send reminders and summaries to your registered email.
                    </p>
                  </div>
                </div>

                {/* Master on/off toggle — still let the user disable all emails */}
                <div className="flex items-center justify-between gap-4 py-0.5 pl-1">
                  <div>
                    <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>Enabled</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Emails sent to <span className="font-mono">{user.email}</span>
                    </p>
                  </div>
                  <Toggle
                    checked={user.emailNotifications?.enabled ?? true}
                    onChange={(v) => {
                      const updated = { ...(user.emailNotifications ?? defaultEmailNotifs), enabled: v }
                      setUser((u) => u ? { ...u, emailNotifications: updated } : u)
                      saveNotifPrefs({ emailNotifications: updated })
                    }}
                  />
                </div>

                {/* Category toggles — only shown when email is enabled */}
                {(user.emailNotifications?.enabled ?? true) && (
                  <div className="flex flex-col gap-2 pl-3 border-l-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)' }}>
                      Email categories
                    </p>
                    {([
                      { key: 'taskReminders',  label: 'Task reminders',  desc: 'Upcoming tasks · 30-minute due reminders · end-of-day incomplete reminders' },
                      { key: 'habitReminders', label: 'Habit reminders', desc: 'Upcoming and incomplete habit reminders'            },
                      { key: 'spendingAlerts', label: 'Spending alerts',  desc: 'Budget threshold and important spending alerts'   },
                      { key: 'dailySummary',   label: 'Daily summary',   desc: 'Daily summary of tasks, habits, expenses and activity' },
                      { key: 'weeklySummary',  label: 'Weekly summary',  desc: 'Weekly summary of tasks, habits, expenses and activity' },
                    ] as { key: keyof Omit<UserType['emailNotifications'], 'enabled'>; label: string; desc: string }[]).map(({ key, label, desc }) => (
                      <div key={key} className="flex items-center justify-between gap-4 py-0.5">
                        <div>
                          <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>{label}</p>
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                        </div>
                        <Toggle
                          checked={(user.emailNotifications?.[key] ?? true)}
                          onChange={(v) => {
                            const updated = { ...(user.emailNotifications ?? defaultEmailNotifs), [key]: v }
                            setUser((u) => u ? { ...u, emailNotifications: updated } : u)
                            saveNotifPrefs({ emailNotifications: updated })
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </CollapsibleNotifications>

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

/* ── CollapsibleNotifications ────────────────────────────────────────────────── */

/**
 * A self-contained collapsible wrapper for the Notifications section.
 *
 * Accessibility:
 *   - The toggle is a <button> with role="button" (implicit)
 *   - aria-expanded tracks the open/closed state
 *   - aria-controls points to the panel id
 *   - The panel has role="region" and aria-labelledby pointing to the heading
 *   - Keyboard: Enter / Space toggle via native button behaviour
 *   - Smooth height animation via AnimatePresence + motion.div
 *   - No layout shift — overflow is hidden during animation
 */
function CollapsibleNotifications({
  isOpen,
  onToggle,
  children,
  variants,
}: {
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  variants?: import('framer-motion').Variants
}) {
  const panelId  = useId()
  const headerId = useId()
  // Keep a ref so we can measure panel height for the animation
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <motion.div
      variants={variants}
      className="glass rounded-2xl overflow-hidden"
    >
      {/* ── Header row — always visible ── */}
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-5 py-[18px] text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-inset',
          'transition-colors hover:bg-black/[0.02] active:bg-black/[0.04]',
          // When open, add the same bottom border that ProfileSection uses
          isOpen && 'border-b'
        )}
        style={isOpen ? { borderColor: 'rgba(0,0,0,0.07)' } : {}}
      >
        <span style={{ color: 'var(--text-muted)' }}>
          <Bell size={14} />
        </span>
        <h3 className="text-[13px] font-semibold flex-1" style={{ color: 'var(--text-secondary)' }}>
          Notifications
        </h3>
        {/* Chevron — rotates 180° when open */}
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center' }}
          aria-hidden="true"
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>

      {/* ── Collapsible panel ── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="notif-panel"
            id={panelId}
            role="region"
            aria-labelledby={headerId}
            ref={panelRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-5 pt-4 pb-5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
