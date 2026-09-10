'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
// Icons used in TYPE_CONFIG lookup — imported for JSX
import {
  CheckCircle2, StickyNote, Flame, Wallet, Users, TrendingUp, Target,
  FolderOpen, PiggyBank, FileText, CreditCard, Activity,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { formatRelativeTime } from '@/lib/utils'

interface ActivityItem {
  _id: string; type: string; referenceId?: string; title: string
  metadata?: Record<string, unknown>; createdAt: string
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  task_created:       { icon: <CheckCircle2 size={14}/>,  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  task_completed:     { icon: <CheckCircle2 size={14}/>,  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'   },
  task_deleted:       { icon: <CheckCircle2 size={14}/>,  color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
  note_created:       { icon: <StickyNote   size={14}/>,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)'  },
  note_updated:       { icon: <StickyNote   size={14}/>,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)'  },
  habit_completed:    { icon: <Flame        size={14}/>,  color: '#f97316', bg: 'rgba(249,115,22,0.1)'  },
  expense_added:      { icon: <Wallet       size={14}/>,  color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
  group_bill_created: { icon: <Users        size={14}/>,  color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)'  },
  group_bill_settled: { icon: <Users        size={14}/>,  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'   },
  money_given:        { icon: <TrendingUp   size={14}/>,  color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  money_borrowed:     { icon: <TrendingUp   size={14}/>,  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  payment_received:   { icon: <TrendingUp   size={14}/>,  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'   },
  payment_made:       { icon: <TrendingUp   size={14}/>,  color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
  goal_created:       { icon: <Target       size={14}/>,  color: '#6366f1', bg: 'rgba(99,102,241,0.1)'  },
  goal_completed:     { icon: <Target       size={14}/>,  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'   },
  goal_updated:       { icon: <Target       size={14}/>,  color: '#6366f1', bg: 'rgba(99,102,241,0.1)'  },
  project_created:    { icon: <FolderOpen   size={14}/>,  color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)'  },
  project_completed:  { icon: <FolderOpen   size={14}/>,  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'   },
  savings_contributed:{ icon: <PiggyBank    size={14}/>,  color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  bill_created:       { icon: <FileText     size={14}/>,  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  bill_paid:          { icon: <FileText     size={14}/>,  color: '#16a34a', bg: 'rgba(22,163,74,0.1)'   },
  subscription_added: { icon: <CreditCard   size={14}/>,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)'  },
}

const DEFAULT_CFG = { icon: <Activity size={14}/>, color: '#6b7280', bg: 'rgba(107,114,128,0.1)' }

function groupByDate(items: ActivityItem[]) {
  const groups: Record<string, ActivityItem[]> = {}
  for (const a of items) {
    const date = new Date(a.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    if (!groups[date]) groups[date] = []
    groups[date].push(a)
  }
  return Object.entries(groups)
}

export function ActivityTimelineClient() {
  const { error: showError } = useToast()
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (p = 1) => {
    if (p === 1) setLoading(true); else setLoadingMore(true)
    try {
      const res = await fetch(`/api/activity?page=${p}&limit=30`)
      const data = await res.json()
      if (p === 1) setActivities(data.activities ?? [])
      else setActivities((prev) => [...prev, ...(data.activities ?? [])])
      setHasMore(data.hasMore ?? false)
      setPage(p)
    } catch { showError('Failed to load activity') }
    finally { setLoading(false); setLoadingMore(false) }
  }, [showError])

  useEffect(() => { void load(1) }, [load])

  const groups = groupByDate(activities)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Activity</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Your LifeFlow timeline</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">{[1,2,3,4,5].map((i)=>(
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 rounded-full animate-pulse flex-shrink-0" style={{ background: 'rgba(0,0,0,0.08)' }}/>
            <div className="flex-1 h-8 rounded-xl animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }}/>
          </div>
        ))}</div>
      ) : activities.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <Activity size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No activity yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your actions across LifeFlow will appear here.</p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([date, items]) => (
            <div key={date}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)' }}>{date}</p>
              <div className="flex flex-col gap-2">
                {items.map((a, i) => {
                  const cfg = TYPE_CONFIG[a.type] ?? DEFAULT_CFG
                  return (
                    <motion.div key={a._id} initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ delay: i*0.03 }}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg, color: cfg.color }}>
                          {cfg.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                          {formatRelativeTime(a.createdAt)}
                        </span>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center">
              <GlassButton variant="secondary" size="sm" loading={loadingMore} onClick={() => load(page + 1)}>
                Load more
              </GlassButton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
