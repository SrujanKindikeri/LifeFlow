'use client'

import { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Wallet, PiggyBank, CreditCard } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { formatPaise } from '@/lib/moneyCalculator'
import { EXPENSE_CATEGORIES } from '@/lib/utils'

interface ReviewData {
  month: string
  personal: {
    totalMinor: number; avgDailyMinor: number; topCategory: string | null
    byCategory: { category: string; label: string; emoji: string; amountMinor: number; pct: number }[]
    transactionCount: number
  }
  groupBills: { totalAmount: number; count: number }
  money: {
    collectedMinor: number; paidMinor: number
    givenOutstandingMinor: number; borrowedOutstandingMinor: number
  }
  savings: { totalMinor: number; count: number }
  subscriptions: { costMinor: number }
}

const PIE_COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#f97316','#6b7280']

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string
}) {
  return (
    <GlassCard padding="sm" className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color ?? '#3b82f6'}18`, color: color ?? '#3b82f6' }}>
        {icon}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{label}</p>
        <p className="text-base font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
        {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
    </GlassCard>
  )
}

export function FinancialReviewClient() {
  const { error: showError } = useToast()
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))

  const load = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/financial-review?month=${m}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch { showError('Failed to load financial review') }
    finally { setLoading(false) }
  }, [showError, setLoading, setData])

  useEffect(() => { void load(month) }, [month, load])

  const pieData = data?.personal.byCategory
    .filter((c) => c.amountMinor > 0)
    .map((c) => ({ name: c.label, value: c.amountMinor, emoji: c.emoji })) ?? []

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1,2,3].map((i) => <div key={i} className="glass rounded-2xl h-28 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />)}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Financial Review</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Monthly money summary</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="glass-input rounded-xl text-sm px-3 py-1.5" />
        </div>
      </div>

      {/* Personal Spending */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Personal Spending</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <StatCard icon={<Wallet size={16}/>} label="Total Spent" value={formatPaise(data.personal.totalMinor)} sub={`${data.personal.transactionCount} transactions`} color="#3b82f6" />
          <StatCard icon={<TrendingDown size={16}/>} label="Daily Average" value={formatPaise(data.personal.avgDailyMinor)} color="#8b5cf6" />
          {data.personal.topCategory && (
            <StatCard
              icon={<span className="text-base">{EXPENSE_CATEGORIES.find(c=>c.value===data.personal.topCategory)?.emoji ?? '📦'}</span>}
              label="Top Category"
              value={EXPENSE_CATEGORIES.find(c=>c.value===data.personal.topCategory)?.label ?? data.personal.topCategory}
              color="#f59e0b"
            />
          )}
        </div>

        {data.personal.byCategory.length > 0 && (
          <GlassCard padding="md">
            <div className="flex flex-col sm:flex-row gap-6 items-center">
              {/* Pie chart */}
              <div className="w-full sm:w-48 h-48 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={2}>
                      {pieData.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatPaise(typeof v === 'number' ? v : 0)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Category list */}
              <div className="flex-1 w-full space-y-2">
                {data.personal.byCategory.map((c, idx) => (
                  <div key={c.category}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{c.emoji} {c.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.pct}%</span>
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatPaise(c.amountMinor)}</span>
                      </div>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {data.personal.byCategory.length === 0 && (
          <GlassCard padding="md" className="text-center py-8">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No personal expenses recorded for {month}.</p>
          </GlassCard>
        )}
      </section>

      {/* Group Bills - kept separate */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Group Bills</h2>
        <p className="text-xs mb-3 italic" style={{ color: 'var(--text-faint)' }}>
          Group bills are shown separately and are not included in personal spending above.
        </p>
      <div className="grid grid-cols-2 gap-3">
          <StatCard icon={<TrendingUp size={16}/>} label="Total Billed" value={`₹${data.groupBills.totalAmount.toLocaleString('en-IN', {maximumFractionDigits:2})}`} sub={`${data.groupBills.count} bills`} color="#0ea5e9" />
        </div>
      </section>

      {/* Money Tracker */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Money Tracker</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={<TrendingUp size={16}/>} label="Collected" value={formatPaise(data.money.collectedMinor)} color="#16a34a" />
          <StatCard icon={<TrendingDown size={16}/>} label="Paid Back" value={formatPaise(data.money.paidMinor)} color="#ef4444" />
          <StatCard icon={<TrendingUp size={16}/>} label="Outstanding Given" value={formatPaise(data.money.givenOutstandingMinor)} sub="Others owe you" color="#10b981" />
          <StatCard icon={<TrendingDown size={16}/>} label="Outstanding Borrowed" value={formatPaise(data.money.borrowedOutstandingMinor)} sub="You owe others" color="#f59e0b" />
        </div>
      </section>

      {/* Savings */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Savings</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={<PiggyBank size={16}/>} label="Saved This Month" value={formatPaise(data.savings.totalMinor)} sub={`${data.savings.count} contribution${data.savings.count !== 1 ? 's' : ''}`} color="#8b5cf6" />
        </div>
      </section>

      {/* Subscriptions */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Subscriptions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard icon={<CreditCard size={16}/>} label="Subscription Cost" value={formatPaise(data.subscriptions.costMinor)} sub="Due this month" color="#8b5cf6" />
        </div>
      </section>
    </div>
  )
}

