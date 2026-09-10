'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, CheckCircle2, AlertTriangle, Plus } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { TimelineItem } from '@/lib/dashboard'

interface Props {
  items: TimelineItem[]
  onAddTask?: () => void
  onItemToggled?: (id: string, completed: boolean) => void
}

function StatusDot({ status }: { status: TimelineItem['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
  }
  if (status === 'overdue') {
    return <AlertTriangle size={14} className="text-red-400 shrink-0" />
  }
  return (
    <div className="w-3.5 h-3.5 rounded-full border-2 shrink-0"
      style={{ borderColor: 'rgba(99,102,241,0.45)' }} />
  )
}

export function TodayTimeline({ items, onAddTask, onItemToggled }: Props) {
  const { success, error: toastError } = useToast()
  const [localItems, setLocalItems] = useState<TimelineItem[]>(items)
  const [loading, setLoading] = useState<string | null>(null)

  async function toggleItem(item: TimelineItem) {
    if (loading) return
    const newCompleted = !item.completed
    setLoading(item._id)
    setLocalItems((prev) =>
      prev.map((i) => {
        if (i._id !== item._id) return i
        const newStatus = newCompleted ? 'completed' : (i.dueTime < new Date().toTimeString().slice(0, 5) ? 'overdue' : 'upcoming')
        return { ...i, completed: newCompleted, status: newStatus }
      })
    )
    try {
      const res = await fetch(`/api/tasks/${item._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: newCompleted }),
      })
      if (!res.ok) throw new Error()
      if (newCompleted) success('Task completed ✓')
      onItemToggled?.(item._id, newCompleted)
    } catch {
      setLocalItems((prev) =>
        prev.map((i) => i._id === item._id ? { ...i, completed: item.completed, status: item.status } : i)
      )
      toastError('Failed to update task')
    } finally {
      setLoading(null)
    }
  }

  return (
    <GlassCard padding="md" level="regular">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-sky-500/12 border border-sky-500/20 flex items-center justify-center">
            <Clock size={13} className="text-sky-500" />
          </div>
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Today
          </h2>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* Empty state */}
      {localItems.length === 0 && (
        <div className="py-6 text-center">
          <div className="w-10 h-10 rounded-2xl glass flex items-center justify-center text-lg mx-auto mb-2">📅</div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No scheduled items today.</p>
          <p className="text-[11px] mt-0.5 mb-3" style={{ color: 'var(--text-faint)' }}>
            Tasks with a set time will appear here.
          </p>
          {onAddTask && (
            <button
              onClick={onAddTask}
              className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1 mx-auto transition-colors"
            >
              <Plus size={11} /> Add Task
            </button>
          )}
        </div>
      )}

      {/* Timeline */}
      {localItems.length > 0 && (
        <div className="relative">
          {/* Vertical line */}
          <div
            className="absolute left-[17px] top-3 bottom-3 w-px"
            style={{ background: 'rgba(0,0,0,0.06)' }}
          />

          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {localItems.map((item, idx) => {
                const isLoading = loading === item._id
                const isOverdue = item.status === 'overdue'
                const isDone = item.status === 'completed'

                return (
                  <motion.div
                    key={item._id}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.22, delay: idx * 0.04 }}
                    className={cn(
                      'flex items-center gap-3 pl-1 pr-2 py-2 rounded-xl transition-colors group cursor-pointer',
                      'hover:bg-white/[0.04]',
                      isDone && 'opacity-50'
                    )}
                    onClick={() => toggleItem(item)}
                    role="button"
                    aria-label={`${isDone ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && toggleItem(item)}
                  >
                    {/* Dot / icon */}
                    <div className="flex-shrink-0 relative z-10 w-8 flex justify-center">
                      {isLoading
                        ? <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                        : <StatusDot status={item.status} />
                      }
                    </div>

                    {/* Time */}
                    <span
                      className={cn(
                        'text-[11px] font-mono tabular-nums w-10 shrink-0',
                        isOverdue ? 'text-red-400' : '',
                        isDone    ? '' : ''
                      )}
                      style={!isOverdue && !isDone ? { color: 'var(--text-muted)' } : {}}
                    >
                      {item.dueTime}
                    </span>

                    {/* Title */}
                    <span
                      className={cn('text-sm flex-1 truncate', isDone && 'line-through')}
                      style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-primary)' }}
                    >
                      {item.title}
                    </span>

                    {/* Status badge */}
                    {isOverdue && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium shrink-0">
                        Overdue
                      </span>
                    )}
                    {isDone && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium shrink-0">
                        Done
                      </span>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </GlassCard>
  )
}
