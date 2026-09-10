'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, CheckCircle2, Circle, Flame, Check } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { FocusItem } from '@/lib/dashboard'

interface Props {
  items: FocusItem[]
  onItemCompleted?: (id: string, type: 'task' | 'habit') => void
}

const REASON_LABEL: Record<FocusItem['reason'], { text: string; color: string }> = {
  overdue:            { text: 'Overdue',        color: 'text-red-500'    },
  high_priority_today:{ text: 'High priority',  color: 'text-orange-500' },
  due_today:          { text: 'Due today',       color: 'text-indigo-500' },
  incomplete_habit:   { text: 'Habit',           color: 'text-violet-500' },
  streak_risk:        { text: 'Streak at risk',  color: 'text-orange-500' },
}

export function FocusForToday({ items, onItemCompleted }: Props) {
  const { success, error: toastError } = useToast()
  const [localItems, setLocalItems] = useState<FocusItem[]>(items)
  const [loading, setLoading] = useState<string | null>(null)

  const allDone = localItems.length > 0 && localItems.every((i) => i.completed)

  async function complete(item: FocusItem) {
    if (item.completed || loading) return
    setLoading(item._id)
    // Optimistic
    setLocalItems((prev) => prev.map((i) => i._id === item._id ? { ...i, completed: true } : i))

    try {
      if (item.type === 'task') {
        const res = await fetch(`/api/tasks/${item._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: true }),
        })
        if (!res.ok) throw new Error()
      } else {
        const res = await fetch('/api/habits/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ habitId: item._id, completed: true }),
        })
        if (!res.ok) throw new Error()
      }
      success('Done! Great work 🎉')
      onItemCompleted?.(item._id, item.type)
    } catch {
      // Revert
      setLocalItems((prev) => prev.map((i) => i._id === item._id ? { ...i, completed: false } : i))
      toastError('Failed to update. Try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <GlassCard padding="md" level="elevated" highlight>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-xl bg-indigo-500/12 border border-indigo-500/20 flex items-center justify-center">
          <Target size={13} className="text-indigo-500" />
        </div>
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Focus for Today
        </h2>
        {localItems.length > 0 && (
          <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-medium">
            {localItems.filter((i) => i.completed).length} / {localItems.length}
          </span>
        )}
      </div>

      {/* Empty — all caught up */}
      {localItems.length === 0 && (
        <div className="py-6 text-center">
          <div className="w-10 h-10 rounded-2xl glass flex items-center justify-center text-xl mx-auto mb-2">✨</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>You&apos;re all caught up.</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Nice work.</p>        </div>
      )}

      {/* All done */}
      {allDone && localItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="py-4 text-center"
        >
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-center text-xl mx-auto mb-2">🎉</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Focus complete!</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Outstanding work today.</p>
        </motion.div>
      )}

      {/* Items */}
      {!allDone && localItems.length > 0 && (
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {localItems.map((item, idx) => {
              const isLoading = loading === item._id
              const reasonMeta = REASON_LABEL[item.reason]
              return (
                <motion.div
                  key={item._id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: item.completed ? 0.45 : 1, x: 0 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.25, delay: idx * 0.04 }}
                  className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-white/[0.04] transition-colors group"
                >
                  {/* Complete button */}
                  <button
                    onClick={() => complete(item)}
                    disabled={item.completed || !!loading}
                    className="flex-shrink-0 transition-transform active:scale-90 disabled:cursor-default"
                    aria-label={item.completed ? 'Completed' : `Complete ${item.title}`}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {isLoading ? (
                        <motion.div key="spin" initial={{ scale: 0.6 }} animate={{ scale: 1 }} exit={{ scale: 0.6 }}>
                          <div className="w-[18px] h-[18px] rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                        </motion.div>
                      ) : item.completed ? (
                        <motion.div key="done" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}>
                          <CheckCircle2 size={18} className="text-emerald-500" />
                        </motion.div>
                      ) : (
                        <motion.div key="todo" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}>
                          {item.type === 'habit'
                            ? <span className="text-base leading-none">{item.icon ?? '⭐'}</span>
                            : <Circle size={18} style={{ color: 'var(--text-faint)' }} />
                          }
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>

                  {/* Title + reason */}
                  <div className="flex-1 min-w-0">
                    <span className={cn('text-sm block truncate', item.completed && 'line-through')} style={{ color: 'var(--text-primary)' }}>
                      {item.title}
                    </span>
                    <span className={cn('text-[10px] font-medium', reasonMeta.color)}>
                      {reasonMeta.text}
                    </span>
                  </div>

                  {/* Priority badge */}
                  {item.priority && item.type === 'task' && !item.completed && (
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                      item.priority === 'high'   && 'bg-red-500/10 text-red-500',
                      item.priority === 'medium' && 'bg-amber-500/10 text-amber-500',
                      item.priority === 'low'    && 'bg-emerald-500/10 text-emerald-500',
                    )}>
                      {item.priority}
                    </span>
                  )}

                  {/* Complete CTA (visible on hover for incomplete items) */}
                  {!item.completed && !isLoading && (
                    <motion.button
                      onClick={() => complete(item)}
                      disabled={!!loading}
                      initial={{ opacity: 0 }}
                      whileHover={{ opacity: 1 }}
                      className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-500 font-medium transition-all shrink-0 flex items-center gap-1"
                    >
                      <Check size={9} /> Done
                    </motion.button>
                  )}

                  {item.reason === 'overdue' && (
                    <Flame size={12} className="text-red-400 shrink-0" />
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </GlassCard>
  )
}
