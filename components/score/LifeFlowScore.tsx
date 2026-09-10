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
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg width="96" height="96" className="-rotate-90">
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
          className="text-2xl font-bold"
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
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-bold" style={{ color }}>{points}/{max}</span>
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
      <div className="flex items-center gap-4">
        <ScoreRing score={data.score} max={data.maxScore} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>LifeFlow Score</h3>
            <button onClick={() => setShowInfo(!showInfo)} className="p-0.5 rounded-md hover:bg-black/[0.05] transition-colors" style={{ color: 'var(--text-faint)' }}>
              <Info size={12}/>
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {data.score >= 80 ? 'Excellent — keep it up!' : data.score >= 60 ? 'Good — small improvements ahead' : 'Room to grow'}
          </p>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs mt-2 font-medium transition-colors hover:opacity-70"
            style={{ color: 'var(--accent-text)' }}
          >
            How is this calculated? {expanded ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }} className="overflow-hidden">
            <p className="text-[11px] mt-3 leading-relaxed p-3 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)', color: 'var(--text-muted)' }}>
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
