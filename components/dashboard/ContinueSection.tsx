'use client'

import { motion } from 'framer-motion'
import { ArrowRight, StickyNote, CheckCircle2, Flame, Receipt, Users, History } from 'lucide-react'
import Link from 'next/link'
import { GlassCard } from '@/components/ui/GlassCard'
import { formatRelativeTime } from '@/lib/utils'
import type { ContinueItem } from '@/lib/dashboard'

interface Props {
  items: ContinueItem[]
}

const TYPE_META: Record<ContinueItem['type'], { icon: React.ReactNode; color: string; label: string }> = {
  note:      { icon: <StickyNote   size={13} />, color: 'text-yellow-500',  label: 'Note'       },
  task:      { icon: <CheckCircle2 size={13} />, color: 'text-indigo-500',  label: 'Task'       },
  habit:     { icon: <Flame        size={13} />, color: 'text-orange-500',  label: 'Habit'      },
  expense:   { icon: <Receipt      size={13} />, color: 'text-emerald-500', label: 'Expense'    },
  groupBill: { icon: <Users        size={13} />, color: 'text-violet-500',  label: 'Group Bill' },
}

const ACTION_LABEL: Record<ContinueItem['action'], string> = {
  created:   'Created',
  updated:   'Last edited',
  opened:    'Recently viewed',
  completed: 'Completed',
}

export function ContinueSection({ items }: Props) {
  if (items.length === 0) {
    return (
      <GlassCard padding="md" level="regular">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-xl bg-sky-500/12 border border-sky-500/20 flex items-center justify-center">
            <History size={13} className="text-sky-500" />
          </div>
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Continue</h2>
        </div>
        <div className="py-4 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing to continue yet.</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Your recent activity will appear here.
          </p>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard padding="md" level="regular">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-xl bg-sky-500/12 border border-sky-500/20 flex items-center justify-center">
          <History size={13} className="text-sky-500" />
        </div>
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Continue</h2>
      </div>

      <div className="space-y-1">
        {items.map((item, idx) => {
          const meta = TYPE_META[item.type]
          return (
            <motion.div
              key={item._id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: idx * 0.04 }}
            >
              <Link
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] transition-colors group"
              >
                {/* Type icon */}
                <div className={`w-8 h-8 rounded-xl glass flex items-center justify-center shrink-0 ${meta.color}`}>
                  {meta.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {meta.label} · {ACTION_LABEL[item.action]} {formatRelativeTime(item.timestamp)}
                  </p>
                </div>

                {/* Arrow */}
                <ArrowRight
                  size={13}
                  className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-150"
                  style={{ color: 'var(--text-faint)' }}
                />
              </Link>
            </motion.div>
          )
        })}
      </div>
    </GlassCard>
  )
}
