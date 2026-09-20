'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, LayoutDashboard, CheckSquare, Flame, Wallet, StickyNote,
  BarChart3, Bell, User, Target, FolderOpen, CreditCard,
  PiggyBank, Users, Calendar, TrendingUp, Activity, Plus, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Command {
  id: string
  label: string
  icon: React.ReactNode
  group: 'navigate' | 'create'
  action: () => void
  keywords?: string[]
}

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Build commands
  const commands: Command[] = [
    // Navigation
    { id: 'nav-dashboard',    label: 'Dashboard',           icon: <LayoutDashboard size={14}/>, group: 'navigate', action: () => router.push('/app/dashboard'),       keywords: ['home'] },
    { id: 'nav-notes',        label: 'Notes',               icon: <StickyNote   size={14}/>, group: 'navigate', action: () => router.push('/app/notes')            },
    { id: 'nav-tasks',        label: 'Tasks',               icon: <CheckSquare  size={14}/>, group: 'navigate', action: () => router.push('/app/tasks')            },
    { id: 'nav-habits',       label: 'Habits',              icon: <Flame        size={14}/>, group: 'navigate', action: () => router.push('/app/habits')           },
    { id: 'nav-expenses',     label: 'Expenses',            icon: <Wallet       size={14}/>, group: 'navigate', action: () => router.push('/app/expenses')         },
    { id: 'nav-analytics',    label: 'Analytics',           icon: <BarChart3    size={14}/>, group: 'navigate', action: () => router.push('/app/analytics')        },
    { id: 'nav-goals',        label: 'Projects → Goals',    icon: <Target       size={14}/>, group: 'navigate', action: () => router.push('/app/projects?tab=goals'),      keywords: ['goals'] },
    { id: 'nav-projects',     label: 'Projects',            icon: <FolderOpen   size={14}/>, group: 'navigate', action: () => router.push('/app/projects')         },
    { id: 'nav-subscriptions',label: 'Subscriptions',       icon: <CreditCard   size={14}/>, group: 'navigate', action: () => router.push('/app/subscriptions')    },
    { id: 'nav-savings',      label: 'Savings Goals',       icon: <PiggyBank    size={14}/>, group: 'navigate', action: () => router.push('/app/savings')          },
    { id: 'nav-people',       label: 'People',              icon: <Users        size={14}/>, group: 'navigate', action: () => router.push('/app/people')           },
    { id: 'nav-budgets',      label: 'Budgets',             icon: <BarChart3    size={14}/>, group: 'navigate', action: () => router.push('/app/budgets')          },
    { id: 'nav-calendar',     label: 'Calendar',            icon: <Calendar     size={14}/>, group: 'navigate', action: () => router.push('/app/calendar')         },
    { id: 'nav-review',       label: 'Financial Review',    icon: <TrendingUp   size={14}/>, group: 'navigate', action: () => router.push('/app/financial-review') },
    { id: 'nav-weekly',       label: 'Weekly Planning',     icon: <Calendar     size={14}/>, group: 'navigate', action: () => router.push('/app/weekly-planning')  },
    { id: 'nav-activity',     label: 'Activity Timeline',   icon: <Activity     size={14}/>, group: 'navigate', action: () => router.push('/app/activity')         },
    { id: 'nav-notif',        label: 'Notifications',       icon: <Bell         size={14}/>, group: 'navigate', action: () => router.push('/app/notifications')    },
    { id: 'nav-profile',      label: 'Profile',             icon: <User         size={14}/>, group: 'navigate', action: () => router.push('/app/profile')          },
    { id: 'nav-drafts',       label: 'Drafts',              icon: <BookOpen     size={14}/>, group: 'navigate', action: () => router.push('/app/drafts'),           keywords: ['draft', 'unfinished', 'continue'] },
    { id: 'search-drafts',    label: 'Search Drafts',       icon: <BookOpen     size={14}/>, group: 'navigate', action: () => router.push('/app/drafts'),           keywords: ['search draft', 'find draft'] },
    // Quick add (navigate to page with ?new=1 to trigger modal)
    { id: 'new-task',         label: 'Add Task',            icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/tasks?new=1'),        keywords: ['create task'] },
    { id: 'new-note',         label: 'Add Note',            icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/notes?new=1'),        keywords: ['create note'] },
    { id: 'new-habit',        label: 'Add Habit',           icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/habits?new=1'),       keywords: ['create habit'] },
    { id: 'new-expense',      label: 'Add Expense',         icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/expenses?new=1'),     keywords: ['create expense'] },
    { id: 'new-goal',         label: 'Add Goal',            icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/projects?tab=goals&new=1'), keywords: ['create goal'] },
    { id: 'new-project',      label: 'Add Project',         icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/projects?new=1'),     keywords: ['create project'] },
    { id: 'new-subscription', label: 'Add Subscription',    icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/subscriptions?new=1'),keywords: ['create subscription'] },
    { id: 'new-savings',      label: 'Add Savings Goal',    icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/savings?new=1'),      keywords: ['create savings'] },
    { id: 'new-person',       label: 'Add Person',          icon: <Plus         size={14}/>, group: 'create', action: () => router.push('/app/people?new=1'),       keywords: ['create person'] },
  ]

  const filtered = query.trim()
    ? commands.filter((c) => {
        const q = query.toLowerCase()
        return c.label.toLowerCase().includes(q) || c.keywords?.some((k) => k.includes(q))
      })
    : commands

  const groups = ['navigate', 'create'] as const
  const groupLabels = { navigate: 'Go to', create: 'Create' }

  function execute(cmd: Command) {
    setOpen(false)
    setQuery('')
    cmd.action()
  }

  // Keyboard handler — uses capture phase so it runs before page-level handlers.
  // If a page component has already called e.preventDefault() (e.g. DashboardClient
  // opening GlobalSearch), we skip toggling the palette so the two don't fight.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Yield to a page that already claimed this shortcut
        if (e.defaultPrevented) return
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setActiveIdx(0)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    // Use capture:false so page handlers (registered normally) run first
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  // Clamp activeIdx to valid range whenever filtered list or activeIdx changes
  const clampedActiveIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1))

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i+1, filtered.length-1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i-1, 0)) }
    if (e.key === 'Enter' && filtered[clampedActiveIdx]) { execute(filtered[clampedActiveIdx]) }
    if (e.key === 'Escape') { setOpen(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, clampedActiveIdx])

  return (
    <>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0"
              style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
              onClick={() => setOpen(false)}
            />

            {/* Palette — glass-floating adapts to dark mode via CSS vars */}
            <motion.div
              className="glass-floating relative w-full max-w-lg rounded-2xl overflow-hidden"
              style={{
                boxShadow: 'var(--glass-shadow-xl)',
                maxHeight: '70vh',
              }}
              initial={{ opacity:0, scale:0.94, y:-12 }}
              animate={{ opacity:1, scale:1, y:0 }}
              exit={{ opacity:0, scale:0.94, y:-8 }}
              transition={{ type:'spring', stiffness:460, damping:34 }}
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <Search size={16} style={{ color: 'var(--text-faint)', flexShrink:0 }} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search or jump to…"
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: 'var(--text-primary)' }}
                />
                <kbd
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-mono"
                  style={{ background: 'var(--border-strong)', color: 'var(--text-faint)' }}
                >
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 60px)' }}>
                {filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    No results for &quot;{query}&quot;
                  </div>
                ) : (
                  groups.map((group) => {
                    const items = filtered.filter((c) => c.group === group)
                    if (items.length === 0) return null
                    return (
                      <div key={group} className="py-1.5">
                        <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
                          {groupLabels[group]}
                        </p>
                        {items.map((cmd) => {
                          const idx = filtered.findIndex((c) => c.id === cmd.id)
                          const isActive = idx === clampedActiveIdx
                          return (
                            <button
                              key={cmd.id}
                              onMouseEnter={() => setActiveIdx(idx)}
                              onClick={() => execute(cmd)}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors',
                                isActive ? 'nav-hover' : ''
                              )}
                              style={{
                                color: 'var(--text-secondary)',
                                background: isActive ? 'var(--nav-hover-bg)' : undefined,
                              }}
                            >
                              <span className="w-5 flex-shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--text-faint)' }}>
                                {cmd.icon}
                              </span>
                              {cmd.label}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
