'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft, CheckCircle2, Circle, StickyNote, Clock,
  Target, Users, MessageSquare, Activity as ActivityIcon,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import { GoalsPanel } from '@/components/goals/GoalsPanel'
import { CollaborationPanel } from '@/components/projects/CollaborationPanel'
import { ProjectChat } from '@/components/projects/ProjectChat'
import type { Goal } from '@/components/goals/GoalsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectDetail {
  project: {
    _id: string
    userId: string
    title: string
    description?: string
    status: string
    dueDate?: string
    color: string
    collaborationEnabled: boolean
    role: 'owner' | 'member'
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

type TabId = 'overview' | 'tasks' | 'notes' | 'members' | 'chat'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Target size={13} /> },
  { id: 'tasks',    label: 'Tasks',    icon: <CheckCircle2 size={13} /> },
  { id: 'notes',    label: 'Notes',    icon: <StickyNote size={13} /> },
  { id: 'members',  label: 'Members',  icon: <Users size={13} /> },
  { id: 'chat',     label: 'Chat',     icon: <MessageSquare size={13} /> },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentUserId(): string {
  // Read from sessionStorage — set by SyncProvider on login
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('lifeflow_userId') ?? ''
  }
  return ''
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const { error: showError } = useToast()
  const [data, setData]         = useState<ProjectDetail | null>(null)
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [collaborationEnabled, setCollaborationEnabled] = useState(false)

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setData(d)
        setCollaborationEnabled(d.project.collaborationEnabled ?? false)
      })
      .catch(() => showError('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id, showError])

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-2xl h-28 animate-pulse"
            style={{ background: 'rgba(0,0,0,0.04)' }} />
        ))}
      </div>
    )
  }

  if (!data) return null

  const { project, tasks, notes, goals } = data
  const isOwner  = project.role === 'owner'
  const done     = tasks.filter((t) => t.completed).length
  const taskPct  = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0

  const scoredGoals = goals.filter((g) => g.targetValue > 0)
  const goalPct     = scoredGoals.length > 0
    ? Math.round(
        scoredGoals.reduce((sum, g) => sum + Math.min(100, (g.currentValue / g.targetValue) * 100), 0)
        / scoredGoals.length
      )
    : null

  // Only show Chat and Members tabs when collaboration is relevant
  const visibleTabs = TABS.filter((t) => {
    if ((t.id === 'chat' || t.id === 'members') && !collaborationEnabled && !isOwner) return false
    return true
  })

  const currentUserId = getCurrentUserId()

  return (
    <div className="flex flex-col gap-5">
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
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: project.color }} />
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {project.title}
            </h1>
            {collaborationEnabled && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}
              >
                <Users size={9} className="inline mr-0.5" />
                Collaborative
              </span>
            )}
            {!isOwner && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(22,163,74,0.10)', color: 'var(--success-text)' }}
              >
                Member
              </span>
            )}
          </div>
          {project.dueDate && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Deadline: {formatDate(project.dueDate)}
            </p>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 p-1 glass rounded-xl overflow-x-auto">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === t.id ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
            }`}
            style={activeTab !== t.id ? { color: 'var(--text-muted)' } : {}}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-5">
          {/* Description */}
          {project.description && (
            <GlassCard padding="md">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {project.description}
              </p>
            </GlassCard>
          )}

          {/* Progress */}
          <GlassCard padding="md">
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Project Progress
            </p>
            {tasks.length > 0 && (
              <div className="mb-3">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tasks</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>{taskPct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: project.color }}
                    initial={{ width: 0 }} animate={{ width: `${taskPct}%` }} transition={{ duration: 0.6 }} />
                </div>
              </div>
            )}
            {goalPct !== null && (
              <div className="mb-3">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Goals</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>{goalPct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: '#6366f1' }}
                    initial={{ width: 0 }} animate={{ width: `${goalPct}%` }} transition={{ duration: 0.6, delay: 0.1 }} />
                </div>
              </div>
            )}
            <div className="flex gap-4 mt-3 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
              <span>{done} / {tasks.length} tasks</span>
              <span>{goals.length} goal{goals.length !== 1 ? 's' : ''}</span>
              <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
            </div>
          </GlassCard>

          {/* Goals */}
          {isOwner && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Target size={14} style={{ color: 'var(--accent)' }} />
                <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Goals
                </h2>
              </div>
              <GoalsPanel projectId={id} projectTitle={project.title} />
            </div>
          )}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Tasks ({tasks.length})
          </h2>
          {tasks.length === 0 ? (
            <GlassCard padding="sm" className="text-center py-8">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No tasks linked to this project.</p>
              {isOwner && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                  When creating a task, select this project to link it.
                </p>
              )}
            </GlassCard>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((t) => (
                <GlassCard key={t._id} padding="sm" className="flex items-center gap-3">
                  {t.completed
                    ? <CheckCircle2 size={16} style={{ color: 'var(--success-text)', flexShrink: 0 }} />
                    : <Circle size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                  }
                  <span className="text-sm flex-1 min-w-0 truncate"
                    style={{ color: t.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                             textDecoration: t.completed ? 'line-through' : 'none' }}>
                    {t.title}
                  </span>
                  {t.dueDate && (
                    <span className="text-xs flex-shrink-0 flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                      <Clock size={11} />{formatDate(t.dueDate)}
                    </span>
                  )}
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'notes' && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Notes ({notes.length})
          </h2>
          {notes.length === 0 ? (
            <GlassCard padding="sm" className="text-center py-8">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No notes linked to this project.</p>
              {isOwner && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                  When creating a note, select this project to link it.
                </p>
              )}
            </GlassCard>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {notes.map((n) => (
                <GlassCard key={n._id} padding="sm">
                  <div className="flex items-start gap-2">
                    <StickyNote size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {n.title}
                      </p>
                      {n.content && (
                        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
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
      )}

      {activeTab === 'members' && (
        <CollaborationPanel
          projectId={id}
          isOwner={isOwner}
          collaborationEnabled={collaborationEnabled}
          onCollabToggle={setCollaborationEnabled}
        />
      )}

      {activeTab === 'chat' && (
        <>
          {collaborationEnabled ? (
            <ProjectChat projectId={id} currentUserId={currentUserId} />
          ) : (
            <GlassCard padding="lg" className="text-center">
              <MessageSquare size={28} className="mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
              <p className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>
                Chat is not available
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {isOwner
                  ? 'Enable collaboration in the Members tab to unlock project chat.'
                  : 'Project chat is only available when collaboration is enabled.'}
              </p>
              {isOwner && (
                <GlassButton
                  variant="primary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setActiveTab('members')}
                >
                  Go to Members
                </GlassButton>
              )}
            </GlassCard>
          )}
        </>
      )}

      {/* Back button */}
      <div className="flex justify-end pt-2">
        <GlassButton variant="ghost" size="sm" onClick={() => router.push('/app/projects')}>
          Back to Projects
        </GlassButton>
      </div>
    </div>
  )
}
