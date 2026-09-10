'use client'

import { Bell, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useState } from 'react'
import { SmartInbox } from '@/components/inbox/SmartInbox'

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
  unreadCount?: number
}

export function AppHeader({ unreadCount = 0 }: AppHeaderProps) {
  const pathname = usePathname()
  const title    = pageTitles[pathname] ?? 'LifeFlow'
  const [inboxOpen, setInboxOpen] = useState(false)

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="lg:hidden sticky top-0 z-20 safe-top"
        style={{
          height: 'var(--topbar-height, 56px)',
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(24px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
          borderBottom: '1px solid rgba(0,0,0,0.07)',
          boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
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
              className="p-2 rounded-xl transition-colors focus-ring"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Smart Inbox"
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Search size={19} />
            </button>

            {/* Notifications */}
            <Link
              href="/app/notifications"
              className="relative p-2 rounded-xl transition-colors focus-ring"
              style={{ color: 'var(--text-muted)' }}
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
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
