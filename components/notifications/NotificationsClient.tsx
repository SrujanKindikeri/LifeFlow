'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, CheckCheck, Trash2, X, Bell, Flame, ListChecks, DollarSign, Clock } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { EmptyState, SkeletonList } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { Notification } from '@/types'

type TabFilter = 'all' | 'unread' | 'task' | 'habit' | 'expense'

const TYPE_ICONS: Record<string, React.ReactNode> = {
  habit:   <Flame       size={14} className="text-orange-500" />,
  task:    <ListChecks  size={14} className="text-indigo-500" />,
  expense: <DollarSign  size={14} className="text-emerald-500" />,
  reminder:<Clock       size={14} className="text-sky-500" />,
  general: <Bell        size={14} className="text-gray-400" />,
}

const TYPE_DOT: Record<string, string> = {
  habit:   'bg-orange-500',
  task:    'bg-indigo-500',
  expense: 'bg-emerald-500',
  reminder:'bg-sky-500',
  general: 'bg-gray-400',
}

export function NotificationsClient() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount,   setUnreadCount]   = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [tab,           setTab]           = useState<TabFilter>('all')
  const [clearing,      setClearing]      = useState(false)
  const { success, error: toastError }    = useToast()

  const fetchNotifications = useCallback(async () => {
    try {
      const res  = await fetch('/api/notifications?limit=100')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unreadCount ?? 0)
    } catch { toastError('Failed to load notifications') }
    finally   { setLoading(false) }
  }, [toastError])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchNotifications() }, [fetchNotifications])

  const filtered = notifications.filter((n) => {
    if (tab === 'unread')  return !n.read
    if (tab === 'task')    return n.type === 'task'
    if (tab === 'habit')   return n.type === 'habit'
    if (tab === 'expense') return n.type === 'expense'
    return true
  })

  async function markRead(id: string, currentRead: boolean) {
    setNotifications((p) => p.map((n) => n._id === id ? { ...n, read: !currentRead } : n))
    setUnreadCount((c) => Math.max(0, c + (currentRead ? 1 : -1)))
    try {
      const res = await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, read: !currentRead }) })
      if (!res.ok) throw new Error()
    } catch {
      setNotifications((p) => p.map((n) => n._id === id ? { ...n, read: currentRead } : n))
      setUnreadCount((c) => Math.max(0, c + (currentRead ? -1 : 1)))
      toastError('Failed to update notification')
    }
  }

  async function markAllRead() {
    if (notifications.every((n) => n.read)) return
    setNotifications((p) => p.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    try {
      const res = await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'markAllRead' }) })
      if (!res.ok) throw new Error()
      success('All notifications marked as read')
    } catch { await fetchNotifications(); toastError('Failed to mark all read') }
  }

  async function deleteNotification(id: string) {
    setNotifications((p) => p.filter((n) => n._id !== id))
    try {
      const res = await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch { await fetchNotifications(); toastError('Failed to delete notification') }
  }

  async function clearAll() {
    setClearing(true)
    try {
      const res = await fetch('/api/notifications?all=true', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setNotifications([]); setUnreadCount(0)
      success('All notifications cleared')
    } catch { toastError('Failed to clear notifications') }
    finally   { setClearing(false) }
  }

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all',     label: 'All' },
    { key: 'unread',  label: unreadCount > 0 ? `Unread (${unreadCount})` : 'Unread' },
    { key: 'task',    label: 'Tasks' },
    { key: 'habit',   label: 'Habits' },
    { key: 'expense', label: 'Money' },
  ]

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'You\'re all caught up'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <GlassButton variant="secondary" size="sm" onClick={markAllRead}>
              <CheckCheck size={13} /><span className="hidden sm:inline">Mark all read</span>
            </GlassButton>
          )}
          {notifications.length > 0 && (
            <GlassButton variant="danger" size="sm" onClick={clearAll} loading={clearing}>
              <Trash2 size={13} /><span className="hidden sm:inline">Clear all</span>
            </GlassButton>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit flex-wrap" style={{ boxShadow: 'inset 0 1px 0 var(--glass-catchlight)' }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150',
              tab === key
                ? 'glass-segment-active'
                : 'hover:bg-black/[0.04]'
            )}
            style={tab === key
              ? { color: 'var(--accent-text)' }
              : { color: 'var(--text-muted)' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <SkeletonList lines={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          description={tab === 'all' ? 'Notifications from your tasks, habits, and expenses will appear here.' : undefined}
        />
      ) : (
        <motion.div layout className="flex flex-col gap-1.5">
          <AnimatePresence mode="popLayout">
            {filtered.map((notif) => (
              <NotificationItem key={notif._id} notification={notif} onMarkRead={markRead} onDelete={deleteNotification} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}

/* ── Notification Item ─────────────────────────────────────────────────────── */
function NotificationItem({ notification: n, onMarkRead, onDelete }: {
  notification: Notification
  onMarkRead: (id: string, current: boolean) => void
  onDelete:   (id: string) => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'group rounded-xl flex items-start gap-3.5 px-4 py-3.5',
        'transition-all duration-200',
        !n.read
          ? 'glass-elevated border-l-[3px] border-indigo-500 hover:shadow-[var(--glass-hover-shadow)]'
          : 'glass hover:bg-black/[0.02]',
      )}
    >
      {/* Icon */}
      <div className={cn(
        'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5',
        !n.read ? 'bg-indigo-500/10 ring-1 ring-indigo-500/20' : 'glass-subtle'
      )}
      >
        {TYPE_ICONS[n.type] ?? <Bell size={14} style={{ color: 'var(--text-muted)' }} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold leading-snug"
            style={{ color: n.read ? 'var(--text-muted)' : 'var(--text-primary)' }}
          >
            {n.title}
          </p>
          {!n.read && (
            <span className={cn('w-2 h-2 rounded-full flex-shrink-0 mt-1', TYPE_DOT[n.type] ?? 'bg-indigo-500')} />
          )}
        </div>
        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{n.message}</p>
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-faint)' }}>{formatRelativeTime(n.createdAt)}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={() => onMarkRead(n._id, n.read)}
          title={n.read ? 'Mark unread' : 'Mark read'}
          className="p-1.5 rounded-lg nav-hover hover:text-indigo-500 transition-colors"
          style={{ color: 'var(--text-faint)' }}
        >
          <Check size={13} />
        </button>
        <button
          onClick={() => onDelete(n._id)}
          title="Delete"
          className="p-1.5 rounded-lg nav-hover-danger hover:text-red-500 transition-colors"
          style={{ color: 'var(--text-faint)' }}
        >
          <X size={13} />
        </button>
      </div>
    </motion.div>
  )
}
