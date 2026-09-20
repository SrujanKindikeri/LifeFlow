'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import Link from 'next/link'
import {
  CheckCircle2, Circle, Bell, Search, Flame, Wallet,
  StickyNote, CalendarDays, ArrowRight,
  Plus, Sparkles, Clock, Settings2, ArrowUpRight, ArrowDownLeft,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils'
import type { DashboardData, DashboardSectionPref } from '@/lib/dashboard'
import { QuickAddModal } from '@/components/dashboard/QuickAddModal'
import { FocusForToday } from '@/components/dashboard/FocusForToday'
import { StreakProtection } from '@/components/dashboard/StreakProtection'
import { SpendingWarningSection } from '@/components/dashboard/SpendingWarning'
import { TodayTimeline } from '@/components/dashboard/TodayTimeline'
import { WeeklyReview } from '@/components/dashboard/WeeklyReview'
import { GlobalSearch } from '@/components/dashboard/GlobalSearch'
import { GroupBillReminders } from '@/components/dashboard/GroupBillReminders'
import { ContinueSection } from '@/components/dashboard/ContinueSection'
import { DashboardCustomize } from '@/components/dashboard/DashboardCustomize'
import { DailyBriefing } from '@/components/briefing/DailyBriefing'
import { LifeFlowScore } from '@/components/score/LifeFlowScore'
import { DraftsContinueSection } from '@/components/drafts/DraftsContinueSection'

/* ── Animation variants ─────────────────────────────────────────────────── */
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
}
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function getDateLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
function getTimeGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}
function getUpcomingLabel(dateStr: string) {
  const diff = Math.round(
    (new Date(dateStr).getTime() - new Date(new Date().toISOString().split('T')[0]).getTime()) / 86400000
  )
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' })
}
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type QuickAddType = 'task' | 'habit' | 'expense' | 'note' | 'splitbill' | 'money_given' | 'money_borrowed' | null

interface Props { data: DashboardData }

/* ── Skeleton loader — reserved for future async section loading ───────────── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SectionSkeleton() {
  return (
    <div className="glass rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-xl bg-black/[0.06]" />
        <div className="h-3 w-28 rounded-full bg-black/[0.06]" />
      </div>
      <div className="space-y-2.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-3 rounded-full bg-black/[0.05]" style={{ width: `${75 - i * 10}%` }} />
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD CLIENT
   ═══════════════════════════════════════════════════════════════════════════ */
