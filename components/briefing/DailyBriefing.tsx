'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Sun, CheckSquare, Flame, Wallet, CreditCard, AlertCircle } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { formatPaise } from '@/lib/moneyCalculator'

interface BriefingData {
  today: string
  todayTasks: { _id: string; title: string; priority: string }[]
  overdueTasks: { _id: string; title: string }[]
  highPriorityTasks: { _id: string; title: string }[]
  todayHabits: { _id: string; name: string; icon: string; completedToday: boolean }[]
  habitsAtRisk: { _id: string; name: string; icon: string }[]
  yesterdaySpendMinor: number
  upcomingSubscriptions: { _id: string; serviceName: string; nextBillingDate: string }[]
  dueTodayMoney: { _id: string; person: string; direction: string }[]
  overdueMoneyRecords: { _id: string; person: string }[]
  focusItem: { type: string; _id: string; title: string; reason: string } | null
}

function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

export function DailyBriefing({ userName }: { userName: string }) {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/briefing')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <GlassCard padding="md" className="animate-pulse">
        <div className="h-5 w-40 rounded-lg mb-3" style={{ background: 'rgba(0,0,0,0.06)' }} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1,2,3,4].map((i) => <div key={i} className="h-14 rounded-xl" style={{ background: 'rgba(0,0,0,0.04)' }} />)}
        </div>
      </GlassCard>
    )
  }

  if (error || !data) {
    return (
      <GlassCard padding="sm" className="flex items-center gap-2">
        <AlertCircle size={14} style={{ color: 'var(--danger)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Could not load daily briefing.</p>
      </GlassCard>
    )
  }

  const stats = [
    { icon: <CheckSquare size={14}/>, label: 'Tasks Today', value: data.todayTasks.length, href: '/app/tasks', color: '#3b82f6', overdue: data.overdueTasks.length },
    { icon: <Flame size={14}/>, label: 'Habits', value: data.todayHabits.filter(h => h.completedToday).length + '/' + data.todayHabits.length, href: '/app/habits', color: '#f97316' },
    { icon: <Wallet size={14}/>, label: 'Spent Yesterday', value: formatPaise(data.yesterdaySpendMinor), href: '/app/expenses', color: '#ef4444' },
  ]

  return (
    <GlassCard padding="md">
      {/* Greeting */}
      <div className="flex items-center gap-2 mb-4 min-w-0">
        <Sun size={16} style={{ color: '#f59e0b', flexShrink: 0 }} aria-hidden="true" />
        <h2
          className="font-semibold leading-tight min-w-0 break-words"
          style={{
            color: 'var(--text-primary)',
            fontSize: 'clamp(13px, 3.8vw, 15px)',
          }}
        >
          {getGreeting(userName.split(' ')[0])}
        </h2>
      </div>

      {/*
        Stat pills grid.
        • grid-cols-2:   2 columns on all phones (each pill ≈ (width-padding)/2)
        • sm:grid-cols-3: 3 columns from 480px
        • md:grid-cols-3: stays 3 from tablet portrait
        On 320px: each pill is ~(288-8)/2 = 140px — comfortable.
        On 390px: each pill is ~(358-8)/2 = 175px — roomy.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="rounded-xl p-3 cursor-pointer transition-colors min-w-0"
              style={{ background: `${s.color}0d` }}
            >
              <div className="flex items-center gap-1.5 mb-1 min-w-0" style={{ color: s.color }}>
                <span className="shrink-0">{s.icon}</span>
                <span
                  className="font-semibold uppercase tracking-wide truncate"
                  style={{ fontSize: 'clamp(9px, 2.5vw, 10px)' }}
                >
                  {s.label}
                </span>
              </div>
              <p className="font-bold truncate" style={{ color: 'var(--text-primary)', fontSize: 'clamp(13px, 3.5vw, 16px)' }}>
                {s.value}
              </p>
              {s.overdue && s.overdue > 0 && (
                <p className="text-[10px] mt-0.5 truncate" style={{ color: '#ef4444' }}>{s.overdue} overdue</p>
              )}
            </motion.div>
          </Link>
        ))}
      </div>

      {/* Focus item */}
      {data.focusItem && (
        <div className="rounded-xl p-3 min-w-0" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--accent-text)' }}>Focus for today</p>
          <p className="text-sm font-semibold break-words" style={{ color: 'var(--text-primary)' }}>{data.focusItem.title}</p>
          {data.focusItem.reason === 'overdue' && (
            <p className="text-[11px] mt-0.5" style={{ color: '#ef4444' }}>Overdue</p>
          )}
        </div>
      )}

      {/* Upcoming pills */}
      {(data.upcomingSubscriptions.length > 0 || data.dueTodayMoney.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 min-w-0">
          {data.dueTodayMoney.slice(0,2).map((m) => (
            <div
              key={m._id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] max-w-full truncate"
              style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}
            >
              <Wallet size={10} aria-hidden="true" />
              <span className="truncate">
                {m.direction === 'given' ? `${m.person} owes you` : `Pay ${m.person}`} · today
              </span>
            </div>
          ))}
          {data.upcomingSubscriptions.slice(0,2).map((s) => (
            <div
              key={s._id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] max-w-full truncate"
              style={{ background: 'rgba(139,92,246,0.1)', color: '#7c3aed' }}
            >
              <CreditCard size={10} aria-hidden="true" />
              <span className="truncate">{s.serviceName} renewal</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}
