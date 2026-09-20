'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, StickyNote, CheckSquare,
  Flame, Wallet, BarChart3, Bell, User, LogOut,
  FolderOpen, CreditCard,
  PiggyBank, Users, Calendar, TrendingUp, Activity,
  BarChart2, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useEffect, useState } from 'react'

/* ── Nav structure ──────────────────────────────────────────────────────── */
const navGroups = [
  {
    label: null,
    items: [
      { href: '/app/dashboard', icon: LayoutDashboard, label: 'Home' },
    ],
  },
  {
    label: 'Personal',
    items: [
      { href: '/app/notes',           icon: StickyNote,   label: 'Notes'           },
      { href: '/app/tasks',           icon: CheckSquare,  label: 'Tasks'           },
      { href: '/app/habits',          icon: Flame,         label: 'Habits'          },
      { href: '/app/projects',        icon: FolderOpen,    label: 'Projects'        },
      { href: '/app/drafts',          icon: BookOpen,      label: 'Drafts'          },
      { href: '/app/calendar',        icon: Calendar,      label: 'Calendar'        },
      { href: '/app/activity',        icon: Activity,      label: 'Activity'        },
      { href: '/app/weekly-planning', icon: Calendar,      label: 'Weekly Planning' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/app/expenses',         icon: Wallet,        label: 'Expenses'        },
      { href: '/app/subscriptions',    icon: CreditCard,    label: 'Subscriptions'   },
      { href: '/app/savings',          icon: PiggyBank,     label: 'Savings Goals'   },
      { href: '/app/budgets',          icon: BarChart2,     label: 'Budgets'         },
      { href: '/app/people',           icon: Users,         label: 'People'          },
      { href: '/app/financial-review', icon: TrendingUp,    label: 'Financial Review'},
      { href: '/app/analytics',        icon: BarChart3,     label: 'Analytics'       },
    ],
  },
]

const bottomItems = [
  { href: '/app/notifications', icon: Bell, label: 'Notifications' },
  { href: '/app/profile',       icon: User, label: 'Profile'       },
]

/* ── Component ──────────────────────────────────────────────────────────── */
export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { success, error } = useToast()
  const [draftCount, setDraftCount] = useState<number>(0)

  // Fetch draft count for the badge
  useEffect(() => {
    fetch('/api/drafts/count')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setDraftCount(d.count) })
      .catch(() => {})
  }, [pathname]) // re-fetch when navigating so count stays fresh

  async function handleLogout() {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        success('Logged out')
        router.push('/login')
        router.refresh()
      }
    } catch {
      error('Failed to logout')
    }
  }

  return (
    <aside
      className="hidden lg:flex flex-col shrink-0 h-screen sticky top-0 p-3"
      style={{ width: 'var(--sidebar-width, 252px)' }}
    >
      {/* Floating glass sidebar panel — liquid glass with catch-light and depth */}
      <div
        className="glass-panel glass-catchlight flex flex-col h-full rounded-2xl py-4 px-2.5"
        style={{
          border: '1px solid var(--glass-panel-border)',
          boxShadow: 'var(--glass-panel-shadow), inset 0 1px 0 var(--glass-catchlight)',
        }}
      >

        {/* ── Logo ── */}
        <Link
          href="/app/dashboard"
          className="nav-hover flex items-center gap-2.5 px-3 py-2.5 mb-5 rounded-xl transition-colors group"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px] flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
              border: '1px solid rgba(37,99,235,0.16)',
              boxShadow: '0 2px 8px rgba(37,99,235,0.12)',
            }}
          >
            ⚡
          </div>
          <span className="text-[16px] font-bold text-gradient tracking-tight">
            LifeFlow
          </span>
        </Link>

        {/* ── Nav groups ── */}
        <nav className="flex-1 flex flex-col gap-4 overflow-y-auto" aria-label="Main navigation">
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.12em] px-3 mb-1"
                  style={{ color: 'var(--text-faint)' }}
                >
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <Link key={item.href} href={item.href} aria-current={isActive ? 'page' : undefined}>
                      <div className="relative">
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-pill"
                            className="absolute inset-0 nav-active-pill rounded-xl"
                            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                          />
                        )}
                        <motion.div
                          whileHover={{ x: isActive ? 0 : 2 }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                          className={cn(
                            'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors',
                            !isActive && 'nav-hover'
                          )}
                          style={{
                            color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                          }}
                        >
                          <item.icon
                            size={15}
                            className="shrink-0 transition-colors"
                            style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                          />
                          <span className="flex-1">{item.label}</span>
                          {/* Draft count badge */}
                          {item.href === '/app/drafts' && draftCount > 0 && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                              style={{
                                background: isActive ? 'rgba(37,99,235,0.18)' : 'var(--accent-dim)',
                                color: 'var(--accent)',
                              }}
                            >
                              {draftCount > 99 ? '99+' : draftCount}
                            </span>
                          )}
                        </motion.div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Divider ── */}
        <div className="my-2" style={{ borderTop: '1px solid var(--border)' }} />

        {/* ── Bottom items ── */}
        <div className="flex flex-col gap-0.5">
          {bottomItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link key={item.href} href={item.href} aria-current={isActive ? 'page' : undefined}>
                <motion.div
                  whileHover={{ x: 2 }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors',
                    isActive ? 'nav-active-pill' : 'nav-hover'
                  )}
                  style={{
                    color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                  }}
                >
                  <item.icon
                    size={15}
                    className="shrink-0"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                  />
                  {item.label}
                </motion.div>
              </Link>
            )
          })}

          <button onClick={handleLogout} className="w-full text-left mt-0.5">
            <motion.div
              whileHover={{ x: 2 }}
              className="nav-hover-danger flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--danger-text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              <LogOut size={15} className="shrink-0" />
              Logout
            </motion.div>
          </button>
        </div>

      </div>
    </aside>
  )
}
