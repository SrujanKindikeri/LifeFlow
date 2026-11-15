'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { History, Sun, Moon, CheckCircle, XCircle, Minus } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import type { BriefingType } from '@/models/DailyBriefing'

// ─── Minimal shape returned by /api/daily-intelligence/history ────────────────
interface HistoryEntry {
  _id: string
  type: BriefingType
  forDate: string
  generatedAt: string
  hasContent: boolean
  dataSources: {
    tasks: boolean
    habits: boolean
    projects: boolean
    goals: boolean
    expenses: boolean
    subscriptions: boolean
    moneyRecords: boolean
  }
  generationMs: number
}

interface HistoryResponse {
  briefings: HistoryEntry[]
  pagination: { total: number; pages: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function fmtTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const SOURCE_LABELS: Record<string, string> = {
  tasks: 'Tasks', habits: 'Habits', projects: 'Projects',
  goals: 'Goals', expenses: 'Expenses', subscriptions: 'Subscriptions', moneyRecords: 'Money',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BriefingHistoryPanel() {
  const [entries, setEntries]   = useState<HistoryEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [filter, setFilter]     = useState<'all' | 'morning' | 'evening'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(`/api/daily-intelligence/history?type=${filter}&limit=14`)
      .then((r) => r.json())
      .then((d: HistoryResponse) => { setEntries(d.briefings); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [filter])

  return (
    <GlassCard padding="md">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History size={14} style={{ color: '#6366f1' }} />
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Briefing History
          </h3>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {(['all', 'morning', 'evening'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className="text-[10px] px-2 py-1 rounded-lg transition-colors capitalize"
              style={
                filter === t
                  ? { background: '#6366f1', color: '#fff' }
                  : { background: 'rgba(0,0,0,0.04)', color: 'var(--text-muted)' }
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl" style={{ background: 'rgba(0,0,0,0.04)' }} />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
          Could not load history.
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
          No briefings yet. Briefings appear here after they are generated.
        </p>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <motion.div
              key={e._id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button
                onClick={() => setExpanded(expanded === e._id ? null : e._id)}
                className="w-full text-left rounded-xl p-3 transition-colors hover:bg-black/[0.03]"
                style={{ border: '1px solid rgba(0,0,0,0.06)' }}
                aria-expanded={expanded === e._id}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {e.type === 'morning'
                    ? <Sun size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    : <Moon size={12} style={{ color: '#6366f1', flexShrink: 0 }} />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        {fmtDate(e.forDate)}
                      </span>
                      <span className="text-[10px] capitalize px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--text-muted)' }}>
                        {e.type}
                      </span>
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                      Generated at {fmtTime(e.generatedAt)}
                    </p>
                  </div>

                  {/* Content indicator */}
                  {e.hasContent
                    ? <CheckCircle size={12} style={{ color: '#10b981', flexShrink: 0 }} aria-label="Has content" />
                    : <Minus size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} aria-label="No content" />
                  }
                </div>
              </button>

              {/* Expanded: data sources */}
              {expanded === e._id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="rounded-xl p-3 mt-1"
                  style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.1)' }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2"
                     style={{ color: 'var(--text-faint)' }}>
                    Data sources checked
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.entries(e.dataSources) as [string, boolean][]).map(([key, ok]) => (
                      <span
                        key={key}
                        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
                        style={ok
                          ? { background: 'rgba(16,185,129,0.1)', color: '#059669' }
                          : { background: 'rgba(239,68,68,0.08)', color: '#ef4444' }
                        }
                      >
                        {ok ? <CheckCircle size={8} /> : <XCircle size={8} />}
                        {SOURCE_LABELS[key] ?? key}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: 'var(--text-faint)' }}>
                    Generated in {e.generationMs}ms
                  </p>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}
