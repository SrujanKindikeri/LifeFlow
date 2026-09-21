'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, Circle, Wallet, Target, CreditCard, AlertCircle } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import { formatPaise } from '@/lib/moneyCalculator'

interface WeekData {
  previousWeek: {
    label: string; tasksCompleted: number; tasksUnfinished: number; totalTasks: number
    habitConsistency: number; spendMinor: number; spend: number; savedMinor: number; saved: number; paymentsCount: number
  }
  currentWeek: {
    label: string; start: string; end: string
    tasks: { _id: string; title: string; priority: string; dueDate?: string }[]
    habits: { _id: string; name: string; icon: string; completedToday: boolean }[]
    moneyDue: { _id: string; person: string; direction: string; dueDate?: string }[]
    goals: { _id: string; title: string; targetDate?: string; currentValue: number; targetValue: number }[]
    subscriptions: { _id: string; serviceName: string; nextBillingDate: string; amountMinor: number }[]
  }
}

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h2>
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${color}18`, color }}>
      {children}
    </span>
  )
}

export function WeeklyPlanningClient() {
  const { error: showError } = useToast()
  const [data, setData] = useState<WeekData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/weekly-planning')
      .then((r) => r.json())
      .then(setData)
      .catch(() => showError('Failed to load weekly plan'))
      .finally(() => setLoading(false))
  }, [showError])

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1,2,3].map((i) => <div key={i} className="glass rounded-2xl h-32 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />)}
      </div>
    )
  }
  if (!data) return null

  const { previousWeek: prev, currentWeek: curr } = data
  const taskRate = prev.totalTasks > 0 ? Math.round((prev.tasksCompleted / prev.totalTasks) * 100) : 100

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Weekly Planning</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{curr.label}</p>
      </div>

      {/* Previous week recap */}
      <GlassCard padding="md">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-5 rounded-full" style={{ background: 'var(--text-faint)' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>Last Week — {prev.label}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Tasks Done', value: `${prev.tasksCompleted}/${prev.totalTasks}`, sub: `${taskRate}% rate`, color: taskRate >= 70 ? '#16a34a' : '#f59e0b' },
            { label: 'Habits', value: `${prev.habitConsistency}%`, sub: 'consistency', color: prev.habitConsistency >= 70 ? '#16a34a' : '#f59e0b' },
            { label: 'Spent', value: formatPaise(prev.spendMinor), sub: 'personal', color: '#ef4444' },
            { label: 'Saved', value: formatPaise(prev.savedMinor), sub: `${prev.paymentsCount} payments`, color: '#8b5cf6' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: `${s.color}0d` }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: s.color }}>{s.label}</p>
              <p className="text-base font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.sub}</p>
            </div>
          ))}
        </div>
        {prev.tasksUnfinished > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: '#b45309' }}>
            <AlertCircle size={13} />
            {prev.tasksUnfinished} task{prev.tasksUnfinished !== 1 ? 's' : ''} left unfinished last week.
          </div>
        )}
      </GlassCard>

      {/* Current week */}
      <GlassCard padding="md">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-5 rounded-full" style={{ background: 'var(--accent)' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>This Week — {curr.label}</h2>
        </div>

        <div className="flex flex-col gap-5">
          {/* Tasks */}
          {curr.tasks.length > 0 && (
            <div>
              <SectionHeader title={`Tasks (${curr.tasks.length})`} />
              <div className="flex flex-col gap-1.5">
                {curr.tasks.map((t) => (
                  <div key={t._id} className="flex items-center gap-2.5">
                    <Circle size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                    <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>{t.title}</span>
                    {t.priority === 'high' && <Badge color="#ef4444">High</Badge>}
                    {t.dueDate && <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{formatDate(t.dueDate)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Habits */}
          {curr.habits.length > 0 && (
            <div>
              <SectionHeader title="Habits" />
              <div className="flex flex-wrap gap-2">
                {curr.habits.map((h) => (
                  <div key={h._id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm"
                    style={{ background: h.completedToday ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.04)', color: h.completedToday ? '#16a34a' : 'var(--text-secondary)' }}>
                    {h.completedToday ? <CheckCircle2 size={12}/> : <Circle size={12}/>}
                    <span>{h.icon} {h.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Money due */}
          {curr.moneyDue.length > 0 && (
            <div>
              <SectionHeader title="Money Due" />
              <div className="flex flex-col gap-1.5">
                {curr.moneyDue.map((m) => (
                  <div key={m._id} className="flex items-center gap-2.5">
                    <Wallet size={13} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {m.direction === 'given' ? `${m.person} owes you` : `You owe ${m.person}`}
                    </span>
                    {m.dueDate && <span className="text-xs ml-auto" style={{ color: 'var(--text-faint)' }}>{formatDate(m.dueDate)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Goals with deadlines */}
          {curr.goals.length > 0 && (
            <div>
              <SectionHeader title="Goal Deadlines" />
              <div className="flex flex-col gap-1.5">
                {curr.goals.map((g) => {
                  const pct = g.targetValue > 0 ? Math.min(100, Math.round((g.currentValue / g.targetValue) * 100)) : 0
                  return (
                    <div key={g._id} className="flex items-center gap-2.5">
                      <Target size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                      <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{g.title}</span>
                      <span className="text-xs font-semibold" style={{ color: pct >= 100 ? '#16a34a' : 'var(--accent-text)' }}>{pct}%</span>
                      {g.targetDate && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{formatDate(g.targetDate)}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Subscriptions */}
          {curr.subscriptions.length > 0 && (
            <div>
              <SectionHeader title="Subscription Renewals" />
              <div className="flex flex-col gap-1.5">
                {curr.subscriptions.map((s) => (
                  <div key={s._id} className="flex items-center gap-2.5">
                    <CreditCard size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                    <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{s.serviceName}</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{formatPaise(s.amountMinor)}</span>
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{formatDate(s.nextBillingDate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {curr.tasks.length === 0 && curr.moneyDue.length === 0 && curr.goals.length === 0 && curr.subscriptions.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Nothing scheduled this week. Enjoy the free time!</p>
          )}
        </div>
      </GlassCard>
    </div>
  )
}
