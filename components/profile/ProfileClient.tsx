'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Mail, Lock, LogOut, Trash2, Save, Eye, EyeOff, Shield, Bell, Copy, Check, Fingerprint, ChevronDown, CheckCircle2, Loader2, History, Camera } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassSelect } from '@/components/ui/GlassInput'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { Skeleton } from '@/components/ui/Loading'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import type { User as UserType } from '@/types'
import { DEFAULT_APPEARANCE } from '@/types'
import { NotificationHistorySection } from '@/components/notifications/NotificationHistorySection'
import { ProfilePhotoUploadModal } from '@/components/profile/ProfilePhotoUploadModal'
import { AppearanceSection } from '@/components/profile/AppearanceSection'
import { TwoFactorSection } from '@/components/profile/TwoFactorSection'
import { useAppearance } from '@/hooks/useAppearance'
import { prewarmAudio } from '@/lib/tonePlayer'

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

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal identity data passed from the server component (already fetched by
 * requireAuth() so no extra DB query is needed).  Used to render the profile
 * hero immediately — before the full /api/auth/me response arrives.
 */
export interface InitialUser {
  name:     string
  email:    string
  publicId: string
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProfileClient({ initialUser }: { initialUser: InitialUser }) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const { applyAppearance, setTimezone } = useAppearance()

