'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight,
  BarChart2, Plus, Users, Receipt,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { EmptyState } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { cn, formatCurrency, EXPENSE_CATEGORIES } from '@/lib/utils'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsSummary {
  totalThisMonth: number
  totalPrevMonth: number
  avgPerDay: number
  topCategory: string | null
  monthlyChange: number | null
  transactionCount: number
}
interface CategoryBreakdown { category: string; label: string; emoji: string; color: string; amount: number }
interface DayData  { day: number; amount: number }
interface WeekData { week: number; amount: number; label: string }
interface MonthData { month: string; label: string; amount: number }
interface Insight  { text: string; icon: string }

interface PersonalAnalyticsData {
  section: 'personal'
  summary: AnalyticsSummary
  categoryBreakdown: CategoryBreakdown[]
  dailyChart: DayData[]
  weeklyChart: WeekData[]
  monthlyChart: MonthData[]
  insights: Insight[]
}

interface GroupAnalyticsData {
  section: 'group'
  stats: {
    totalBills: number
    totalGroupSpend: number
    totalYourShare: number
    totalYouPaid: number
    othersOweYou: number
    youOweOthers: number
    settledAmount: number
    unsettledAmount: number
  }
}

type AnalyticsSection = 'personal' | 'group'

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function GlassTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-elevated rounded-xl px-3 py-2 text-xs shadow-xl">
      {label !== undefined && (
        <p className="mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="glass rounded-2xl p-4 h-24" />)}
      </div>
      <div className="glass rounded-2xl p-5 h-64" />
      <div className="glass rounded-2xl p-5 h-64" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="glass rounded-2xl p-5 h-56" />
        <div className="glass rounded-2xl p-5 h-56" />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnalyticsClient() {
  const now = new Date()
  const [section, setSection]   = useState<AnalyticsSection>('personal')
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [personalData, setPersonalData] = useState<PersonalAnalyticsData | null>(null)
  const [groupData,    setGroupData]    = useState<GroupAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const { error: toastError } = useToast()

  const fetchPersonal = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/analytics?year=${year}&month=${month}&section=personal`)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      setPersonalData(json)
    } catch {
      toastError('Failed to load personal analytics')
    } finally {
      setLoading(false)
    }
  }, [year, month, toastError])

  const fetchGroup = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/analytics?section=group`)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      setGroupData(json)
    } catch {
      toastError('Failed to load group analytics')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    if (section === 'personal') {
      void fetchPersonal() // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      void fetchGroup()
    }
  }, [section, fetchPersonal, fetchGroup])

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (new Date(year, month, 1) > new Date()) return
    if (month === 12) { setYear((y) => y + 1); setMonth(1) }
    else setMonth((m) => m + 1)
  }

  const monthLabel      = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const isCurrentMonth  = year === now.getFullYear() && month === now.getMonth() + 1

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Analytics</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Understand where your money goes.</p>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 p-1 glass rounded-xl w-fit">
          {([
            { key: 'personal', label: 'Personal Spending', icon: <Wallet size={13} /> },
            { key: 'group',    label: 'Group Bills',       icon: <Users  size={13} /> },
          ] as { key: AnalyticsSection; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-all',
                section === key
                  ? 'glass-segment-active text-white'
                  : 'hover:bg-black/[0.04]'
              )}
              style={section === key ? {} : { color: 'var(--text-muted)' }}
            >
              <span style={section === key ? { color: '#a5b4fc' } : { color: 'var(--text-faint)' }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Month navigator — only for personal analytics */}
      {section === 'personal' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Personal Spending Analytics
          </p>
          <div className="flex items-center gap-1 glass rounded-xl p-1">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium px-2 min-w-[110px] text-center" style={{ color: 'var(--text-primary)' }}>
              {monthLabel}
            </span>
            <button
              onClick={nextMonth}
              disabled={isCurrentMonth}
              className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {section === 'group' && (
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Group Bills Analytics — all time
        </p>
      )}

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AnalyticsSkeleton />
          </motion.div>
        ) : section === 'personal' ? (
          <motion.div
            key="personal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <PersonalAnalytics data={personalData} year={year} month={month} monthLabel={monthLabel} />
          </motion.div>
        ) : (
          <motion.div
            key="group"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <GroupAnalytics data={groupData} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Personal Analytics panel ─────────────────────────────────────────────────

function PersonalAnalytics({
  data, year, month, monthLabel,
}: {
  data: PersonalAnalyticsData | null
  year: number
  month: number
  monthLabel: string
}) {
  if (!data || data.summary.transactionCount === 0) {
    return (
      <EmptyState
        icon="📊"
        title="No personal spending data yet"
        description="Add expenses to start seeing your spending patterns."
        action={
          <Link href="/app/expenses">
            <GlassButton variant="primary" size="sm">
              <Plus size={14} /> Add Expense
            </GlassButton>
          </Link>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <SummaryCard
          label="Total This Month"
          value={formatCurrency(data.summary.totalThisMonth)}
          icon={<Wallet size={15} className="text-indigo-500" />}
        />
        <SummaryCard
          label="Average Per Day"
          value={formatCurrency(data.summary.avgPerDay)}
          icon={<BarChart2 size={15} className="text-sky-500" />}
        />
        <SummaryCard
          label="Top Category"
          value={
            data.summary.topCategory
              ? `${EXPENSE_CATEGORIES.find((c) => c.value === data.summary.topCategory)?.emoji ?? ''} ${EXPENSE_CATEGORIES.find((c) => c.value === data.summary.topCategory)?.label ?? data.summary.topCategory}`
              : '—'
          }
          icon={<span className="text-base">🏆</span>}
          isText
        />
        <SummaryCard
          label="Monthly Change"
          value={
            data.summary.monthlyChange === null
              ? 'No prior data'
              : `${data.summary.monthlyChange > 0 ? '+' : ''}${data.summary.monthlyChange}%`
          }
          icon={
            data.summary.monthlyChange !== null && data.summary.monthlyChange > 0
              ? <TrendingUp size={15} className="text-red-500" />
              : <TrendingDown size={15} className="text-emerald-500" />
          }
          accent={
            data.summary.monthlyChange === null ? undefined
              : data.summary.monthlyChange > 0 ? 'red' : 'green'
          }
        />
      </motion.div>

      {/* Daily spending chart */}
      <ChartCard title="Daily Spending" subtitle={monthLabel}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.dailyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="day"    tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
            <YAxis                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
            <Tooltip content={<GlassTooltip />} />
            <Area type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2} fill="url(#areaGrad)" dot={false} activeDot={{ r: 4, fill: '#818cf8' }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Monthly trend */}
      <ChartCard title="Monthly Trend" subtitle="Last 6 months">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.monthlyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis                 tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
            <Tooltip content={<GlassTooltip />} />
            <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
              {data.monthlyChart.map((entry, index) => {
                const isCurrent = entry.month === `${year}-${String(month).padStart(2, '0')}`
                return <Cell key={`cell-${index}`} fill={isCurrent ? '#6366f1' : 'rgba(0,0,0,0.10)'} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Category breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartCard title="Category Distribution" subtitle="This month">
          {data.categoryBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={data.categoryBreakdown} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2}>
                  {data.categoryBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    background: 'var(--glass-floating-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No data</p>
          )}
        </ChartCard>

        <ChartCard title="Breakdown" subtitle="By category">
          <div className="flex flex-col gap-2">
            {data.categoryBreakdown.map((cat) => {
              const pct = data.summary.totalThisMonth > 0 ? (cat.amount / data.summary.totalThisMonth) * 100 : 0
              return (
                <div key={cat.category} className="flex items-center gap-3">
                  <span className="text-base w-6 text-center flex-shrink-0">{cat.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{cat.label}</span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(cat.amount)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: cat.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] w-8 text-right flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{Math.round(pct)}%</span>
                </div>
              )
            })}
          </div>
        </ChartCard>
      </div>

      {/* Insights */}
      {data.insights.length > 0 && (
        <div className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>Insights</h2>
          <div className="flex flex-col gap-3">
            {data.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{insight.icon}</span>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{insight.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Group Analytics panel ────────────────────────────────────────────────────

function GroupAnalytics({ data }: { data: GroupAnalyticsData | null }) {
  if (!data || data.stats.totalBills === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No group bills yet"
        description="Split a bill with friends to see group analytics."
        action={
          <Link href="/app/expenses">
            <GlassButton variant="primary" size="sm">
              <Plus size={14} /> Split a Bill
            </GlassButton>
          </Link>
        }
      />
    )
  }

  const { stats } = data

  const statRows = [
    {
      label: 'Total Group Bills',
      value: `${stats.totalBills} bill${stats.totalBills !== 1 ? 's' : ''}`,
      icon: <Receipt size={15} className="text-indigo-500" />,
    },
    {
      label: 'Total Group Spending',
      value: formatCurrency(stats.totalGroupSpend),
      icon: <TrendingDown size={15} className="text-pink-500" />,
      note: 'Sum of all group bill totals',
    },
    {
      label: 'Your Share (approx.)',
      value: formatCurrency(stats.totalYourShare),
      icon: <Wallet size={15} className="text-sky-500" />,
      note: 'Estimated across all bills',
    },
    {
      label: 'You Paid',
      value: formatCurrency(stats.totalYouPaid),
      icon: <TrendingUp size={15} className="text-emerald-500" />,
    },
    {
      label: 'Others Owe You',
      value: formatCurrency(stats.othersOweYou),
      icon: <Users size={15} className="text-amber-500" />,
      accent: stats.othersOweYou > 0 ? 'green' as const : undefined,
    },
    {
      label: 'You Owe Others',
      value: formatCurrency(stats.youOweOthers),
      icon: <Users size={15} className="text-red-500" />,
      accent: stats.youOweOthers > 0 ? 'red' as const : undefined,
    },
    {
      label: 'Settled Amount',
      value: formatCurrency(stats.settledAmount),
      icon: <span className="text-sm">✓</span>,
    },
    {
      label: 'Unsettled Amount',
      value: formatCurrency(stats.unsettledAmount),
      icon: <span className="text-sm">⏳</span>,
      accent: stats.unsettledAmount > 0 ? 'red' as const : undefined,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Separator note */}
      <div className="glass rounded-xl px-3.5 py-3 flex items-center gap-2.5 border border-indigo-500/20">
        <span className="text-sm">ℹ️</span>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          These numbers are separate from Personal Spending. Group bill totals are{' '}
          <strong style={{ color: 'var(--text-primary)' }}>never</strong> included in your personal analytics.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {statRows.map(({ label, value, icon, note, accent }) => (
          <div key={label} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-1.5 mb-2" style={{ color: 'var(--text-muted)' }}>
              {icon}
              <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
            </div>
            <p className={cn(
              'font-bold leading-tight text-lg tabular-nums',
              accent === 'red'   && 'text-red-500',
              accent === 'green' && 'text-emerald-600',
            )}
            style={!accent ? { color: 'var(--text-primary)' } : {}}
            >
              {value}
            </p>
            {note && <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>{note}</p>}
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Settlement Summary</h2>
        <div className="flex gap-4">
          <div className="flex-1">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{
                  width: stats.settledAmount + stats.unsettledAmount > 0
                    ? `${(stats.settledAmount / (stats.settledAmount + stats.unsettledAmount)) * 100}%`
                    : '0%',
                }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[11px] text-emerald-600">
                {formatCurrency(stats.settledAmount)} settled
              </span>
              <span className="text-[11px] text-amber-600">
                {formatCurrency(stats.unsettledAmount)} pending
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
        Go to{' '}
        <Link href="/app/expenses" className="text-indigo-500 hover:text-indigo-600 underline underline-offset-2">
          Group Bills
        </Link>{' '}
        to manage settlements.
      </p>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon, accent, isText,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent?: 'red' | 'green'
  isText?: boolean
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-1.5 mb-2" style={{ color: 'var(--text-muted)' }}>
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={cn(
        'font-bold leading-tight',
        isText ? 'text-sm' : 'text-lg tabular-nums',
        accent === 'red'   && 'text-red-500',
        accent === 'green' && 'text-emerald-600',
      )}
      style={!accent ? { color: 'var(--text-primary)' } : {}}
      >
        {value}
      </p>
    </div>
  )
}

function ChartCard({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
