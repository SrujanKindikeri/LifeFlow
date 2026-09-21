'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { formatCurrency } from '@/lib/utils'
import type { WeeklyReviewData } from '@/lib/dashboard'

interface Props {
  data: WeeklyReviewData
  currency?: string
}

function StatPill({
  label, value, sub,
}: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-subtle rounded-xl p-2 sm:p-3 text-center">
      <p className="text-[9px] sm:text-[10px] font-medium uppercase tracking-wide mb-1 truncate" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p className="text-[13px] sm:text-[15px] font-bold tabular-nums leading-tight" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
      {sub && (
        <p className="text-[9px] sm:text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{sub}</p>
      )}
    </div>
  )
}

export function WeeklyReview({ data, currency = 'INR' }: Props) {
  const [expanded, setExpanded] = useState(false)

  const hasAnyData =
    data.tasks.total > 0 ||
    data.habits.total > 0 ||
    data.spending > 0 ||
    data.notesCreated > 0 ||
    data.groupBillsCount > 0

  const positive = data.highlights.filter((h) => h.type === 'positive')
  const negative = data.highlights.filter((h) => h.type === 'negative')

  return (
    <GlassCard padding="md" level="regular">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between gap-2 mb-0"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle weekly review"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-violet-500/12 border border-violet-500/20 flex items-center justify-center">
            <BarChart2 size={13} className="text-violet-500" />
          </div>
          <div className="text-left">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Weekly Review
            </h2>
            <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{data.weekLabel}</p>
          </div>
        </div>
        <div style={{ color: 'var(--text-faint)' }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Collapsible body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="mt-4 space-y-4">
              {!hasAnyData ? (
                <div className="py-4 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Start using LifeFlow to generate your first weekly review.
                  </p>
                </div>
              ) : (
                <>
                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    <StatPill
                      label="Tasks"
                      value={`${data.tasks.completed} / ${data.tasks.total}`}
                      sub="completed"
                    />
                    <StatPill
                      label="Habits"
                      value={`${data.habits.consistency}%`}
                      sub="consistency"
                    />
                    <StatPill
                      label="Spending"
                      value={formatCurrency(data.spending, currency)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    <StatPill
                      label="Notes"
                      value={String(data.notesCreated)}
                      sub="created"
                    />
                    <StatPill
                      label="Group Bills"
                      value={String(data.groupBillsCount)}
                    />
                    <StatPill
                      label="Best Streak"
                      value={`${data.bestStreak}d`}
                    />
                  </div>

                  {/* Highlights */}
                  {data.highlights.length > 0 && (
                    <div className="space-y-2">
                      {positive.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"
                            style={{ color: 'var(--text-faint)' }}>
                            <TrendingUp size={10} className="text-emerald-500" /> What went well
                          </p>
                          <div className="space-y-1">
                            {positive.map((h, i) => (
                              <div key={i} className="flex items-start gap-2 py-1 px-2 rounded-lg bg-emerald-500/[0.05]">
                                <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                  {h.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {negative.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"
                            style={{ color: 'var(--text-faint)' }}>
                            <TrendingDown size={10} className="text-amber-500" /> Needs attention
                          </p>
                          <div className="space-y-1">
                            {negative.map((h, i) => (
                              <div key={i} className="flex items-start gap-2 py-1 px-2 rounded-lg bg-amber-500/[0.05]">
                                <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                  {h.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {data.highlights.length === 0 && (
                    <p className="text-[12px] text-center py-2" style={{ color: 'var(--text-faint)' }}>
                      Keep using LifeFlow to unlock personalised insights.
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed preview — show one stat inline */}
      {!expanded && hasAnyData && (
        <div className="flex items-center gap-4 mt-3">
          {data.tasks.total > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {data.tasks.completed}/{data.tasks.total}
              </span>{' '}
              tasks
            </p>
          )}
          {data.habits.total > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {data.habits.consistency}%
              </span>{' '}
              habits
            </p>
          )}
          {data.spending > 0 && (
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatCurrency(data.spending, currency)}
              </span>{' '}
              spent
            </p>
          )}
          <p className="text-[11px] ml-auto" style={{ color: 'var(--text-faint)' }}>Tap to expand</p>
        </div>
      )}

      {!expanded && !hasAnyData && (
        <p className="text-[12px] mt-3" style={{ color: 'var(--text-faint)' }}>
          Start using LifeFlow to see your weekly summary.
        </p>
      )}
    </GlassCard>
  )
}
