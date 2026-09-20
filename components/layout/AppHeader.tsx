'use client'

import { Bell, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { SmartInbox } from '@/components/inbox/SmartInbox'
import { useNotificationTone } from '@/hooks/useNotificationTone'

const pageTitles: Record<string, string> = {
  '/app/dashboard':       'Dashboard',
  '/app/notes':           'Notes',
  '/app/tasks':           'Tasks',
  '/app/habits':          'Habits',
  '/app/expenses':        'Expenses',
  '/app/analytics':       'Analytics',
  '/app/notifications':   'Notifications',
  '/app/profile':         'Profile',
  '/app/projects':        'Projects',
  '/app/subscriptions':   'Subscriptions',
  '/app/bills':           'Bills',
  '/app/savings':         'Savings',
  '/app/budgets':         'Budgets',
  '/app/people':          'People',
  '/app/calendar':        'Calendar',
  '/app/financial-review':'Financial Review',
  '/app/weekly-planning': 'Weekly Planning',
  '/app/activity':        'Activity',
}

interface AppHeaderProps {
  /** Optional initial value — live count is fetched client-side and overrides this. */
  unreadCount?: number
}

export function AppHeader({ unreadCount: initialCount = 0 }: AppHeaderProps) {
  const pathname    = usePathname()
  const title       = pageTitles[pathname] ?? 'LifeFlow'
  const [inboxOpen, setInboxOpen] = useState(false)
  // Live unread count — polls /api/notifications every 60 s.
  // Falls back to the server-passed initialCount until the first fetch resolves.
  // Also plays the Turn Tone chime when the count increases (new notification).
  const liveCount   = useNotificationTone()
  const unreadCount = liveCount > 0 ? liveCount : initialCount

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="glass-panel lg:hidden sticky top-0 z-20 safe-top"
        style={{
          height: 'var(--topbar-height, 56px)',
          borderBottom: '1px solid var(--glass-panel-border)',
          boxShadow: 'var(--glass-panel-shadow)',
        }}
      >
        <div className="flex items-center justify-between h-full px-4">
          {/* Logo + title */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-[15px]"
              style={{
                background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
                border: '1px solid rgba(37,99,235,0.16)',
                boxShadow: '0 2px 8px rgba(37,99,235,0.10)',
              }}
            >
              ⚡
            </div>
            <span
              className="text-[14px] font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Smart Inbox trigger */}
            <button
              onClick={() => setInboxOpen(true)}
              className="nav-hover p-2 rounded-xl transition-colors focus-ring"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Smart Inbox"
            >
              <Search size={19} />
            </button>

            {/* Notifications */}
            <Link
              href="/app/notifications"
              className="nav-hover relative p-2 rounded-xl transition-colors focus-ring"
              style={{ color: 'var(--text-muted)' }}
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            >
              <Bell size={19} />
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </motion.span>
              )}
            </Link>
          </div>
        </div>
      </motion.header>

      <SmartInbox isOpen={inboxOpen} onClose={() => setInboxOpen(false)} />
    </>
  )
}
