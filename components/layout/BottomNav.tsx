'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, CheckSquare, Flame, Wallet,
  MoreHorizontal, StickyNote, BarChart3, Bell, User, LogOut,
  FolderOpen, Calendar, Activity, PiggyBank,
  Users, TrendingUp, CreditCard, BarChart2, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'

const mainNav = [
  { href: '/app/dashboard', icon: LayoutDashboard, label: 'Home'     },
  { href: '/app/tasks',     icon: CheckSquare,     label: 'Tasks'    },
  { href: '/app/habits',    icon: Flame,            label: 'Habits'   },
  { href: '/app/expenses',  icon: Wallet,           label: 'Expenses' },
]

const moreNav = [
  { href: '/app/notes',           icon: StickyNote,   label: 'Notes'           },
  { href: '/app/projects',        icon: FolderOpen,    label: 'Projects'        },
  { href: '/app/drafts',          icon: BookOpen,      label: 'Drafts'          },
  { href: '/app/subscriptions',   icon: CreditCard,    label: 'Subscriptions'   },
  { href: '/app/savings',         icon: PiggyBank,     label: 'Savings'         },
  { href: '/app/budgets',         icon: BarChart2,     label: 'Budgets'         },
  { href: '/app/people',          icon: Users,         label: 'People'          },
  { href: '/app/calendar',        icon: Calendar,      label: 'Calendar'        },
  { href: '/app/financial-review',icon: TrendingUp,    label: 'Financial Review'},
  { href: '/app/activity',        icon: Activity,      label: 'Activity'        },
  { href: '/app/analytics',       icon: BarChart3,     label: 'Analytics'       },
  { href: '/app/notifications',   icon: Bell,          label: 'Notifications'   },
  { href: '/app/profile',         icon: User,          label: 'Profile'         },
]

export function BottomNav() {
  const pathname = usePathname()
  const router   = useRouter()
  const { success, error } = useToast()
  const [moreOpen, setMoreOpen] = useState(false)

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

  const moreIsActive = moreNav.some((n) => pathname === n.href)

  return (
    <>
      {/* ── More menu overlay ── */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30 lg:hidden"
              style={{ background: 'rgba(0,0,0,0.08)', backdropFilter: 'blur(2px)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
            />
            <motion.nav
              className="glass-panel fixed right-3 z-40 py-1.5 min-w-[180px] rounded-2xl lg:hidden"
              style={{
                bottom: 'calc(var(--bottomnav-height, 68px) + 10px)',
                border: '1px solid var(--glass-panel-border)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)',
              }}
              initial={{ opacity: 0, scale: 0.88, y: 12 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              exit={{ opacity: 0,   scale: 0.88,  y: 8  }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              aria-label="More navigation"
            >
              {moreNav.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}>
                    <div
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors mx-1 rounded-xl',
                        isActive ? 'nav-active-pill' : 'nav-hover'
                      )}
                      style={{
                        color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                      }}
                    >
                      <item.icon size={15} style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                      {item.label}
                    </div>
                  </Link>
                )
              })}

              <div className="mx-3 my-1" style={{ borderTop: '1px solid var(--border)' }} />

              <button
                onClick={handleLogout}
                className="nav-hover-danger flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors rounded-xl"
                style={{ color: 'var(--danger)', width: 'calc(100% - 8px)', margin: '0 4px' }}
              >
                <LogOut size={15} />
                Logout
              </button>
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      {/* ── Bottom bar — uses CSS variables so dark mode works ── */}
      <nav
        className="glass-panel lg:hidden fixed bottom-0 left-0 right-0 z-30"
        style={{
          height: 'var(--bottomnav-height, 68px)',
          borderTop: '1px solid var(--glass-panel-border)',
          boxShadow: '0 -2px 16px rgba(0,0,0,0.06), 0 -1px 4px rgba(0,0,0,0.04)',
        }}
        aria-label="Bottom navigation"
      >
        <div className="flex items-center justify-around h-full px-2 safe-bottom">
          {mainNav.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link key={item.href} href={item.href} className="flex-1" aria-current={isActive ? 'page' : undefined}>
                <motion.div
                  whileTap={{ scale: 0.88 }}
                  className="flex flex-col items-center gap-1 py-1"
                >
                  <div className="relative">
                    <item.icon
                      size={21}
                      className="transition-colors duration-150"
                      style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                    />
                    {isActive && (
                      <motion.div
                        layoutId="bottom-nav-dot"
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                        style={{ background: 'var(--accent)' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                  </div>
                  <span
                    className="text-[10px] font-medium transition-colors duration-150"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                  >
                    {item.label}
                  </span>
                </motion.div>
              </Link>
            )
          })}

          {/* More button */}
          <button className="flex-1" onClick={() => setMoreOpen((v) => !v)}>
            <motion.div
              whileTap={{ scale: 0.88 }}
              className="flex flex-col items-center gap-1 py-1"
            >
              <MoreHorizontal
                size={21}
                className="transition-colors duration-150"
                style={{ color: moreOpen || moreIsActive ? 'var(--accent)' : 'var(--text-muted)' }}
              />
              <span
                className="text-[10px] font-medium transition-colors duration-150"
                style={{ color: moreOpen || moreIsActive ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                More
              </span>
            </motion.div>
          </button>
        </div>
      </nav>
    </>
  )
}
