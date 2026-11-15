'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Calendar, Clock, AlertCircle } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import type { TomorrowPriority } from '@/lib/dailyIntelligence/tomorrowPriorities'

interface Props {
  priorities: TomorrowPriority[]
}

const SOURCE_EMOJI: Record<string, string> = {
  overdue_task:      '🔴',
  task_due_tomorrow: '📋',
  high_priority_task:'⚡',
  project_deadline:  '📁',
  goal_deadline:     '🎯',
  habit_maintenance: '🔥',
}

export function TomorrowPrioritiesPanel({ priorities }: Props) {
  if (priorities.length === 0) {
    return (
      <GlassCard padding="md">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={14} style={{ color: '#6366f1' }} />
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Tomorrow&apos;s Plan
          </h3>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No specific priorities for tomorrow yet.
        </p>
      </GlassCard>
    )
  }

  return (
    <GlassCard padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Calendar size={14} style={{ color: '#6366f1' }} />
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Tomorrow&apos;s Plan
        </h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
          {priorities.length} priorities
        </span>
      </div>

      <div className="space-y-3">
        {priorities.map((p, i) => (
          <motion.div
            key={p.sourceId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="rounded-xl p-3 min-w-0"
            style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.1)' }}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {/* Rank bubble */}
              <span
                className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: '#6366f1', color: '#fff' }}
              >
                {p.rank}
              </span>

              <div className="min-w-0 flex-1">
                {/* Title row */}
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="text-sm shrink-0">{SOURCE_EMOJI[p.source] ?? '•'}</span>
                  <Link
                    href={p.href}
                    className="text-[13px] font-semibold truncate hover:underline"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {p.title}
                  </Link>
                  {p.confidence === 'tentative' && (
                    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                          style={{ background: 'rgba(100,116,139,0.1)', color: '#64748b' }}>
                      <AlertCircle size={8} />tentative
                    </span>
                  )}
                </div>

                {/* Reason */}
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {p.reason}
                </p>

                {/* Meta */}
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {p.deadline && (
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      <Clock size={9} />Due {p.deadline}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  )
}
