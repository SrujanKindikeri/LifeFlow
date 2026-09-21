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

// ── Tiny sidebar avatar ───────────────────────────────────────────────────────
interface SidebarAvatarProps {
  avatar?: string | null
  initials: string
  isActive: boolean
}

function SidebarAvatar({ avatar, initials, isActive }: SidebarAvatarProps) {
  if (avatar) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={avatar}
        alt="Profile"
        className={cn(
          'w-[15px] h-[15px] rounded-full object-cover shrink-0 ring-1',
          isActive ? 'ring-indigo-500/50' : 'ring-black/10',
        )}
        draggable={false}
      />
    )
  }
  return (
    <span
      className="w-[15px] h-[15px] rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 leading-none select-none"
      style={{
        background: isActive
          ? 'rgba(37,99,235,0.2)'
          : 'linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.14))',
        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
        border: '1px solid rgba(99,102,241,0.25)',
      }}
    >
      {initials}
    </span>
  )
}

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

  // ── User identity (avatar + name for the Profile nav item) ───────────────
  const [userAvatar,   setUserAvatar]   = useState<string | null>(null)
  const [userInitials, setUserInitials] = useState<string>('?')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.user) return
        const name: string = d.user.name ?? ''
        const initials = name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?'
        setUserInitials(initials)
        setUserAvatar(d.user.avatar ?? null)
      })
      .catch(() => {})
  }, [pathname])

  // Fetch draft count for the badge
  useEffect(() => {
    fetch('/api/drafts/count')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setDraftCount(d.count) })
      .catch(() => {})
  }, [pathname])

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
      className="hidden lg:flex flex-col p-3"
      style={{
        /*
          Fixed positioning — sidebar stays anchored to the viewport regardless
          of how far the main content has scrolled.  top:0 + bottom:0 fills the
          full viewport height without needing an explicit height value, which
          correctly handles dvh/svh environments and browser-chrome resizing.
        */
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 'var(--sidebar-width, 252px)',
        /*
          z-index 20 — sits above normal page content (z-0) and the mobile
          AppHeader (z-20, but hidden at lg+), and below modals/toasts/dialogs
          which use z-30 and above.  Matches the existing stacking system.
        */
        zIndex: 20,
      }}
      aria-label="Main sidebar"
    >
      {/* Floating glass sidebar panel
          height: 100% fills the full aside height (top:0 + bottom:0 via fixed
          positioning = full viewport height minus 24px padding from p-3).
          overflow: hidden clips children to the rounded corners and hides the nav
          scrollbar gutter from the outer panel edge — the inner nav handles its own
          scroll independently.
      */}
      <div
        className="glass-panel glass-catchlight flex flex-col rounded-2xl py-4 overflow-hidden"
        style={{
          height: '100%',
          minHeight: 0,
          paddingLeft: '10px',
          paddingRight: '10px',
          border: '1px solid var(--glass-panel-border)',
          boxShadow: 'var(--glass-panel-shadow), inset 0 1px 0 var(--glass-catchlight)',
        }}
      >

        {/* ── Logo — flex-shrink-0 so it never scrolls away ── */}
        <div className="flex mb-5 flex-shrink-0 px-1">
          <Link
            href="/app/dashboard"
            className="nav-hover flex items-center gap-2.5 px-3 py-2.5 w-full rounded-xl transition-colors group"
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
            <span className="text-[16px] font-bold text-gradient tracking-tight overflow-hidden whitespace-nowrap">
              LifeFlow
            </span>
          </Link>
        </div>

        {/* ── Nav groups ──
            flex-1:         takes all remaining vertical space between logo and footer
            min-h-0:        CRITICAL — without this, a flex child won't shrink below
                            its natural content height, so on short screens the footer
                            gets pushed below the viewport.  min-h-0 allows the flex
                            algorithm to shrink this area and activate overflow-y-auto.
            overflow-y-auto: scrolls when items exceed available height
            overflow-x-hidden: prevents horizontal scroll
            sidebar-nav-scroll: CSS class in globals.css that applies a subtle thin
                            scrollbar (thin on Firefox, custom-styled on WebKit).
        */}
        <nav
          className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto overflow-x-hidden sidebar-nav-scroll"
          aria-label="Main navigation"
        >
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {/* Group label */}
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
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className="w-full"
                    >
                      <div className="relative w-full">
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-pill"
                            className="absolute inset-0 nav-active-pill rounded-xl"
                            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                          />
                        )}
                        <motion.div
                          whileHover={{ x: isActive ? 0 : 2 }}
                          whileTap={{ scale: 0.97 }}
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
                            className="shrink-0 transition-all"
                            style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                          />
                          <span className="flex-1 overflow-hidden whitespace-nowrap">
                            {item.label}
                          </span>
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
        <div className="my-2 mx-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }} />

        {/* ── Bottom items — flex-shrink-0 keeps footer pinned at the bottom
            even when the nav above is very tall.  Only the nav scrolls. ── */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          {bottomItems.map((item) => {
            const isActive = pathname === item.href
            const isProfile = item.href === '/app/profile'
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className="w-full"
              >
                <motion.div
                  whileHover={{ x: 2 }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors w-full',
                    isActive ? 'nav-active-pill' : 'nav-hover'
                  )}
                  style={{
                    color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                  }}
                >
                  {isProfile ? (
                    <SidebarAvatar
                      avatar={userAvatar}
                      initials={userInitials}
                      isActive={isActive}
                    />
                  ) : (
                    <item.icon
                      size={15}
                      className="shrink-0"
                      style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                    />
                  )}
                  <span className="overflow-hidden whitespace-nowrap">{item.label}</span>
                </motion.div>
              </Link>
            )
          })}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full text-left mt-0.5"
          >
            <motion.div
              whileHover={{ x: 2 }}
              className="nav-hover-danger flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors w-full"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger-text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <LogOut size={15} className="shrink-0" />
              <span className="overflow-hidden whitespace-nowrap">Logout</span>
            </motion.div>
          </button>
        </div>

      </div>
    </aside>
  )
}
