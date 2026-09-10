'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, Circle, StickyNote, Clock, Target } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import { GoalsPanel } from '@/components/goals/GoalsPanel'
import type { Goal } from '@/components/goals/GoalsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectDetail {
  project: {
    _id: string
    title: string
    description?: string
    status: string
    dueDate?: string
    color: string
    updatedAt: string
  }
  tasks: {
    _id: string
    title: string
    completed: boolean
    priority: string
    dueDate?: string
  }[]
  notes: {
    _id: string
    title: string
    content: string
    updatedAt: string
  }[]
  goals: Goal[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const { error: showError } = useToast()
  const [data, setData] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(() => showError('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id, showError])

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="glass rounded-2xl h-28 animate-pulse"
            style={{ background: 'rgba(0,0,0,0.04)' }}
          />
        ))}
      </div>
    )
  }

  if (!data) return null

  const { project, tasks, notes, goals } = data
  const done     = tasks.filter((t) => t.completed).length
  const taskPct  = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  // Goal progress: average across active+completed goals
  const scoredGoals = goals.filter((g) => g.targetValue > 0)
  const goalPct     = scoredGoals.length > 0
    ? Math.round(
        scoredGoals.reduce((sum, g) => sum + Math.min(100, (g.currentValue / g.targetValue) * 100), 0)
        / scoredGoals.length
      )
    : null

  return (
    <div className="flex flex-col gap-6">
      {/* ── Back + Title ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-xl hover:bg-black/[0.05] transition-colors"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Go back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: project.color }} />
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {project.title}
            </h1>
          </div>
          {project.dueDate && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Deadline: {formatDate(project.dueDate)}
            </p>
          )}
        </div>
      </div>

      {/* ── Description ── */}
      {project.description && (
        <GlassCard padding="md">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {project.description}
          </p>
        </GlassCard>
      )}

      {/* ── Progress summary ── */}
      <GlassCard padding="md">
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Project Progress
        </p>

        {/* Tasks progress */}
        {tasks.length > 0 && (
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tasks</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
                {taskPct}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: project.color }}
                initial={{ width: 0 }}
                animate={{ width: `${taskPct}%` }}
                transition={{ duration: 0.6 }}
              />
            </div>
          </div>
        )}

        {/* Goals progress */}
        {goalPct !== null && (
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Goals</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
                {goalPct}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: '#6366f1' }}
                initial={{ width: 0 }}
                animate={{ width: `${goalPct}%` }}
                transition={{ duration: 0.6, delay: 0.1 }}
              />
            </div>
          </div>
        )}

        {/* Overall */}
        {tasks.length > 0 && goalPct !== null && (
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Overall
              </span>
              <span className="text-xs font-bold" style={{ color: 'var(--accent-text)' }}>
                {Math.round((taskPct + goalPct) / 2)}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, var(--accent) 0%, #6366f1 100%)' }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round((taskPct + goalPct) / 2)}%` }}
                transition={{ duration: 0.6, delay: 0.2 }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-4 mt-3 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          <span>{done} / {tasks.length} tasks completed</span>
          <span>{goals.length} goal{goals.length !== 1 ? 's' : ''}</span>
          <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
        </div>
      </GlassCard>

      {/* ── Goals section ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Target size={14} style={{ color: 'var(--accent)' }} />
          <h2
            className="text-sm font-bold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Goals
          </h2>
        </div>
        <GoalsPanel
          projectId={id}
          projectTitle={project.title}
        />
      </div>

      {/* ── Tasks section ── */}
      <div>
        <h2
          className="text-sm font-bold uppercase tracking-wide mb-3"
          style={{ color: 'var(--text-muted)' }}
        >
          Tasks ({tasks.length})
        </h2>
        {tasks.length === 0 ? (
          <GlassCard padding="sm" className="text-center py-8">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No tasks linked to this project.
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              When creating a task, select this project to link it.
            </p>
          </GlassCard>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <GlassCard key={t._id} padding="sm" className="flex items-center gap-3">
                {t.completed
                  ? <CheckCircle2 size={16} style={{ color: 'var(--success-text)', flexShrink: 0 }} />
                  : <Circle      size={16} style={{ color: 'var(--text-faint)',   flexShrink: 0 }} />
                }
                <span
                  className="text-sm flex-1 min-w-0 truncate"
                  style={{
                    color:          t.completed ? 'var(--text-muted)'    : 'var(--text-primary)',
                    textDecoration: t.completed ? 'line-through' : 'none',
                  }}
                >
                  {t.title}
                </span>
                {t.dueDate && (
                  <span
                    className="text-xs flex-shrink-0 flex items-center gap-1"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    <Clock size={11} />{formatDate(t.dueDate)}
                  </span>
                )}
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* ── Notes section ── */}
      <div>
        <h2
          className="text-sm font-bold uppercase tracking-wide mb-3"
          style={{ color: 'var(--text-muted)' }}
        >
          Notes ({notes.length})
        </h2>
        {notes.length === 0 ? (
          <GlassCard padding="sm" className="text-center py-8">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No notes linked to this project.
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              When creating a note, select this project to link it.
            </p>
          </GlassCard>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {notes.map((n) => (
              <GlassCard key={n._id} padding="sm">
                <div className="flex items-start gap-2">
                  <StickyNote
                    size={13}
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: 'var(--accent)' }}
                  />
                  <div className="min-w-0">
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {n.title}
                    </p>
                    {n.content && (
                      <p
                        className="text-xs mt-0.5 line-clamp-2"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {n.content}
                      </p>
                    )}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                      {formatRelativeTime(n.updatedAt)}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <GlassButton
          variant="ghost"
          size="sm"
          onClick={() => router.push('/app/projects')}
        >
          Back to Projects
        </GlassButton>
      </div>
    </div>
  )
}