export function DashboardClient({ data }: Props) {
  const { error: toastError } = useToast()

  /* ── Local state ── */
  const [tasks, setTasks] = useState(data.today.tasks)
  const [habits, setHabits] = useState(data.today.habits)
  const [quickAdd, setQuickAdd] = useState<QuickAddType>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [sectionPrefs, setSectionPrefs] = useState<DashboardSectionPref[]>(data.sectionPrefs)
  const [focusItems, setFocusItems] = useState(data.focus)
  const [streakRisks, setStreakRisks] = useState(data.streakRisks)

  /* ── Derived counts ── */
  const completedTasks = tasks.filter((t) => t.completed).length
  const completedHabits = habits.filter((h) => h.completedToday).length
  const totalItems = tasks.length + habits.length
  const progress = totalItems > 0 ? Math.round(((completedTasks + completedHabits) / totalItems) * 100) : 0

  /* ── Section visibility map ── */
  const sectionVisible = useMemo(() => {
    const map: Record<string, boolean> = {}
    const ordered = [...sectionPrefs].sort((a, b) => a.order - b.order)
    for (const s of ordered) map[s.id] = s.visible
    return map
  }, [sectionPrefs])

  const orderedSectionIds = useMemo(() =>
    [...sectionPrefs].sort((a, b) => a.order - b.order).map((s) => s.id),
    [sectionPrefs]
  )

  /* ── Optimistic toggles ── */
  const toggleTask = useCallback(async (id: string, cur: boolean) => {
    setTasks((p) => p.map((t) => t._id === id ? { ...t, completed: !cur } : t))
    try {
      const r = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !cur }),
      })
      if (!r.ok) {
        setTasks((p) => p.map((t) => t._id === id ? { ...t, completed: cur } : t))
        toastError('Failed to update task')
      }
    } catch {
      setTasks((p) => p.map((t) => t._id === id ? { ...t, completed: cur } : t))
      toastError('Failed')
    }
  }, [toastError])

  const toggleHabit = useCallback(async (id: string) => {
    const cur = habits.find((h) => h._id === id)?.completedToday ?? false
    setHabits((p) => p.map((h) => h._id === id ? { ...h, completedToday: !cur } : h))
    try {
      const r = await fetch('/api/habits/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habitId: id, completed: !cur }),
      })
      if (!r.ok) {
        setHabits((p) => p.map((h) => h._id === id ? { ...h, completedToday: cur } : h))
        toastError('Failed to update habit')
      }
    } catch {
      setHabits((p) => p.map((h) => h._id === id ? { ...h, completedToday: cur } : h))
      toastError('Failed')
    }
  }, [habits, toastError])

  /* ── Focus item completed callback ── */
  const handleFocusCompleted = useCallback((id: string, type: 'task' | 'habit') => {
    setFocusItems((prev) => prev.map((i) => i._id === id ? { ...i, completed: true } : i))
    if (type === 'task') {
      setTasks((p) => p.map((t) => t._id === id ? { ...t, completed: true } : t))
    } else {
      setHabits((p) => p.map((h) => h._id === id ? { ...h, completedToday: true } : h))
      setStreakRisks((prev) => prev.filter((h) => h._id !== id))
    }
  }, [])

  /* ── Streak protection completed callback ── */
  const handleStreakCompleted = useCallback((habitId: string) => {
    setHabits((p) => p.map((h) => h._id === habitId ? { ...h, completedToday: true } : h))
    setStreakRisks((prev) => prev.filter((h) => h._id !== habitId))
    setFocusItems((prev) => prev.map((i) => i._id === habitId ? { ...i, completed: true } : i))
  }, [])

  /* ── Keyboard shortcut: Cmd/Ctrl+K opens search, / also opens ── */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K — but not when typing in an input
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      // Legacy '/' shortcut
      if (e.key === '/' && !searchOpen) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [searchOpen])

  /* ── Render a section by id ── */
  function renderSection(id: string) {
    switch (id) {
      case 'focus':
        return (
          <motion.div key="focus" variants={fadeUp}>
            <FocusForToday items={focusItems} onItemCompleted={handleFocusCompleted} />
          </motion.div>
        )

      case 'streakProtection':
        return streakRisks.length > 0 ? (
          <motion.div key="streakProtection" variants={fadeUp}>
            <StreakProtection habits={streakRisks} onCompleted={handleStreakCompleted} />
          </motion.div>
        ) : null

      case 'timeline':
        return (
          <motion.div key="timeline" variants={fadeUp}>
            <TodayTimeline
              items={data.timeline}
              onAddTask={() => setQuickAdd('task')}
            />
          </motion.div>
        )

      case 'tasks':
        return (
          <motion.div key="tasks" variants={fadeUp}>
            <GlassCard padding="md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-indigo-400" />
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Today&apos;s Tasks</h2>
                  {tasks.length > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-medium">
                      {completedTasks}/{tasks.length}
                    </span>
                  )}
                </div>
                <Link href="/app/tasks" className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors" style={{ color: 'var(--text-faint)' }}>
                  View all <ArrowRight size={10} />
                </Link>
              </div>
              {tasks.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-11 h-11 rounded-2xl glass flex items-center justify-center text-lg mx-auto mb-3">✅</div>
                  <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>No tasks for today</p>
                  <button onClick={() => setQuickAdd('task')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mx-auto transition-colors">
                    <Plus size={11} /> Add a task
                  </button>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {tasks.slice(0, 6).map((task) => (
                    <motion.div key={task._id} layout className="group flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                      <button onClick={() => toggleTask(task._id, task.completed)} className="flex-shrink-0 transition-transform active:scale-90" aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}>
                        <AnimatePresence mode="wait" initial={false}>
                          {task.completed
                            ? <motion.div key="checked" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }} transition={{ duration: 0.14 }}><CheckCircle2 size={18} className="text-indigo-400" /></motion.div>
                            : <motion.div key="unchecked" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }} transition={{ duration: 0.14 }}><Circle size={18} style={{ color: 'var(--text-faint)' }} /></motion.div>
                          }
                        </AnimatePresence>
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={cn('text-sm block truncate transition-all', task.completed ? 'line-through' : '')}>{task.title}</span>
                        {task.dueTime && <span className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-faint)' }}><Clock size={10} />{task.dueTime}</span>}
                      </div>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                        task.priority === 'high' && 'bg-red-500/10 text-red-400',
                        task.priority === 'medium' && 'bg-amber-500/10 text-amber-400',
                        task.priority === 'low' && 'bg-emerald-500/10 text-emerald-400'
                      )}>
                        {task.priority}
                      </span>
                    </motion.div>
                  ))}
                  {tasks.length > 6 && <p className="text-[11px] text-center pt-2" style={{ color: 'var(--text-faint)' }}>+{tasks.length - 6} more</p>}
                </div>
              )}
            </GlassCard>
          </motion.div>
        )

      case 'habits':
        return (
          <motion.div key="habits" variants={fadeUp}>
            <GlassCard padding="md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Flame size={14} className="text-orange-400" />
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Today&apos;s Habits</h2>
                  {habits.length > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 font-medium">
                      {completedHabits}/{habits.length}
                    </span>
                  )}
                </div>
                <Link href="/app/habits" className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors" style={{ color: 'var(--text-faint)' }}>
                  View all <ArrowRight size={10} />
                </Link>
              </div>
              {habits.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-11 h-11 rounded-2xl glass flex items-center justify-center text-lg mx-auto mb-3">🔥</div>
                  <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>No habits yet</p>
                  <button onClick={() => setQuickAdd('habit')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mx-auto transition-colors">
                    <Plus size={11} /> Build a habit
                  </button>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {habits.slice(0, 6).map((habit) => (
                    <motion.div key={habit._id} layout className="group flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                      <span className="text-base w-6 text-center shrink-0">{habit.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm block truncate">{habit.name}</span>
                        {habit.streak > 0 && (
                          <span className="text-[11px] text-orange-400/65 flex items-center gap-0.5 mt-0.5"><Flame size={9} />{habit.streak}d streak</span>
                        )}
                      </div>
                      <button
                        onClick={() => toggleHabit(habit._id)}
                        aria-label={habit.completedToday ? 'Mark incomplete' : 'Mark complete'}
                        className={cn(
                          'w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all active:scale-90',
                          habit.completedToday ? 'bg-indigo-500/20 border-indigo-500/60 text-indigo-300' : ''
                        )}
                        style={!habit.completedToday ? { borderColor: 'var(--border-strong)' } : {}}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {habit.completedToday && (
                            <motion.span key="done" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="text-[11px] font-bold">✓</motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </GlassCard>
          </motion.div>
        )

      case 'spending':
        return (
          <motion.div key="spending" variants={fadeUp}>
            <GlassCard padding="md">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Wallet size={14} className="text-emerald-400" />
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Personal Spending</h2>
                </div>
                <Link href="/app/expenses" className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors" style={{ color: 'var(--text-faint)' }}>
                  View all <ArrowRight size={10} />
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Today', value: data.spending.today },
                  { label: 'This week', value: data.spending.week },
                  { label: 'This month', value: data.spending.month },
                ].map(({ label, value }) => (
                  <div key={label} className="glass-subtle rounded-xl p-3 text-center">
                    <p className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                    <p className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(value)}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] mb-2 uppercase tracking-wider font-medium" style={{ color: 'var(--text-faint)' }}>This week</p>
                  <div className="flex items-end gap-1.5 h-12">
                    {data.spending.weeklyChart.map((val, i) => {
                      const max = Math.max(...data.spending.weeklyChart, 1)
                      const pct = (val / max) * 100
                      const isToday = i === (new Date().getDay() === 0 ? 6 : new Date().getDay() - 1)
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full rounded-t-sm flex items-end" style={{ height: 36 }}>
                            <motion.div
                              className={cn('w-full rounded-t-sm', isToday ? 'bg-gradient-to-t from-indigo-500 to-violet-400' : 'bg-black/[0.08]')}
                              initial={{ height: 0 }}
                              animate={{ height: `${Math.max(pct, val > 0 ? 8 : 0)}%` }}
                              transition={{ duration: 0.55, delay: i * 0.05, ease: 'easeOut' }}
                            />
                          </div>
                          <span className={cn('text-[9px]', isToday ? 'text-indigo-500' : '')} style={!isToday ? { color: 'var(--text-faint)' } : {}}>{DAY_LABELS[i]}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] mb-2 uppercase tracking-wider font-medium" style={{ color: 'var(--text-faint)' }}>Top category</p>
                  {data.spending.topCategory ? (
                    <div className="flex items-center gap-3 glass-subtle rounded-xl p-3">
                      <span className="text-2xl">{data.spending.topCategory.emoji}</span>
                      <div>
                        <p className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>{data.spending.topCategory.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatCurrency(data.spending.topCategory.amount)} this month</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-16 glass-subtle rounded-xl">
                      <button onClick={() => setQuickAdd('expense')} className="text-xs hover:text-indigo-500 flex items-center gap-1 transition-colors" style={{ color: 'var(--text-muted)' }}>
                        <Plus size={11} /> Add first expense
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )

      case 'spendingWarning':
        return data.spendingWarnings.length > 0 ? (
          <motion.div key="spendingWarning" variants={fadeUp}>
            <SpendingWarningSection warnings={data.spendingWarnings} />
          </motion.div>
        ) : null

      case 'groupBills':
        return data.groupBillReminders.length > 0 ? (
          <motion.div key="groupBills" variants={fadeUp}>
            <GroupBillReminders reminders={data.groupBillReminders} />
          </motion.div>
        ) : null

      case 'moneyTracker':
        return (data.moneySummary.toCollectMinor > 0 || data.moneySummary.toPayMinor > 0) ? (
          <motion.div key="moneyTracker" variants={fadeUp}>
            <GlassCard padding="md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-base">💸</span>
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Money Tracker</h2>
                </div>
                <Link href="/app/money" className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors" style={{ color: 'var(--text-faint)' }}>
                  View all <ArrowRight size={10} />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="glass-money-collect rounded-xl p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <ArrowUpRight size={11} className="text-indigo-500" />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>To Collect</p>
                  </div>
                  <p className="text-[17px] font-bold tabular-nums text-indigo-600">
                    ₹{(data.moneySummary.toCollectMinor / 100).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="glass-money-pay rounded-xl p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <ArrowDownLeft size={11} className="text-orange-500" />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>To Pay</p>
                  </div>
                  <p className="text-[17px] font-bold tabular-nums text-orange-500">
                    ₹{(data.moneySummary.toPayMinor / 100).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              {data.moneySummary.topDebtors.slice(0, 3).map((d) => (
                <div key={d.name} className="flex items-center justify-between py-1.5 px-1 text-[12px]">
                  <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                  <span className="font-semibold text-indigo-500">owes ₹{(d.owesYouMinor / 100).toLocaleString('en-IN')}</span>
                </div>
              ))}
              {data.moneySummary.topCreditors.slice(0, 3).map((c) => (
                <div key={c.name} className="flex items-center justify-between py-1.5 px-1 text-[12px]">
                  <span style={{ color: 'var(--text-secondary)' }}>{c.name}</span>
                  <span className="font-semibold text-orange-500">you owe ₹{(c.youOweMinor / 100).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </GlassCard>
          </motion.div>
        ) : null

      case 'notes':
        return (
          <motion.div key="notes" variants={fadeUp}>
            <GlassCard className="h-full" padding="md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <StickyNote size={14} className="text-yellow-400" />
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Notes</h2>
                </div>
                <Link href="/app/notes" className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors" style={{ color: 'var(--text-faint)' }}>
                  View all <ArrowRight size={10} />
                </Link>
              </div>
              {data.recentNotes.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-11 h-11 rounded-2xl glass flex items-center justify-center text-lg mx-auto mb-3">📝</div>
                  <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>No notes yet</p>
                  <button onClick={() => setQuickAdd('note')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mx-auto transition-colors">
                    <Plus size={11} /> Capture an idea
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.recentNotes.map((note) => (
                    <Link key={note._id} href="/app/notes">
                      <motion.div
                        whileHover={{ scale: 1.015 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                        className="glass-subtle rounded-xl p-3 hover:shadow-[var(--glass-hover-shadow)] transition-all duration-200 cursor-pointer h-full"
                      >
                        <p className="text-[12px] font-semibold mb-1 truncate" style={{ color: 'var(--text-primary)' }}>{note.title}</p>
                        <p className="text-[11px] line-clamp-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{note.content || 'No content'}</p>
                        <p className="text-[10px] mt-2" style={{ color: 'var(--text-faint)' }}>{formatRelativeTime(note.updatedAt)}</p>
                      </motion.div>
                    </Link>
                  ))}
                </div>
              )}
            </GlassCard>
          </motion.div>
        )

      case 'continue':
        return data.continueItems.length > 0 ? (
          <motion.div key="continue" variants={fadeUp}>
            <ContinueSection items={data.continueItems} />
          </motion.div>
        ) : null

      case 'drafts':
        return (
          <motion.div key="drafts" variants={fadeUp}>
            <DraftsContinueSection />
          </motion.div>
        )

      case 'weeklyReview':
        return (
          <motion.div key="weeklyReview" variants={fadeUp}>
            <WeeklyReview data={data.weeklyReview} />
          </motion.div>
        )

      default:
        return null
    }
  }

  /* ── Sections that should appear in 2-column grid ── */
  // tasks+habits are always paired together in a 2-col grid
  const showTasksHabitsGrid = sectionVisible['tasks'] !== false || sectionVisible['habits'] !== false

  /* ── Build ordered section list, filtering hidden ── */

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 py-5 lg:py-8 max-w-6xl mx-auto space-y-4">

        {/* ── DESKTOP HEADER ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:flex items-center justify-between"
        >
          <div>
            <h1 className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Good {getTimeGreeting()}{data.user.name ? `, ${data.user.name.split(' ')[0]}` : ''} 👋
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{getDateLabel()} · Here&apos;s your day at a glance.</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Search trigger */}
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 glass-elevated px-3.5 py-2 rounded-xl text-sm hover:shadow-[var(--glass-hover-shadow)] transition-all duration-200"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Open search (Ctrl+K)"
            >
              <Search size={14} />
              <span className="hidden xl:block" style={{ color: 'var(--text-faint)' }}>Search…</span>
              <kbd className="hidden xl:block text-[10px] px-1.5 py-0.5 rounded-lg font-mono" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-faint)' }}>⌘K</kbd>
            </button>

            {/* Customize */}
            <button
              onClick={() => setCustomizeOpen(true)}
              className="p-2.5 glass rounded-xl nav-hover transition-colors"
              aria-label="Customize dashboard"
            >
              <Settings2 size={16} style={{ color: 'var(--text-muted)' }} />
            </button>

            <Link href="/app/notifications" className="relative p-2.5 glass rounded-xl nav-hover transition-colors" aria-label="Notifications">
              <Bell size={17} style={{ color: 'var(--text-muted)' }} />
              {data.unreadNotifications > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_6px_rgba(99,102,241,0.8)]" />
              )}
            </Link>

            <Link href="/app/profile" className="p-1 glass rounded-xl nav-hover transition-colors">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[13px] font-bold text-indigo-300">
                {data.user.name?.[0]?.toUpperCase() ?? 'U'}
              </div>
            </Link>
          </div>
        </motion.div>

        {/* ── DAILY PROGRESS HERO ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative overflow-hidden rounded-2xl glass-elevated glass-catchlight p-5 sm:p-6">
            {/* Decorative blurs — aria-hidden wrapper keeps them out of
                the .glass-catchlight > * selector so their absolute
                positioning is not overridden to relative (which would
                add ~320 px of invisible height above the content). */}
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
              <div className="absolute -top-12 -right-12 w-44 h-44 bg-indigo-500/10 rounded-full blur-3xl" />
              <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-violet-500/08 rounded-full blur-3xl" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
            </div>

            <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
              {/* Progress ring */}
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                    <defs>
                      <linearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#a78bfa" />
                      </linearGradient>
                    </defs>
                    <circle cx="40" cy="40" r="33" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                    <motion.circle
                      cx="40" cy="40" r="33" fill="none"
                      stroke="url(#progressGrad)" strokeWidth="7" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 33}`}
                      initial={{ strokeDashoffset: 2 * Math.PI * 33 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 33 * (1 - progress / 100) }}
                      transition={{ duration: 1.1, ease: 'easeOut', delay: 0.25 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[17px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{progress}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Today&apos;s Progress</p>
                  {totalItems === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your day is clear ✨</p>
                  ) : (
                    <div className="space-y-0.5">
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{completedTasks}</span>
                        <span style={{ color: 'var(--text-faint)' }}> / {tasks.length} tasks</span>
                      </p>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{completedHabits}</span>
                        <span style={{ color: 'var(--text-faint)' }}> / {habits.length} habits</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Streak + progress bar */}
              <div className="flex-1 space-y-3">
                {data.today.streak > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20">
                    <Flame size={12} className="text-orange-400" />
                    <span className="text-[12px] font-semibold text-orange-300">{data.today.streak} day streak</span>
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                    <motion.div
                      className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 1.0, ease: 'easeOut', delay: 0.3 }}
                    />
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {totalItems === 0
                      ? 'Start by adding a task or habit.'
                      : `${completedTasks + completedHabits} of ${totalItems} completed`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── DAILY BRIEFING + LIFEFLOW SCORE ──────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
        >
          <div className="lg:col-span-2">
            <DailyBriefing userName={data.user.name} />
          </div>
          <div>
            <LifeFlowScore />
          </div>
        </motion.div>

        {/* ── DYNAMIC SECTIONS (ordered by user preference) ────────── */}
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">

          {/* Render sections in order, tasks+habits always in a grid */}
          {orderedSectionIds.map((id, idx) => {
            if (!sectionVisible[id]) return null

            // tasks+habits rendered as 2-col grid
            if (id === 'tasks' || id === 'habits') {
              // Only render the grid once, at the position of whichever comes first
              const tasksIdx = orderedSectionIds.indexOf('tasks')
              const habitsIdx = orderedSectionIds.indexOf('habits')
              const gridIdx = Math.min(tasksIdx, habitsIdx)
              if (idx !== gridIdx) return null
              if (!showTasksHabitsGrid) return null
              return (
                <motion.div key="tasks-habits-grid" variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-start">
                  {sectionVisible['tasks'] !== false && renderSection('tasks')}
                  {sectionVisible['habits'] !== false && renderSection('habits')}
                </motion.div>
              )
            }

            return renderSection(id)
          })}

          {/* ── UPCOMING TASKS (always shown, not customizable) ── */}
          {data.upcomingTasks.length > 0 && (
            <motion.div variants={fadeUp}>
              <GlassCard padding="md">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} className="text-sky-400" />
                    <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Upcoming</h2>
                  </div>
                  <Link href="/app/tasks" className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors" style={{ color: 'var(--text-faint)' }}>
                    View all <ArrowRight size={10} />
                  </Link>
                </div>
                <div className="space-y-1">
                  {data.upcomingTasks.map((task, i) => {
                    const label = getUpcomingLabel(task.dueDate)
                    const prevLabel = i > 0 ? getUpcomingLabel(data.upcomingTasks[i - 1].dueDate) : null
                    return (
                      <div key={task._id}>
                        {label !== prevLabel && (
                          <p className="text-[10px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1" style={{ color: 'var(--text-faint)' }}>{label}</p>
                        )}
                        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/[0.04] transition-colors">
                          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                            task.priority === 'high' && 'bg-red-400',
                            task.priority === 'medium' && 'bg-amber-400',
                            task.priority === 'low' && 'bg-emerald-400'
                          )} />
                          <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{task.title}</span>
                          {task.dueTime && (
                            <span className="text-[11px] flex items-center gap-1 shrink-0" style={{ color: 'var(--text-faint)' }}>
                              <Clock size={10} />{task.dueTime}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* ── DRAFTS: Continue Where You Left Off (always shown if drafts exist) ── */}
          <DraftsContinueSection />

          {/* ── INSIGHTS (always shown) ── */}
          {data.insights.length > 0 && (
            <motion.div variants={fadeUp}>
              <GlassCard padding="md">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={14} className="text-violet-400" />
                  <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Insights</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {data.insights.map((insight, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.07 }}
                      className="flex items-start gap-3 glass-subtle rounded-xl px-3.5 py-3"
                    >
                      <span className="text-base shrink-0">{insight.icon}</span>
                      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{insight.text}</p>
                    </motion.div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}
        </motion.div>

        {/* ── QUICK ADD (desktop) ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="hidden lg:block pb-2"
        >
          <div className="glass rounded-2xl px-5 py-4">
            <p className="text-[10px] uppercase tracking-wider mb-3 font-semibold" style={{ color: 'var(--text-faint)' }}>Quick Add</p>
            <div className="flex items-center gap-2 flex-wrap">
              {([
                { type: 'note' as QuickAddType, icon: '📝', label: 'Note' },
                { type: 'task' as QuickAddType, icon: '✅', label: 'Task' },
                { type: 'habit' as QuickAddType, icon: '🔥', label: 'Habit' },
                { type: 'expense' as QuickAddType, icon: '💰', label: 'Expense' },
                { type: 'splitbill' as QuickAddType, icon: '🍕', label: 'Split Bill' },
                { type: 'money_given' as QuickAddType, icon: '💸', label: 'Money Given' },
                { type: 'money_borrowed' as QuickAddType, icon: '🤝', label: 'Borrowed' },
              ]).map(({ type, icon, label }) => (
                <button
                  key={label}
                  onClick={() => setQuickAdd(type)}
                  className="flex items-center gap-2 px-3.5 py-2 glass rounded-xl text-[13px] hover:bg-black/[0.05] transition-all border border-transparent hover:border-black/[0.07]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span>{icon}</span><span>{label}</span>
                </button>
              ))}
              <button
                onClick={() => setCustomizeOpen(true)}
                className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] hover:bg-black/[0.05] transition-all"
                style={{ color: 'var(--text-faint)' }}
                aria-label="Customize dashboard"
              >
                <Settings2 size={12} /> Customize
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── MOBILE FAB ─────────────────────────────────────────────── */}
      <motion.button
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 22 }}
        onClick={() => setQuickAdd('task')}
        className="lg:hidden fixed bottom-[calc(var(--bottomnav-height,68px)+14px)] right-4 z-40 rounded-2xl bg-indigo-500 shadow-[0_8px_24px_rgba(99,102,241,0.4)] flex items-center justify-center border border-indigo-400/30 hover:bg-indigo-400 active:scale-95 transition-all"
        style={{ width: 52, height: 52 }}
        aria-label="Quick add"
      >
        <Plus size={22} className="text-white" />
      </motion.button>

      {/* ── QUICK ADD MODAL ─────────────────────────────────────────── */}
      <QuickAddModal
        type={quickAdd}
        onClose={() => setQuickAdd(null)}
        onTaskAdded={(task) => setTasks((p) => [...p, task])}
      />

      {/* ── GLOBAL SEARCH ───────────────────────────────────────────── */}
      <GlobalSearch
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onQuickAdd={(type) => setQuickAdd(type)}
      />

      {/* ── DASHBOARD CUSTOMIZATION ─────────────────────────────────── */}
      <DashboardCustomize
        isOpen={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        initialSections={sectionPrefs}
        onSaved={(updated) => setSectionPrefs(updated)}
      />
    </>
  )
}
