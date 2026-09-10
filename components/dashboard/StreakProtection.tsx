'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Check } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import type { StreakRiskHabit } from '@/lib/dashboard'

interface Props {
  habits: StreakRiskHabit[]
  onCompleted?: (habitId: string) => void
}

export function StreakProtection({ habits, onCompleted }: Props) {
  const { success, error: toastError } = useToast()
  const [localHabits, setLocalHabits] = useState<StreakRiskHabit[]>(habits)
  const [loading, setLoading] = useState<string | null>(null)

  // Remove habits as they're completed
  const visible = localHabits.filter((h) => !h.completedToday)

  if (visible.length === 0) return null

  async function completeHabit(habit: StreakRiskHabit) {
    if (loading) return
    setLoading(habit._id)
    // Optimistic
    setLocalHabits((prev) =>
      prev.map((h) => h._id === habit._id ? { ...h, completedToday: true } : h)
    )
    try {
      const res = await fetch('/api/habits/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habitId: habit._id, completed: true }),
      })
      if (!res.ok) throw new Error()
      success(`🔥 ${habit.name} streak saved! ${habit.streak + 1} days!`)
      onCompleted?.(habit._id)
    } catch {
      setLocalHabits((prev) =>
        prev.map((h) => h._id === habit._id ? { ...h, completedToday: false } : h)
      )
      toastError('Failed to complete habit. Try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <GlassCard padding="md" level="regular">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-xl bg-orange-500/12 border border-orange-500/20 flex items-center justify-center">
          <Flame size={13} className="text-orange-500" />
        </div>
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Streak at Risk
        </h2>
        <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 font-medium">
          {visible.length} habit{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Risk items */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {visible.map((habit) => {
            const isLoading = loading === habit._id
            return (
              <motion.div
                key={habit._id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22 }}
                className="flex items-center justify-between gap-3 glass-subtle rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl shrink-0">{habit.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {habit.name}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Flame size={10} className="text-orange-400" />
                      <span className="text-[11px] text-orange-400 font-medium">
                        {habit.streak} day streak
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        · Complete today to keep it alive
                      </span>
                    </div>
                  </div>
                </div>

                <GlassButton
                  variant="primary"
                  size="xs"
                  loading={isLoading}
                  onClick={() => completeHabit(habit)}
                  disabled={!!loading && loading !== habit._id}
                  icon={!isLoading ? <Check size={11} /> : undefined}
                  style={{ background: 'var(--warning)', boxShadow: '0 2px 8px rgba(217,119,6,0.25)' }}
                >
                  Complete
                </GlassButton>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}