  const [user,         setUser]        = useState<UserType | null>(null)
  // Secondary data (form fields, prefs, etc.) is still loading — but the hero
  // is visible immediately from initialUser, so we only skeleton the sections
  // below the hero, not the whole page.
  const [loading,      setLoading]     = useState(true)
  const [profileForm,  setProfileForm] = useState({
    name:     initialUser.name,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    upiId:    '' as string,
  })
  const [savingProfile,setSavingProfile]=useState(false)
  const [pwForm,       setPwForm]      = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' })
  const [showPw,       setShowPw]      = useState({ current: false, new: false, confirm: false })
  const [savingPw,     setSavingPw]    = useState(false)
  const [pwModalOpen,  setPwModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting,     setDeleting]    = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletePassword,    setDeletePassword]    = useState('')
  const [showDeletePw,      setShowDeletePw]      = useState(false)
  const [deleteError,       setDeleteError]       = useState<string | null>(null)
  // ── UPI field validation error ────────────────────────────────────────────
  const [upiError,          setUpiError]          = useState<string | null>(null)

  // ── Avatar / profile photo ────────────────────────────────────────────────
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)

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

  // ── Notification history section open/closed state (persisted) ───────────
  const [historyOpen, setHistoryOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const stored = window.localStorage.getItem('lf_notif_history_open')
      return stored === 'true'
    } catch {
      return false
    }
  })

  function toggleHistorySection() {
    setHistoryOpen((prev) => {
      const next = !prev
      try { window.localStorage.setItem('lf_notif_history_open', String(next)) } catch { /* ignore */ }
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
      setProfileForm({
        name:     data.user.name,
        currency: data.user.currency,
        timezone: data.user.timezone,
        upiId:    data.user.upiId ?? '',
      })

      // Sync server-stored appearance prefs into ThemeProvider (canonical source).
      // This ensures the theme persists correctly after logout/login even if
      // localStorage was cleared.
      const serverPrefs = data.user.appearancePreferences ?? DEFAULT_APPEARANCE
      applyAppearance(serverPrefs)
      // Update timezone in ThemeProvider for correct Night Shift scheduling.
      setTimezone(data.user.timezone ?? 'Asia/Kolkata')
      // Pre-warm the AudioContext now that we have a confirmed user interaction.
      prewarmAudio()
    } catch { toastError('Failed to load profile') }
    finally   { setLoading(false) }
  }, [toastError, applyAppearance, setTimezone])

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

    // ── Client-side UPI validation (mirrors the server Zod rule) ─────────────
    const rawUpi = profileForm.upiId.trim()
    if (rawUpi !== '' && !/^[a-zA-Z0-9._\-+]+@[a-zA-Z0-9]+$/.test(rawUpi.toLowerCase())) {
      setUpiError('Enter a valid UPI ID (e.g. srujan@upi, name@okaxis).')
      return
    }
    setUpiError(null)

    const prevUpi = (user?.upiId ?? null)

    setSavingProfile(true)
    try {
      const res  = await fetch('/api/auth/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(profileForm),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? 'Failed to save profile')
      }
      // The response is non-null here: we only reach this branch when res.ok is
      // true, so the server always returns { user: UserType }.  Asserting
      // non-null removes the `undefined` escape hatch introduced by `?.` which
      // was silently collapsing upiId to '' via `undefined ?? ''`.
      const data = await res.json() as { user: UserType }
      const savedUser = data.user  // always a full UserType, never null

      // Sync both user state AND form with server-returned (normalised) values.
      // This ensures profileForm.upiId reflects the lowercase-trimmed value the
      // server stored, so a subsequent save sends the correct canonical string.
      // NOTE: upiId is `string | null` (never undefined) on UserType, so
      // `savedUser.upiId ?? ''` only fires for the legitimate null case.
      setUser(savedUser)
      setProfileForm((f) => ({
        ...f,
        name:     savedUser.name,
        currency: savedUser.currency,
        timezone: savedUser.timezone,
        upiId:    savedUser.upiId ?? '',
      }))

      // Tailor the success message so UPI changes are clearly acknowledged.
      const newUpi = savedUser.upiId ?? null
      if (newUpi !== prevUpi) {
        success(newUpi ? 'UPI ID saved' : 'UPI ID removed')
      } else {
        success('Profile saved')
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
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
    setDeleteError(null)
    if (deleteConfirmText.trim() !== 'Delete my LifeFlow account') {
      setDeleteError('Please type the confirmation phrase exactly as shown.')
      return
    }
    if (!deletePassword) {
      setDeleteError('Please enter your current password.')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch('/api/auth/delete-account', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          password:      deletePassword,
          confirmPhrase: deleteConfirmText.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDeleteError(data.error ?? 'Failed to delete account. Please try again.')
        return
      }
      // Session destroyed server-side — navigate to login
      router.push('/login')
    } catch {
      setDeleteError('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
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

  // ── Derived values — available immediately from initialUser ─────────────
  // When the full user hasn't loaded yet, fall back to initialUser for the
  // hero section so name / email / LifeFlow ID render with zero delay.
  const displayName    = user?.name     ?? initialUser.name
  const displayEmail   = user?.email    ?? initialUser.email
  const displayId      = user?.publicId ?? initialUser.publicId
  const displayAvatar  = user?.avatar   // undefined until /api/auth/me resolves — intentional
  const initials       = displayName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()

  // ── Render guard — only for catastrophic fetch failure ───────────────────
  // (loading skeleton is handled inline below — we never show a blank page)
  if (!loading && !user) {
    return (
      <div className="text-center py-16 px-4">
        <p className="mb-4" style={{ color: 'var(--text-muted)' }}>Failed to load profile.</p>
        <GlassButton variant="primary" size="sm" onClick={fetchUser}>Retry</GlassButton>
      </div>
    )
  }

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
      <motion.div
        variants={fadeUp}
        className="glass-elevated glass-catchlight rounded-2xl relative overflow-hidden"
      >
        {/* Decorative glows — wrapped in aria-hidden so they are NOT direct
            children of .glass-catchlight. The .glass-catchlight > * rule sets
            position:relative on every direct child, which overrides absolute
            positioning and adds ~320px of invisible height above the content. */}
        <div aria-hidden="true" className="pointer-events-none select-none">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/06 rounded-full blur-3xl" />
          <div className="absolute -bottom-8 -left-8 w-28 h-28 bg-violet-500/05 rounded-full blur-2xl" />
        </div>

        <div className="relative p-5 sm:p-6">
          {/* ── Desktop: horizontal ── Mobile: vertical-centered ── */}
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-5">

            {/* Avatar with camera button */}
            <div className="relative flex-shrink-0 self-center sm:self-auto">
              {/* Avatar circle */}
              <button
                onClick={() => setAvatarModalOpen(true)}
                aria-label="Change profile photo"
                className="block focus-ring rounded-full group"
              >
                <div
                  className="w-20 h-20 sm:w-[72px] sm:h-[72px] rounded-full overflow-hidden flex items-center justify-center transition-all duration-200 group-hover:ring-2 group-hover:ring-indigo-500/40 group-hover:ring-offset-1"
                  style={
                    displayAvatar
                      ? { border: '2px solid rgba(99,102,241,0.25)' }
                      : {
                          background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.14) 100%)',
                          border: '2px solid rgba(99,102,241,0.22)',
                          boxShadow: '0 4px 16px rgba(99,102,241,0.15)',
                        }
                  }
                >
                  {displayAvatar ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={displayAvatar}
                      alt={`${displayName} profile photo`}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span
                      className="text-[24px] font-bold select-none"
                      style={{ color: 'var(--accent)' }}
                    >
                      {initials}
                    </span>
                  )}
                </div>
              </button>

              {/* Camera badge */}
              <button
                onClick={() => setAvatarModalOpen(true)}
                aria-label="Edit profile photo"
                className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all duration-200 hover:scale-110 focus-ring"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: '2px solid var(--glass-panel-bg)',
                }}
              >
                <Camera size={12} />
              </button>
            </div>

            {/* Identity info */}
            <div className="min-w-0 flex-1 text-center sm:text-left">
              {/* Name — primary, prominent */}
              <h2
                className="text-[20px] sm:text-[22px] font-bold leading-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                {displayName}
              </h2>

              {/* Email — secondary */}
              <p
                className="text-[13px] mt-0.5 truncate"
                style={{ color: 'var(--text-muted)' }}
              >
                {displayEmail}
              </p>

              {/* LifeFlow ID badge */}
              <div className="flex items-center justify-center sm:justify-start gap-1.5 mt-2.5">
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold tracking-widest px-2.5 py-1 rounded-full"
                  style={{
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.20)',
                    color: 'var(--accent)',
                  }}
                >
                  <Fingerprint size={9} />
                  {displayId}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Profile photo modal ── */}
      <ProfilePhotoUploadModal
        isOpen={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
        avatar={displayAvatar}
        initials={initials}
        onSave={(newAvatar) => {
          setUser((prev) => prev ? { ...prev, avatar: newAvatar ?? undefined } : prev)
        }}
      />

      {/* ── LifeFlow ID ── */}
      <LifeFlowIdSection publicId={displayId} variants={fadeUp} />

      {/* ── Account section ── */}
      <ProfileSection title="Account" icon={<User size={14} />} variants={fadeUp}>
        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Skeleton className="h-10 rounded-xl" />
              <Skeleton className="h-10 rounded-xl" />
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-8 w-28 rounded-xl" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <GlassInput label="Full Name" value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} leftIcon={<User size={13} />} />
            <div className="flex items-center gap-3 glass-subtle rounded-xl px-3.5 py-2.5">
              <Mail size={13} style={{ color: 'var(--text-faint)' }} />
              <span className="text-[13px] flex-1 truncate" style={{ color: 'var(--text-muted)' }}>{displayEmail}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>Cannot change</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <GlassSelect label="Currency" value={profileForm.currency} onChange={(v) => setProfileForm((f) => ({ ...f, currency: v }))} options={CURRENCIES} />
              <GlassSelect label="Timezone" value={profileForm.timezone} onChange={(v) => setProfileForm((f) => ({ ...f, timezone: v }))} options={TIMEZONES} />
            </div>
            {/* ── UPI ID ── */}
            <div className="flex flex-col gap-1">
              <GlassInput
                label="UPI ID"
                value={profileForm.upiId}
                onChange={(e) => {
                  setProfileForm((f) => ({ ...f, upiId: e.target.value }))
                  if (upiError) setUpiError(null)
                }}
                placeholder="e.g. yourname@upi"
                error={upiError ?? undefined}
                leftIcon={<span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'ui-monospace,monospace', color: 'var(--text-faint)' }}>₹</span>}
              />
              {upiError ? null : (
                <p className="text-[11px] px-1" style={{ color: 'var(--text-faint)' }}>
                  {profileForm.upiId
                    ? 'Used in Group Bill reminder emails so recipients know where to pay.'
                    : 'Not configured — add your UPI ID so Group Bill recipients know where to pay.'}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <GlassButton variant="primary" onClick={saveProfile} loading={savingProfile}>
                <Save size={13} /> Save Changes
              </GlassButton>
            </div>
          </div>
        )}

        {/* ── Account status (lifecycle) — only when full data is loaded ── */}
        {!loading && user && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  Account status
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: (user.accountStatus ?? 'active') === 'active' ? '#10b981' : '#ef4444' }}
                  />
                  <span className="text-[12px] font-medium capitalize"
                    style={{ color: (user.accountStatus ?? 'active') === 'active' ? '#059669' : '#dc2626' }}>
                    {(user.accountStatus ?? 'active') === 'active' ? 'Active' : 'Scheduled for deletion'}
                  </span>
                </div>
              </div>
              <GlassButton
                variant="danger"
                size="sm"
                onClick={() => { setDeleteConfirmText(''); setDeletePassword(''); setDeleteError(null); setDeleteModalOpen(true) }}
              >
                <Trash2 size={12} /> Delete Account
              </GlassButton>
            </div>
          </div>
        )}
      </ProfileSection>

      {/* ── Notifications (collapsible) ── */}
      <CollapsibleNotifications
        isOpen={notifOpen}
        onToggle={toggleNotifSection}
        variants={fadeUp}
      >
        {loading || !user ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24 rounded-lg" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-1">
                <div className="flex flex-col gap-1.5 flex-1">
                  <Skeleton className="h-3.5 w-32 rounded-lg" />
                  <Skeleton className="h-3 w-48 rounded-lg" />
                </div>
                <Skeleton className="w-11 h-6 rounded-full flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : (
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
        )}
      </CollapsibleNotifications>

      {/* ── Notification History (collapsible) ── */}
      <CollapsibleSection
        title="Notification History"
        icon={<History size={14} />}
        isOpen={historyOpen}
        onToggle={toggleHistorySection}
        variants={fadeUp}
      >
        {!loading && user ? (
          <NotificationHistorySection
            userEmail={user.email}
            timezone={user.timezone ?? 'Asia/Kolkata'}
          />
        ) : (
          <div className="flex flex-col gap-2 py-1">
            <Skeleton className="h-3.5 w-40 rounded-lg" />
            <Skeleton className="h-3 w-56 rounded-lg" />
          </div>
        )}
      </CollapsibleSection>

      {/* ── Appearance & Experience ── */}
      {!loading && user ? (
        <AppearanceSection
          initialPrefs={user.appearancePreferences ?? DEFAULT_APPEARANCE}
          timezone={user.timezone ?? 'Asia/Kolkata'}
          variants={fadeUp}
        />
      ) : (
        <motion.div variants={fadeUp} className="glass-elevated rounded-2xl overflow-hidden" aria-hidden="true">
          <div className="flex items-center gap-2 px-5 py-[18px]">
            <Skeleton className="w-3.5 h-3.5 rounded" />
            <Skeleton className="h-3.5 w-36 rounded-lg" />
          </div>
        </motion.div>
      )}

      {/* ── Security ── */}
      <ProfileSection title="Security" icon={<Shield size={14} />} variants={fadeUp}>
        <div className="flex flex-col gap-3">
          {/* Password row */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div>
              <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>Password</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Change your account password</p>
            </div>
            <GlassButton variant="secondary" size="sm" onClick={() => setPwModalOpen(true)}>
              <Lock size={12} /> Change
            </GlassButton>
          </div>

          {/* Divider */}
          <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

          {/* Two-Factor Authentication row */}
          {!loading && user && (
            <TwoFactorSection
              emailOtpEnabled={user.emailOtpEnabled ?? false}
              onStatusChange={(enabled) => setUser((u) => u ? { ...u, emailOtpEnabled: enabled } : u)}
            />
          )}
          {loading && (
            <div className="flex items-center justify-between gap-4 py-1">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-44 rounded-lg" />
                <Skeleton className="h-3 w-56 rounded-lg" />
              </div>
              <Skeleton className="h-7 w-20 rounded-xl" />
            </div>
          )}

          {/* Divider */}
          <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

          {/* Sign out row */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div>
              <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>Sign out</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>End your current session</p>
            </div>
            <GlassButton variant="secondary" size="sm" onClick={handleLogout}>
              <LogOut size={12} /> Logout
            </GlassButton>
          </div>
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
      <Modal isOpen={deleteModalOpen} onClose={() => !deleting && setDeleteModalOpen(false)} title="Delete Account" size="sm">
        <div className="flex flex-col gap-4">
          {/* Warning */}
          <div className="glass-subtle rounded-xl p-3.5 border border-amber-500/20"
               style={{ background: 'rgba(255,248,230,0.70)' }}>
            <p className="text-[13px] font-semibold mb-1" style={{ color: '#92400e' }}>
              ⚠️ 30-day recovery window
            </p>
            <p className="text-[12px] leading-relaxed" style={{ color: '#78350f' }}>
              Your account will be deactivated immediately. You will have{' '}
              <strong>30 days</strong> to restore it. After that, your account and
              all associated data will be permanently deleted.
            </p>
          </div>

          {/* Password */}
          <GlassInput
            label="Current password"
            type={showDeletePw ? 'text' : 'password'}
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            leftIcon={<Lock size={13} />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowDeletePw((v) => !v)}
                className="hover:opacity-70 transition-opacity"
                style={{ color: 'var(--text-muted)' }}
                aria-label={showDeletePw ? 'Hide password' : 'Show password'}
              >
                {showDeletePw ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            }
            placeholder="Enter your password"
          />

          {/* Confirmation phrase */}
          <div>
            <label className="text-[12px] block mb-1.5 font-semibold uppercase tracking-wide"
                   style={{ color: 'var(--text-muted)' }}>
              Type to confirm
            </label>
            <p className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Type{' '}
              <span className="font-mono font-semibold text-red-500 select-all">
                Delete my LifeFlow account
              </span>
            </p>
            <input
              className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm"
              value={deleteConfirmText}
              onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError(null) }}
              placeholder="Delete my LifeFlow account"
              autoComplete="off"
            />
          </div>

          {/* Error */}
          {deleteError && (
            <p className="text-[12px] text-red-500 -mt-1">{deleteError}</p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <GlassButton variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="danger"
              onClick={handleDeleteAccount}
              loading={deleting}
              disabled={
                deleteConfirmText.trim() !== 'Delete my LifeFlow account' ||
                !deletePassword ||
                deleting
              }
            >
              Delete Account
            </GlassButton>
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
      className="glass-elevated rounded-2xl overflow-hidden"
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
          'transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] active:bg-black/[0.04]',
          isOpen && 'border-b'
        )}
        style={isOpen ? { borderColor: 'var(--border)' } : {}}
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

