'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, Info } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'

interface ScoreData {
  score: number; maxScore: number
  breakdown: {
    tasks:     { points: number; maxPoints: number; total: number; completed: number; overdue: number; rate: number }
    habits:    { points: number; maxPoints: number; total: number; consistency: number }
    finance:   { points: number; maxPoints: number; budgetsOnTrack: number | null; totalBudgets: number; overduePayments: number }
    deadlines: { points: number; maxPoints: number; activeGoals: number; missedGoals: number; overdueProjects: number }
  }
  note: string
}

function ScoreRing({ score, max }: { score: number; max: number }) {
  const pct = score / max
  const r = 44
  const c = 2 * Math.PI * r
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#f59e0b' : '#ef4444'

  return (
    /*
      Ring container: w-20 h-20 on narrow phones (80px), w-24 h-24 on sm+ (96px).
      Keeping it slightly smaller on 320px prevents the ring from crowding the
      text content next to it.
    */
    <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 96 96"
        className="-rotate-90"
      >
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="6"/>
        <motion.circle
          cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - c * pct }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-xl sm:text-2xl font-bold"
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {score}
        </motion.span>
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>/{max}</span>
      </div>
    </div>
  )
}

function BreakdownRow({ label, points, max }: { label: string; points: number; max: number }) {
  const pct = Math.round((points / max) * 100)
  const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="min-w-0">
      <div className="flex justify-between items-center mb-1 gap-2 min-w-0">
        <span className="text-xs font-medium truncate min-w-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-bold flex-shrink-0" style={{ color }}>{points}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

export function LifeFlowScore() {
  const [data, setData] = useState<ScoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    fetch('/api/score')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <GlassCard padding="sm" className="h-24 animate-pulse"><div /></GlassCard>
  }

  if (!data) return null

  return (
    <GlassCard padding="md">
      {/* Ring + text row — flex with min-w-0 guard so text side never overflows */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <ScoreRing score={data.score} max={data.maxScore} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 min-w-0">
            <h3 className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>LifeFlow Score</h3>
            <button
              onClick={() => setShowInfo(!showInfo)}
              className="p-0.5 rounded-md hover:bg-black/[0.05] transition-colors flex-shrink-0"
              style={{ color: 'var(--text-faint)' }}
              aria-label={showInfo ? 'Hide score info' : 'Show score info'}
            >
              <Info size={12} aria-hidden="true" />
            </button>
          </div>
          <p className="text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
            {data.score >= 80 ? 'Excellent — keep it up!' : data.score >= 60 ? 'Good — small improvements ahead' : 'Room to grow'}
          </p>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs mt-2 font-medium transition-colors hover:opacity-70"
            style={{ color: 'var(--accent-text)' }}
            aria-expanded={expanded}
          >
            How is this calculated? {expanded ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }} className="overflow-hidden">
            <p className="text-[11px] mt-3 leading-relaxed p-3 rounded-xl break-words" style={{ background: 'rgba(0,0,0,0.03)', color: 'var(--text-muted)' }}>
              {data.note}
            </p>
          </motion.div>
        )}
        {expanded && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }} className="overflow-hidden">
            <div className="pt-4 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)', marginTop: '12px' }}>
              <BreakdownRow label={`Tasks (rate: ${data.breakdown.tasks.rate}%, overdue: ${data.breakdown.tasks.overdue})`} points={data.breakdown.tasks.points} max={data.breakdown.tasks.maxPoints} />
              <BreakdownRow label={`Habits (7-day consistency: ${data.breakdown.habits.consistency}%)`} points={data.breakdown.habits.points} max={data.breakdown.habits.maxPoints} />
              <BreakdownRow label={`Finance (${data.breakdown.finance.overduePayments} overdue payments)`} points={data.breakdown.finance.points} max={data.breakdown.finance.maxPoints} />
              <BreakdownRow label={`Deadlines (${data.breakdown.deadlines.missedGoals} missed goals, ${data.breakdown.deadlines.overdueProjects} late projects)`} points={data.breakdown.deadlines.points} max={data.breakdown.deadlines.maxPoints} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}
