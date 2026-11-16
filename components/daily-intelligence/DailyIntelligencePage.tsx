'use client'

/**
 * DailyIntelligencePage — full detailed view.
 *
 * Fetches morning + evening briefings in parallel and renders:
 * - Hero stat bar (tasks / habits / conflicts / financial alerts)
 * - Tab switcher: Morning | Evening
 * - Top priorities list
 * - Today's tasks + overdue tasks
 * - Habits at risk
 * - Project / goal deadlines
 * - Schedule conflict indicators
 * - Financial alerts
 * - Tomorrow's priorities panel
 * - Briefing history panel
 * - Manual refresh + last-generated timestamp
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, RefreshCw, Sun, Moon, CheckSquare, Flame,
  AlertTriangle, TrendingUp, Clock, ArrowRight,
  FolderOpen, Target, WifiOff, Loader2,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassSurface } from '@/components/ui/GlassSurface'
import { cn } from '@/lib/utils'
import { ConflictIndicators } from './ConflictIndicators'
import { TomorrowPrioritiesPanel } from './TomorrowPrioritiesPanel'
import { BriefingHistoryPanel } from './BriefingHistoryPanel'
import type { IDailyBriefing, BriefingType } from '@/models/DailyBriefing'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiResp { briefing: IDailyBriefing; cached: boolean }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtGenerated(d: Date | string) {
  const dt = new Date(d)
  return dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function priorityColor(p: string) {
  if (p === 'high')   return { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444' }
  if (p === 'medium') return { bg: 'rgba(245,158,11,0.1)',  color: '#d97706' }
  return                    { bg: 'rgba(100,116,139,0.08)', color: '#64748b' }
}

const fade = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.28 } } }

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { userName: string }

export function DailyIntelligencePage({ userName }: Props) {
  const [morning, setMorning]   = useState<IDailyBriefing | null>(null)
  const [evening, setEvening]   = useState<IDailyBriefing | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [tab, setTab]           = useState<BriefingType>('morning')
  const [refreshing, setRefreshing] = useState(false)
  const [retryAfter, setRetryAfter] = useState(0)

  const fetchBriefing = useCallback(async (type: BriefingType, force = false): Promise<IDailyBriefing | null> => {
    const r = await fetch(
      force ? '/api/daily-intelligence' : `/api/daily-intelligence?type=${type}`,
      force
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }
        : {}
    )
    if (r.status === 429) {
      const body = await r.json().catch(() => ({})) as { retryAfterSeconds?: number }
      setRetryAfter(body.retryAfterSeconds ?? 300)
      return null
    }
    if (!r.ok) return null
    const d = await r.json() as ApiResp
    return d.briefing
  }, [])

  const loadAll = useCallback(async (force = false) => {
    if (force) setRefreshing(true)
    else setLoading(true)
    setError(false)
    try {
      const [m, e] = await Promise.all([
        fetchBriefing('morning', force),
        fetchBriefing('evening', force),
      ])
      if (!force || m) setMorning(m)
      if (!force || e) setEvening(e)
      if (!m && !e && !force) setError(true)
    } catch {
      setError(!navigator.onLine)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [fetchBriefing])

  useEffect(() => { void loadAll(false) }, [loadAll])

  const briefing = tab === 'morning' ? morning : evening
  const content  = briefing?.content

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 size={24} className="animate-spin" style={{ color: '#6366f1' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading your briefing…</p>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WifiOff size={32} style={{ color: 'var(--text-faint)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Could not load briefing. Check your connection.</p>
        <button
          onClick={() => loadAll(false)}
          className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    )
  }

  const overdueCount  = content?.overdueTasks.length ?? 0
  const conflictCount = content?.conflicts.length ?? 0
  const finAlertCount = content?.financialAlerts.length ?? 0
  const habitAtRisk   = (content?.habitsAtRisk ?? []).filter((h) => !h.completedToday).length

  return (
    <div className="w-full min-w-0 max-w-3xl mx-auto px-4 sm:px-5 py-5 space-y-4">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Brain size={18} style={{ color: '#6366f1' }} />
            <h1 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              Daily Intelligence
            </h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {userName.split(' ')[0]}
          </p>
          {briefing?.generatedAt && (
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              Last updated {fmtGenerated(briefing.generatedAt)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {retryAfter > 0 ? (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>retry in {retryAfter}s</span>
          ) : (
            <button
              onClick={() => loadAll(true)}
              disabled={refreshing}
              aria-label="Refresh briefing"
              className="p-2 rounded-xl glass hover:shadow-[var(--glass-hover-shadow)] transition-all disabled:opacity-40"
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* ── Stat pills ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[
          { icon: <CheckSquare size={11} />, label: `${content?.todayTasks.length ?? 0} tasks`, color: '#3b82f6', href: '/app/tasks' },
          { icon: <Flame size={11} />,        label: `${habitAtRisk} at risk`,     color: '#f97316', href: '/app/habits' },
          overdueCount  > 0 ? { icon: <AlertTriangle size={11} />, label: `${overdueCount} overdue`,   color: '#ef4444', href: '/app/tasks' } : null,
          conflictCount > 0 ? { icon: <Clock size={11} />,         label: `${conflictCount} conflict${conflictCount > 1 ? 's' : ''}`, color: '#d97706', href: '#conflicts' } : null,
          finAlertCount > 0 ? { icon: <TrendingUp size={11} />,    label: `${finAlertCount} financial`, color: '#059669', href: '#financial' } : null,
        ].filter(Boolean).map((pill, i) => (
          <Link key={i} href={pill!.href}>
            <span
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: `${pill!.color}18`, color: pill!.color }}
            >
              {pill!.icon}{pill!.label}
            </span>
          </Link>
        ))}
      </div>

      {/* ── Morning / Evening tab ─────────────────────────────────────────── */}
      <GlassSurface variant="subtle" padding="xs" radius="lg" className="flex gap-1">
        {(['morning', 'evening'] as BriefingType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl transition-all text-[12px] font-medium capitalize"
            style={
              tab === t
                ? { background: '#6366f1', color: '#fff' }
                : { color: 'var(--text-muted)' }
            }
          >
            {t === 'morning' ? <Sun size={12} /> : <Moon size={12} />}
            {t}
          </button>
        ))}
      </GlassSurface>

      <AnimatePresence mode="wait">
        <motion.div key={tab} variants={fade} initial="hidden" animate="show" exit="hidden">
          {!briefing || !content ? (
            <GlassCard padding="md">
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
                No {tab} briefing for today yet.
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-4">

              {/* Top priorities */}
              {content.topPriorities.length > 0 && (
                <GlassCard padding="md">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                    🎯 Top priorities
                  </p>
                  <div className="space-y-2">
                    {content.topPriorities.map((t, i) => {
                      const pc = priorityColor(t.priority)
                      return (
                        <div key={t._id} className="flex items-center gap-3 min-w-0">
                          <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                                style={{ background: '#6366f1', color: '#fff' }}>{i + 1}</span>
                          <Link href={`/app/tasks?highlight=${t._id}`} className="flex-1 min-w-0 hover:underline">
                            <p className="text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                            {t.dueTime && <p className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-faint)' }}><Clock size={9} />{t.dueTime}</p>}
                          </Link>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                                style={{ background: pc.bg, color: pc.color }}>{t.priority}</span>
                        </div>
                      )
                    })}
                  </div>
                </GlassCard>
              )}

              {/* Overdue tasks */}
              {content.overdueTasks.length > 0 && (
                <GlassCard padding="md">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: '#ef4444' }}>
                    🔴 Overdue ({content.overdueTasks.length})
                  </p>
                  <div className="space-y-2">
                    {content.overdueTasks.slice(0, 6).map((t) => (
                      <Link key={t._id} href={`/app/tasks?highlight=${t._id}`}
                            className="flex items-center gap-2 group hover:underline min-w-0">
                        <AlertTriangle size={11} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <span className="text-[12px] truncate flex-1" style={{ color: 'var(--text-primary)' }}>{t.title}</span>
                        <span className="text-[10px] shrink-0" style={{ color: '#ef4444' }}>
                          {t.daysOverdue === 0 ? 'today' : `${t.daysOverdue}d`}
                        </span>
                      </Link>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* Today's tasks */}
              {content.todayTasks.length > 0 && (
                <GlassCard padding="md">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                      ✅ Tasks Today ({content.todayTasks.length})
                    </p>
                    <Link href="/app/tasks" className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                      All <ArrowRight size={9} />
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    {content.todayTasks.slice(0, 8).map((t) => {
                      const pc = priorityColor(t.priority)
                      return (
                        <Link key={t._id} href={`/app/tasks?highlight=${t._id}`}
                              className="flex items-center gap-2 hover:underline min-w-0">
                          <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{t.title}</span>
                          {t.dueTime && <span className="text-[10px] shrink-0 flex items-center gap-0.5" style={{ color: 'var(--text-faint)' }}><Clock size={9} />{t.dueTime}</span>}
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: pc.bg, color: pc.color }}>{t.priority}</span>
                        </Link>
                      )
                    })}
                  </div>
                </GlassCard>
              )}

              {/* Habits */}
              {content.habitsAtRisk.length > 0 && (
                <GlassCard padding="md">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                    🔥 Habits at Risk
                  </p>
                  <div className="space-y-1.5">
                    {content.habitsAtRisk.filter((h) => !h.completedToday).slice(0, 6).map((h) => (
                      <Link key={h._id} href="/app/habits"
                            className="flex items-center gap-2 hover:underline min-w-0">
                        <span className="text-base shrink-0">{h.icon}</span>
                        <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{h.name}</span>
                        {h.isOverdueWindow && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                            running late
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* Projects & Goals */}
              {(content.upcomingProjects.length > 0 || content.upcomingGoals.length > 0) && (
                <GlassCard padding="md">
                  {content.upcomingProjects.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
                        📁 Project Deadlines
                      </p>
                      <div className="space-y-1.5 mb-4">
                        {content.upcomingProjects.map((p) => (
                          <Link key={p._id} href="/app/projects" className="flex items-center gap-2 hover:underline min-w-0">
                            <FolderOpen size={11} style={{ color: '#6366f1', flexShrink: 0 }} />
                            <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{p.title}</span>
                            {p.dueDate && <span className="text-[10px] shrink-0" style={{ color: 'var(--text-faint)' }}>{p.dueDate}</span>}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                  {content.upcomingGoals.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
                        🎯 Goal Deadlines
                      </p>
                      <div className="space-y-1.5">
                        {content.upcomingGoals.map((g) => (
                          <Link key={g._id} href="/app/goals" className="flex items-center gap-2 hover:underline min-w-0">
                            <Target size={11} style={{ color: '#10b981', flexShrink: 0 }} />
                            <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{g.title}</span>
                            <span className="text-[10px] shrink-0" style={{ color: 'var(--text-faint)' }}>{g.progress}%</span>
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </GlassCard>
              )}

              {/* Schedule conflicts */}
              {content.conflicts.length > 0 && (
                <div id="conflicts">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-faint)' }}>
                    ⚠️ Schedule Conflicts
                  </p>
                  <ConflictIndicators conflicts={content.conflicts} />
                </div>
              )}

              {/* Financial alerts */}
              {content.financialAlerts.length > 0 && (
                <GlassCard padding="md" id="financial">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                    💰 Financial Alerts
                  </p>
                  <div className="space-y-2">
                    {content.financialAlerts.map((a) => (
                      <Link key={a.sourceId} href={a.href} className="flex items-start gap-2 hover:underline min-w-0">
                        <TrendingUp size={11} style={{ color: '#059669', flexShrink: 0, marginTop: 2 }} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{a.description}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* Suggested plan */}
              {content.suggestedPlan.length > 0 && (
                <GlassCard padding="md">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>
                    💡 Suggested Plan
                  </p>
                  <ol className="space-y-2 pl-1">
                    {content.suggestedPlan.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                        <span className="shrink-0 text-[10px] font-bold mt-0.5 w-4 h-4 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </GlassCard>
              )}

            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Tomorrow priorities + history */}
      {morning?.content?.tomorrowPriorities && morning.content.tomorrowPriorities.length > 0 && (
        <TomorrowPrioritiesPanel priorities={morning.content.tomorrowPriorities} />
      )}

      <BriefingHistoryPanel />
    </div>
  )
}