/* ── CollapsibleSection — generic collapsible section ───────────────────────── */
/**
 * A generic collapsible section that mirrors CollapsibleNotifications but
 * accepts a custom title and icon so it can be reused for Notification History
 * and future sections without code duplication.
 */
function CollapsibleSection({
  title,
  icon,
  isOpen,
  onToggle,
  children,
  variants,
}: {
  title:    string
  icon:     React.ReactNode
  isOpen:   boolean
  onToggle: () => void
  children: React.ReactNode
  variants?: import('framer-motion').Variants
}) {
  const panelId  = useId()
  const headerId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <motion.div variants={variants} className="glass-elevated rounded-2xl overflow-hidden">
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-5 py-[18px] text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-inset',
          'transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] active:bg-black/[0.04]',
          isOpen && 'border-b'
        )}
        style={isOpen ? { borderColor: 'var(--border)' } : {}}
      >
        <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
        <h3 className="text-[13px] font-semibold flex-1" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </h3>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center' }}
          aria-hidden="true"
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="section-panel"
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
    <motion.div variants={variants} className="glass-elevated rounded-2xl p-5">
      <div
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: '1px solid var(--border)' }}
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
              : 'glass-subtle border hover:shadow-[var(--glass-hover-shadow)] transition-all duration-200'
          )}
          style={!copied ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' } : {}}
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
      className={cn('glass-elevated rounded-2xl p-5', danger && 'border-red-500/12')}
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
