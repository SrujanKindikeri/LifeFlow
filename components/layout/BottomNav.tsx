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
import { useState, useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'

const mainNav = [
  { href: '/app/dashboard', icon: LayoutDashboard, label: 'Home'     },
  { href: '/app/tasks',     icon: CheckSquare,     label: 'Tasks'    },
  { href: '/app/habits',    icon: Flame,            label: 'Habits'   },
  { href: '/app/expenses',  icon: Wallet,           label: 'Expenses' },
]

const moreNav = [
  { href: '/app/notes',            icon: StickyNote,  label: 'Notes'            },
  { href: '/app/projects',         icon: FolderOpen,   label: 'Projects'         },
  { href: '/app/drafts',           icon: BookOpen,     label: 'Drafts'           },
  { href: '/app/subscriptions',    icon: CreditCard,   label: 'Subscriptions'    },
  { href: '/app/savings',          icon: PiggyBank,    label: 'Savings'          },
  { href: '/app/budgets',          icon: BarChart2,    label: 'Budgets'          },
  { href: '/app/people',           icon: Users,        label: 'People'           },
  { href: '/app/calendar',         icon: Calendar,     label: 'Calendar'         },
  { href: '/app/financial-review', icon: TrendingUp,   label: 'Financial Review' },
  { href: '/app/activity',         icon: Activity,     label: 'Activity'         },
  { href: '/app/analytics',        icon: BarChart3,    label: 'Analytics'        },
  { href: '/app/notifications',    icon: Bell,         label: 'Notifications'    },
  { href: '/app/profile',          icon: User,         label: 'Profile'          },
]

export function BottomNav() {
  const pathname = usePathname()
  const router   = useRouter()
  const { success, error } = useToast()
  const [moreOpen, setMoreOpen] = useState(false)

  // Ref on the More button so pointer-down outside the panel closes it
  const moreBtnRef  = useRef<HTMLButtonElement>(null)
  const panelRef    = useRef<HTMLDivElement>(null)

  /* ── FAB signal + Escape key when panel is open ── */
  useEffect(() => {
    if (!moreOpen) return

    // Signal to CSS: hide the FAB while the panel is open.
    // DashboardClient FAB uses [data-more-open] selector in globals.css.
    document.body.setAttribute('data-more-open', 'true')

    // Escape key closes panel
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false)
    }

    // Pointer-down outside the panel + More button closes it
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        panelRef.current  && !panelRef.current.contains(target) &&
        moreBtnRef.current && !moreBtnRef.current.contains(target)
      ) {
        setMoreOpen(false)
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)

    return () => {
      document.body.removeAttribute('data-more-open')
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [moreOpen])

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
      {/*
        ── Floating More Panel ───────────────────────────────────────────────
        On mobile/tablet (< lg), tapping "More" opens a compact floating
        panel anchored to the right side of the screen, just above the
        bottom navigation bar.

        Design goals:
        • Does NOT move, resize or blur the dashboard
        • Does NOT use a bottom sheet / full-width overlay
        • Is a fixed-position popover above the nav bar, right-aligned
        • Has its own internal scroll when content overflows
        • Matches the LifeFlow Liquid Glass visual system

        z-index hierarchy:
          bottom-bar     z-30
          panel          z-50   (no backdrop needed — pointerdown handles close)
        ─────────────────────────────────────────────────────────────────────
      */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            className="lg:hidden"
            style={{
              /* ── Positioning ── */
              position: 'fixed',
              /*
                Right edge: respect safe-area (notch / Dynamic Island on landscape)
                plus a comfortable visual gap from the screen edge.
              */
              right: 'max(calc(env(safe-area-inset-right, 0px) + 8px), 8px)',
              /*
                Bottom edge: sit exactly above the bottom nav bar.
                --bottomnav-total-height = bottomnav-height (56px) + safe-area-inset-bottom.
                Add a small 8px gap between panel and bar.
              */
              bottom: 'calc(var(--bottomnav-total-height, 56px) + 8px)',
              zIndex: 50,

              /* ── Size ──
                Width is responsive:
                  - 320-359px phones:  ~240px
                  - 360-389px phones:  ~260px
                  - 390-413px phones:  ~270px
                  - 414px+ phones:     ~280px
                  - 600px+ tablets:    ~300px
                  - 768px+ tablets:    ~310px
                min() ensures it never exceeds the available viewport width
                minus a safe margin (so it never bleeds off screen).
              */
              width: 'min(clamp(240px, 68vw, 310px), calc(100vw - 24px))',

              /*
                Max-height: use the dvh unit so mobile browser chrome
                (address/tab bar) is excluded. Leave room for the bottom
                nav + safe area + the 8px gap + 16px top breathing room.
              */
              maxHeight: 'calc(100dvh - var(--bottomnav-total-height, 56px) - 32px)',

              /* ── Layout ── */
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',   /* clip children to rounded corners */

              /* ── Shape ── */
              borderRadius: 16,

              /* ── Liquid Glass surface ──
                Do NOT apply the glass-panel CSS class — it sets
                position:relative, which would override position:fixed.
                Apply the same glass tokens directly via inline style.
              */
              background: 'var(--glass-panel-bg)',
              backdropFilter: 'blur(var(--glass-panel-blur, 32px)) saturate(var(--glass-panel-saturate, 1.8))',
              WebkitBackdropFilter: 'blur(var(--glass-panel-blur, 32px)) saturate(var(--glass-panel-saturate, 1.8))',
              border: '1px solid var(--glass-panel-border)',
              boxShadow: [
                '0 8px 40px rgba(0,0,0,0.18)',
                '0 2px 12px rgba(0,0,0,0.10)',
                'inset 0 1px 0 rgba(255,255,255,0.22)',
              ].join(', '),
            }}
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.94, y: 10 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* ── Scrollable list ─────────────────────────────────────── */}
            <div
              className="overflow-y-auto overscroll-contain"
              style={{
                WebkitOverflowScrolling: 'touch',
                /* Thin scrollbar on platforms that show them */
                scrollbarWidth: 'thin',
              }}
            >
              {/* Nav items */}
              <div className="py-1.5 px-1.5">
                {moreNav.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex items-center gap-2.5 px-3 rounded-xl',
                        'transition-colors',
                        isActive ? 'nav-active-pill' : 'nav-hover'
                      )}
                      style={{
                        height: 40,
                        color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                      }}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <item.icon
                        size={16}
                        style={{
                          color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      />
                      <span
                        className="flex-1 text-[13px] font-medium leading-none whitespace-nowrap"
                      >
                        {item.label}
                      </span>
                    </Link>
                  )
                })}
              </div>

              {/* Separator before Logout */}
              <div
                className="mx-3"
                style={{ height: 1, background: 'var(--border)' }}
              />

              {/* Logout */}
              <div className="py-1.5 px-1.5">
                <button
                  onClick={() => { setMoreOpen(false); void handleLogout() }}
                  className="nav-hover-danger flex items-center gap-2.5 px-3 rounded-xl w-full transition-colors"
                  style={{
                    height: 40,
                    color: 'var(--danger)',
                  }}
                >
                  <LogOut
                    size={16}
                    aria-hidden="true"
                    style={{ flexShrink: 0, color: 'var(--danger)' }}
                  />
                  <span className="text-[13px] font-medium leading-none whitespace-nowrap">
                    Logout
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        ── Bottom bar ──────────────────────────────────────────────────────
        Visual design (Liquid Glass / Apple-inspired):
          • rounded-t-2xl: softly rounds the top corners of the bar
          • glass-panel:   backdrop-blur + translucent background
          • border-top + inset catchlight: crisp top edge definition
          • box-shadow:    lifts the bar above page content visually

        Height layout on iPhone with Home indicator:
          • Visual icon + label row: 56px  (--bottomnav-height)
          • padding-bottom:  env(safe-area-inset-bottom) clears home bar
          • Total height auto-grows with safe area — never clips content

        On Android (no safe area): padding-bottom = 0px, total = 56px.
        On notched iPhone: padding-bottom ≈ 34px, total ≈ 90px.

        The CSS variable --bottomnav-height (56px) is used by pb-mobile-nav
        and the FAB to stay correctly spaced. The safe area is added on top
        of this in both places, so layout stays consistent.
        ────────────────────────────────────────────────────────────────────
      */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 rounded-t-2xl overflow-hidden"
        style={{
          /*
            Liquid Glass nav panel styles:
            Use the same glass-panel tokens as the sidebar/header for
            visual consistency across navigation surfaces.
          */
          background: 'var(--glass-panel-bg)',
          backdropFilter: `blur(var(--glass-panel-blur, 32px)) saturate(var(--glass-panel-saturate, 1.8))`,
          WebkitBackdropFilter: `blur(var(--glass-panel-blur, 32px)) saturate(var(--glass-panel-saturate, 1.8))`,
          borderTop: '1px solid var(--glass-panel-border)',
          /*
            Subtle catchlight on the top edge — simulates light reflecting
            off the glass rim, matching the sidebar and header treatment.
          */
          boxShadow: [
            '0 -2px 20px rgba(0,0,0,0.08)',
            '0 -1px 6px rgba(0,0,0,0.05)',
            'inset 0 1px 0 rgba(255,255,255,0.18)',   /* top-edge highlight */
          ].join(', '),
          /* Let height grow with safe area — no fixed height on the bar */
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        aria-label="Bottom navigation"
      >
        {/*
          Inner row — always 56px tall.
          padding-left/right honours iPhone side safe areas (notch on
          landscape) without distorting the centred tab layout.
        */}
        <div
          className="flex items-stretch"
          style={{
            height: 56,
            paddingLeft:  'env(safe-area-inset-left,  0px)',
            paddingRight: 'env(safe-area-inset-right, 0px)',
          }}
        >
          {mainNav.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex-1 min-w-0"
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
              >
                <motion.div
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="relative flex flex-col items-center justify-center gap-[3px] h-full w-full px-1"
                >
                  {/* Active background pill */}
                  {isActive && (
                    <motion.div
                      layoutId="bottom-nav-active-bg"
                      className="absolute inset-x-2 inset-y-1.5 rounded-xl"
                      style={{ background: 'var(--accent-dim)' }}
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                      aria-hidden="true"
                    />
                  )}

                  {/* Icon */}
                  <div className="relative z-10">
                    <item.icon
                      size={20}
                      className="transition-all duration-150"
                      style={{
                        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                        strokeWidth: isActive ? 2.2 : 1.8,
                      }}
                      aria-hidden="true"
                    />
                  </div>

                  {/* Label */}
                  <span
                    className="relative z-10 text-[10px] font-semibold leading-none transition-all duration-150 truncate max-w-[52px] text-center"
                    style={{
                      color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                      letterSpacing: isActive ? '0.01em' : '0',
                    }}
                  >
                    {item.label}
                  </span>
                </motion.div>
              </Link>
            )
          })}

          {/* ── More button ── */}
          <button
            ref={moreBtnRef}
            className="flex-1 min-w-0"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-label="More navigation options"
          >
            <motion.div
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="relative flex flex-col items-center justify-center gap-[3px] h-full w-full px-1"
            >
              {/* Active background when a "more" page is active or menu is open */}
              {(moreOpen || moreIsActive) && (
                <motion.div
                  layoutId="bottom-nav-more-bg"
                  className="absolute inset-x-2 inset-y-1.5 rounded-xl"
                  style={{ background: 'var(--accent-dim)' }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  aria-hidden="true"
                />
              )}

              <div className="relative z-10">
                <MoreHorizontal
                  size={20}
                  className="transition-all duration-150"
                  style={{
                    color: moreOpen || moreIsActive ? 'var(--accent)' : 'var(--text-muted)',
                    strokeWidth: moreOpen || moreIsActive ? 2.2 : 1.8,
                  }}
                  aria-hidden="true"
                />
              </div>

              <span
                className="relative z-10 text-[10px] font-semibold leading-none transition-all duration-150"
                style={{
                  color: moreOpen || moreIsActive ? 'var(--accent)' : 'var(--text-muted)',
                  letterSpacing: moreOpen || moreIsActive ? '0.01em' : '0',
                }}
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
