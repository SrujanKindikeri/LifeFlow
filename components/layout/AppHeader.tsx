'use client'

import { Bell, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { SmartInbox } from '@/components/inbox/SmartInbox'
import { useNotificationTone } from '@/hooks/useNotificationTone'

const pageTitles: Record<string, string> = {
  '/app/dashboard':        'Dashboard',
  '/app/notes':            'Notes',
  '/app/tasks':            'Tasks',
  '/app/habits':           'Habits',
  '/app/expenses':         'Expenses',
  '/app/analytics':        'Analytics',
  '/app/notifications':    'Notifications',
  '/app/profile':          'Profile',
  '/app/projects':         'Projects',
  '/app/subscriptions':    'Subscriptions',
  '/app/bills':            'Bills',
  '/app/savings':          'Savings',
  '/app/budgets':          'Budgets',
  '/app/people':           'People',
  '/app/calendar':         'Calendar',
  '/app/financial-review': 'Financial Review',
  '/app/weekly-planning':  'Weekly Planning',
  '/app/activity':         'Activity',
  '/app/drafts':           'Drafts',
}

interface AppHeaderProps {
  unreadCount?: number
}

export function AppHeader({ unreadCount: initialCount = 0 }: AppHeaderProps) {
  const pathname    = usePathname()
  const title       = pageTitles[pathname] ?? 'LifeFlow'
  const [inboxOpen, setInboxOpen] = useState(false)

  const liveCount   = useNotificationTone()
  const unreadCount = liveCount > 0 ? liveCount : initialCount

  return (
    <>
      {/*
        Mobile / tablet top bar (hidden on lg+).

        Height strategy — matches the bottom nav pattern:
          • The bar itself has NO fixed height; it grows with its content
          • padding-top = env(safe-area-inset-top) so it clears the notch/Dynamic Island
          • The inner content row is 56px, giving a comfortable touch target area
          • Total rendered height on a notched iPhone = 56px + ~47px status bar = ~103px
            which is correct — the status bar area is occupied by the glass bar
        The CSS variable --topbar-height (56px) is still used by other things
        (sidebar logo alignment etc.) and does NOT need to match the rendered height.
      */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="glass-panel lg:hidden sticky top-0 z-20 w-full"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          borderBottom: '1px solid var(--glass-panel-border)',
          boxShadow: 'var(--glass-panel-shadow)',
        }}
      >
        {/* Inner content row — always 56px tall */}
        <div
          className="flex items-center justify-between w-full"
          style={{
            height: 56,
            paddingLeft:  'max(env(safe-area-inset-left, 0px), 16px)',
            paddingRight: 'max(env(safe-area-inset-right, 0px), 16px)',
          }}
        >
          {/* Logo + page title */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Link
              href="/app/dashboard"
              className="flex items-center flex-shrink-0 focus-ring rounded-lg"
              aria-label="LifeFlow home"
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[15px] flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
                  border: '1px solid rgba(37,99,235,0.16)',
                  boxShadow: '0 2px 8px rgba(37,99,235,0.10)',
                }}
              >
                ⚡
              </div>
            </Link>

            {/*
              Title: min-w-0 allows truncation inside the flex row.
              font-size clamps so very long page titles (e.g. "Financial Review")
              still fit on 320px without overflowing.
            */}
            <span
              className="font-semibold truncate min-w-0"
              style={{
                color: 'var(--text-primary)',
                fontSize: 'clamp(13px, 3.8vw, 15px)',
                marginLeft: '8px',
              }}
            >
              {title}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center flex-shrink-0">
            <button
              onClick={() => setInboxOpen(true)}
              className="nav-hover flex items-center justify-center rounded-xl transition-colors focus-ring"
              style={{ color: 'var(--text-muted)', width: 44, height: 44 }}
              aria-label="Smart Inbox"
            >
              <Search size={19} />
            </button>

            <Link
              href="/app/notifications"
              className="nav-hover flex items-center justify-center relative rounded-xl transition-colors focus-ring"
              style={{ color: 'var(--text-muted)', width: 44, height: 44 }}
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            >
              <Bell size={19} />
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center text-white pointer-events-none"
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
