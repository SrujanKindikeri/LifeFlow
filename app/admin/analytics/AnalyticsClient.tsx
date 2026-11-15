'use client'

import { useEffect, useState } from 'react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatCard } from '@/components/admin/AdminCard'
import { Users, Bell, StickyNote, CheckSquare, Flame, FolderOpen, Wallet, CreditCard } from 'lucide-react'

interface AllFeatures {
  notes: { total: number; pinned: number; archived: number }
  tasks: { total: number; completed: number; overdue: number }
  habits: { total: number; logsToday: number; completedToday: number }
  projects: { total: number; active: number; completed: number; archived: number }
  expenses: { total: number; last30Days: number; budgets: number }
  subscriptions: { total: number; active: number; paused: number; cancelled: number }
}

export function AnalyticsClient() {
  const [features, setFeatures] = useState<AllFeatures | null>(null)
  const [users, setUsers]       = useState<{ total: number; active: number; newLast30d: number } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [featRes, overviewRes] = await Promise.all([
          fetch('/api/admin/features?module=all'),
          fetch('/api/admin/overview'),
        ])
        const featJson     = await featRes.json()
        const overviewJson = await overviewRes.json()
        if (!featRes.ok) throw new Error(featJson.error?.message ?? 'Failed')
        setFeatures(featJson as AllFeatures)
        setUsers(overviewJson.users)
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
      finally { setLoading(false) }
    }
    void load()
  }, [])

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner /></div>
  if (error)   return <ErrorState message={error} />
  const f = features!

  return (
    <div className="space-y-6">
      <SectionHeader title="Platform Analytics" subtitle="Real-time aggregate counts — no user content" />

      {users && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Users</p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard label="Total Users"      value={users.total}       icon={<Users size={16} />} color="default" />
            <StatCard label="Active Users"     value={users.active}      icon={<Users size={16} />} color="success" />
            <StatCard label="New (30 days)"    value={users.newLast30d}  icon={<Users size={16} />} color="info" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <StickyNote size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Notes</p>
          </div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{f.notes.total}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Pinned</span><strong>{f.notes.pinned}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Archived</span><strong>{f.notes.archived}</strong></div>
          </div>
        </AdminCard>

        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <CheckSquare size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Tasks</p>
          </div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{f.tasks.total}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Completed</span><strong style={{ color: 'var(--success)' }}>{f.tasks.completed}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Overdue</span><strong style={{ color: f.tasks.overdue > 0 ? 'var(--danger)' : 'inherit' }}>{f.tasks.overdue}</strong></div>
          </div>
        </AdminCard>

        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <Flame size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Habits</p>
          </div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{f.habits.total}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Logs Today</span><strong>{f.habits.logsToday}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Completed Today</span><strong style={{ color: 'var(--success)' }}>{f.habits.completedToday}</strong></div>
          </div>
        </AdminCard>

        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Projects</p>
          </div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{f.projects.total}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Active</span><strong style={{ color: 'var(--success)' }}>{f.projects.active}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Completed</span><strong>{f.projects.completed}</strong></div>
          </div>
        </AdminCard>

        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <Wallet size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Expenses</p>
          </div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{f.expenses.total}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Last 30 Days</span><strong>{f.expenses.last30Days}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Budgets</span><strong>{f.expenses.budgets}</strong></div>
          </div>
        </AdminCard>

        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <CreditCard size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Subscriptions</p>
          </div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total</span><strong>{f.subscriptions.total}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Active</span><strong style={{ color: 'var(--success)' }}>{f.subscriptions.active}</strong></div>
            <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Cancelled</span><strong>{f.subscriptions.cancelled}</strong></div>
          </div>
        </AdminCard>
      </div>
    </div>
  )
}
