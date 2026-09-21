'use client'

/**
 * GoalsPanel — the full Goals UI used in two places:
 *   1. ProjectsClient (tab="goals") — standalone goals, no projectId filter
 *   2. ProjectDetailClient — goals for a specific project, projectId= passed in
 *
 * Props:
 *   projectId      – when set, only shows/creates goals for that project
 *   projectTitle   – display name used in empty-state copy
 *   initialOpen    – open the "New Goal" modal immediately on mount
 *   initialDraftId – pre-load this draft into the form
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Target, Plus, CheckCircle2, Archive, Pencil,
  Trash2, ChevronDown, ChevronUp, FolderOpen, FolderInput,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Goal {
  _id: string
  title: string
  description?: string
  category: string
  targetValue: number
  currentValue: number
  unit: string
  startDate: string
  targetDate?: string
  status: 'active' | 'completed' | 'archived'
  projectId: string | null
  linkedTaskIds: string[]
  linkedHabitIds: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  health: '❤️', finance: '💰', education: '📚', career: '💼',
  personal: '🌱', fitness: '💪', creative: '🎨', other: '⭐',
}

const CATEGORIES = [
  { value: 'personal',   label: 'Personal'   },
  { value: 'finance',    label: 'Finance'     },
  { value: 'health',     label: 'Health'      },
  { value: 'fitness',    label: 'Fitness'     },
  { value: 'education',  label: 'Education'   },
  { value: 'career',     label: 'Career'      },
  { value: 'creative',   label: 'Creative'    },
  { value: 'other',      label: 'Other'       },
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProgressBar({ pct, color = '#3b82f6' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, pct)}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
  )
}

// ─── GoalForm ────────────────────────────────────────────────────────────────

interface GoalFormProps {
  initial?: Partial<Goal>
  /** When set, the goal is pre-associated with this project */
  projectId?: string | null
  /** List of projects available for "Move to Project" selector */
  availableProjects?: { _id: string; title: string }[]
  onSave: (data: Partial<Goal>) => void
  onClose: () => void
  loading: boolean
  onFormChange?: (data: Record<string, unknown>) => void
  draftIdParam?: string
}

export function GoalForm({
  initial,
  projectId,
  availableProjects,
  onSave,
  onClose,
  loading,
  onFormChange,
  draftIdParam,
}: GoalFormProps) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    title:        initial?.title        ?? '',
    description:  initial?.description  ?? '',
    category:     initial?.category     ?? 'personal',
    targetValue:  initial?.targetValue  ?? 1,
    currentValue: initial?.currentValue ?? 0,
    unit:         initial?.unit         ?? 'units',
    startDate:    initial?.startDate    ?? today,
    targetDate:   initial?.targetDate   ?? '',
    // projectId: use the initial value if editing; else the panel's projectId
    projectId:    initial?._id
      ? (initial.projectId ?? null)
      : (projectId ?? null),
  })

  const set = (k: string, v: unknown) => {
    const next = { ...form, [k]: v }
    setForm(next)
    onFormChange?.(next)
  }

  // Load draft data on mount (only for new goals, not edits)
  useEffect(() => {
    if (!draftIdParam || initial?._id) return
    fetch(`/api/drafts/${draftIdParam}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.draft?.data) {
          const data = d.draft.data as Partial<typeof form>
          const loaded = {
            title:        data.title        ?? '',
            description:  data.description  ?? '',
            category:     data.category     ?? 'personal',
            targetValue:  Number(data.targetValue  ?? 1),
            currentValue: Number(data.currentValue ?? 0),
            unit:         data.unit         ?? 'units',
            startDate:    data.startDate    ?? today,
            targetDate:   data.targetDate   ?? '',
            projectId:    (data.projectId as string | null | undefined) ?? (projectId ?? null),
          }
          setForm(loaded)
          onFormChange?.(loaded)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projectOptions = [
    { value: '', label: 'None (standalone)' },
    ...(availableProjects ?? []).map((p) => ({ value: p._id, label: p.title })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <GlassInput
        label="Title"
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
        placeholder="e.g. Read 10 books"
        required
      />
      <GlassTextarea
        label="Description"
        value={form.description}
        onChange={(e) => set('description', e.target.value)}
        placeholder="Optional details…"
        rows={2}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassSelect
          label="Category"
          value={form.category}
          onChange={(v) => set('category', v)}
          options={CATEGORIES}
        />
        <GlassInput
          label="Unit"
          value={form.unit}
          onChange={(e) => set('unit', e.target.value)}
          placeholder="books, km, ₹…"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassInput
          label="Target"
          type="number"
          min={0}
          value={form.targetValue}
          onChange={(e) => set('targetValue', Number(e.target.value))}
        />
        <GlassInput
          label="Current Progress"
          type="number"
          min={0}
          value={form.currentValue}
          onChange={(e) => set('currentValue', Number(e.target.value))}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassInput
          label="Start Date"
          type="date"
          value={form.startDate}
          onChange={(e) => set('startDate', e.target.value)}
        />
        <GlassInput
          label="Target Date"
          type="date"
          value={form.targetDate}
          onChange={(e) => set('targetDate', e.target.value)}
        />
      </div>
      {/* Project association — only show when there are projects to pick from */}
      {availableProjects && availableProjects.length > 0 && (
        <GlassSelect
          label="Project (optional)"
          value={form.projectId ?? ''}
          onChange={(v) => set('projectId', v || null)}
          options={projectOptions}
        />
      )}
      <div className="flex gap-2.5 justify-end pt-1">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton
          variant="primary"
          size="sm"
          loading={loading}
          onClick={() => onSave(form)}
        >
          {initial?._id ? 'Save Changes' : 'Create Goal'}
        </GlassButton>
      </div>
    </div>
  )
}

// ─── GoalCard ────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: Goal
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onUpdateStatus: (status: 'active' | 'completed' | 'archived') => void
  onDelete: () => void
  /** When true, shows a "Move to Project" button */
  showMoveToProject?: boolean
  onMoveToProject?: () => void
}

export function GoalCard({
  goal,
  isExpanded,
  onToggleExpand,
  onEdit,
  onUpdateStatus,
  onDelete,
  showMoveToProject,
  onMoveToProject,
}: GoalCardProps) {
  const pct = goal.targetValue > 0
    ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100))
    : 0

  return (
    <GlassCard padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl flex-shrink-0">{CATEGORY_ICONS[goal.category] ?? '⭐'}</span>
          <div className="min-w-0">
            <p
              className="font-semibold text-[14px] truncate"
              style={{
                color: goal.status === 'completed' ? 'var(--text-muted)' : 'var(--text-primary)',
                textDecoration: goal.status === 'completed' ? 'line-through' : 'none',
              }}
            >
              {goal.title}
            </p>
            {goal.targetDate && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                Target: {formatDate(goal.targetDate)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggleExpand}
            className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Edit goal"
          >
            <Pencil size={13} />
          </button>
          {goal.status === 'active' && (
            <button
              onClick={() => onUpdateStatus('completed')}
              className="p-1.5 rounded-lg hover:bg-green-50 transition-colors"
              style={{ color: 'var(--success-text)' }}
              aria-label="Mark complete"
            >
              <CheckCircle2 size={13} />
            </button>
          )}
          {goal.status === 'completed' && (
            <button
              onClick={() => onUpdateStatus('active')}
              className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Reopen goal"
            >
              <CheckCircle2 size={13} />
            </button>
          )}
          {goal.status !== 'archived' && (
            <button
              onClick={() => onUpdateStatus('archived')}
              className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
              style={{ color: 'var(--text-faint)' }}
              aria-label="Archive goal"
            >
              <Archive size={13} />
            </button>
          )}
          {showMoveToProject && onMoveToProject && (
            <button
              onClick={onMoveToProject}
              className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
              style={{ color: 'var(--accent)' }}
              aria-label="Move to project"
              title="Move to project"
            >
              <FolderInput size={13} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
            style={{ color: 'var(--danger)' }}
            aria-label="Delete goal"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {goal.currentValue} / {goal.targetValue} {goal.unit}
          </span>
          <span
            className="text-xs font-semibold"
            style={{ color: pct >= 100 ? 'var(--success-text)' : 'var(--accent-text)' }}
          >
            {pct}%
          </span>
        </div>
        <ProgressBar pct={pct} color={pct >= 100 ? '#16a34a' : '#3b82f6'} />
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-3" style={{ borderTop: '1px solid var(--border)' }}>
              {goal.description && (
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                  {goal.description}
                </p>
              )}
              <div className="flex gap-4 text-xs flex-wrap" style={{ color: 'var(--text-faint)' }}>
                <span>Started: {formatDate(goal.startDate)}</span>
                {goal.linkedTaskIds.length > 0 && (
                  <span>{goal.linkedTaskIds.length} linked tasks</span>
                )}
                {goal.linkedHabitIds.length > 0 && (
                  <span>{goal.linkedHabitIds.length} linked habits</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// ─── MoveToProjectModal ───────────────────────────────────────────────────────

interface MoveToProjectModalProps {
  goal: Goal
  projects: { _id: string; title: string }[]
  onMove: (projectId: string | null) => void
  onClose: () => void
  loading: boolean
}

function MoveToProjectModal({ goal, projects, onMove, onClose, loading }: MoveToProjectModalProps) {
  const [selected, setSelected] = useState<string>(goal.projectId ?? '')

  const options = [
    { value: '', label: 'None (standalone goal)' },
    ...projects.map((p) => ({ value: p._id, label: p.title })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Choose a project for <strong>{goal.title}</strong>, or leave as standalone.
      </p>
      <GlassSelect
        label="Project"
        value={selected}
        onChange={(v) => setSelected(v)}
        options={options}
      />
      <div className="flex gap-2.5 justify-end pt-1">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton
          variant="primary"
          size="sm"
          loading={loading}
          icon={<FolderOpen size={13} />}
          onClick={() => onMove(selected || null)}
        >
          Move
        </GlassButton>
      </div>
    </div>
  )
}

// ─── GoalsPanel ───────────────────────────────────────────────────────────────

interface GoalsPanelProps {
  /** When provided, Goals are scoped to this project */
  projectId?: string | null
  projectTitle?: string
  initialOpen?: boolean
  initialDraftId?: string
  /** Projects list for "Move to Project" and form selector */
  availableProjects?: { _id: string; title: string }[]
}

export function GoalsPanel({
  projectId = null,
  projectTitle,
  initialOpen = false,
  initialDraftId,
  availableProjects = [],
}: GoalsPanelProps) {
  const { success, error: showError } = useToast()

  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'active' | 'completed' | 'archived' | 'all'>('active')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null)
  const [moveTarget, setMoveTarget] = useState<Goal | null>(null)
  const [movingSaving, setMovingSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showUnsaved, setShowUnsaved] = useState(false)

  const formDataRef = useRef<Record<string, unknown>>({})

  const draft = useDraft({
    type: 'goal',
    initialDraftId,
    getTitle:          () => (formDataRef.current.title as string) || 'Goal Draft',
    getData:           () => ({ ...formDataRef.current }),
    hasMeaningfulData: () => Boolean((formDataRef.current.title as string)?.trim()),
  })

  // Open modal immediately if told to (e.g. ?new=1 or ?tab=goals&new=1)
  useEffect(() => {
    if (initialOpen) { setEditing(null); setModalOpen(true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleModalClose() {
    if (!editing && draft.hasMeaningfulData()) {
      setShowUnsaved(true)
    } else {
      setModalOpen(false)
      setEditing(null)
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      // Scope by project: null/undefined means "all goals", a string scopes to project
      if (projectId !== undefined && projectId !== null) {
        params.set('projectId', projectId)
      }
      const res = await fetch(`/api/goals?${params.toString()}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setGoals(data.goals)
    } catch {
      showError('Failed to load goals')
    } finally {
      setLoading(false)
    }
  }, [filter, projectId, showError])

  useEffect(() => { void load() }, [load])

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async function saveGoal(form: Partial<Goal>) {
    if (!form.title?.trim()) { showError('Title is required'); return }
    setSaving(true)
    try {
      const url    = editing ? `/api/goals/${editing._id}` : '/api/goals'
      const method = editing ? 'PATCH' : 'POST'

      // For new goals scoped to a project, inject projectId
      const body = editing
        ? form
        : { ...form, projectId: (form.projectId !== undefined ? form.projectId : projectId) }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      if (!editing) await draft.deleteDraft()
      success(editing ? 'Goal updated' : 'Goal created')
      setModalOpen(false)
      setEditing(null)
      load()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(goal: Goal, status: 'active' | 'completed' | 'archived') {
    try {
      const res = await fetch(`/api/goals/${goal._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      success(
        status === 'completed' ? '🎉 Goal completed!'
        : status === 'active'  ? 'Goal reopened'
        : `Goal archived`
      )
      load()
    } catch {
      showError('Failed to update goal')
    }
  }

  async function deleteGoal() {
    if (!deleteTarget) return
    try {
      await fetch(`/api/goals/${deleteTarget._id}`, { method: 'DELETE' })
      success('Goal deleted')
      setDeleteTarget(null)
      load()
    } catch {
      showError('Failed to delete goal')
    }
  }

  async function moveGoal(newProjectId: string | null) {
    if (!moveTarget) return
    setMovingSaving(true)
    try {
      const res = await fetch(`/api/goals/${moveTarget._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: newProjectId }),
      })
      if (!res.ok) throw new Error()
      success(newProjectId ? 'Goal moved to project' : 'Goal is now standalone')
      setMoveTarget(null)
      load()
    } catch {
      showError('Failed to move goal')
    } finally {
      setMovingSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const emptyMessage = projectId
    ? `No goals for ${projectTitle ? `"${projectTitle}"` : 'this project'} yet.`
    : filter === 'all' ? 'No goals yet.' : `No ${filter} goals yet.`

  return (
    <div className="flex flex-col gap-4">
      {/* Header (only shown when NOT embedded in a project — i.e., the standalone Goals tab) */}
      {projectId === null && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Goals</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Track your long-term ambitions
            </p>
          </div>
          <GlassButton
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => { setEditing(null); setModalOpen(true) }}
          >
            New Goal
          </GlassButton>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 p-1 glass rounded-xl w-fit">
          {(['active', 'completed', 'archived', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                filter === f ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
              }`}
              style={filter !== f ? { color: 'var(--text-muted)' } : {}}
            >
              {f}
            </button>
          ))}
        </div>
        {/* Add Goal button when embedded inside a project */}
        {projectId !== null && (
          <GlassButton
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => { setEditing(null); setModalOpen(true) }}
          >
            Add Goal
          </GlassButton>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass rounded-2xl h-28 animate-pulse"
              style={{ background: 'rgba(0,0,0,0.04)' }}
            />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-12 text-center">
          <Target size={36} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            {emptyMessage}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Create a goal and track your progress over time.
          </p>
          <GlassButton
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => { setEditing(null); setModalOpen(true) }}
          >
            {projectId !== null ? 'Add Goal' : 'Create Goal'}
          </GlassButton>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {goals.map((goal) => (
              <motion.div
                key={goal._id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
              >
                <GoalCard
                  goal={goal}
                  isExpanded={expandedId === goal._id}
                  onToggleExpand={() => setExpandedId(expandedId === goal._id ? null : goal._id)}
                  onEdit={() => { setEditing(goal); setModalOpen(true) }}
                  onUpdateStatus={(s) => updateStatus(goal, s)}
                  onDelete={() => setDeleteTarget(goal)}
                  showMoveToProject={availableProjects.length > 0}
                  onMoveToProject={() => setMoveTarget(goal)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={handleModalClose}
        title={editing ? 'Edit Goal' : (projectId !== null ? 'Add Goal' : 'New Goal')}
        size="md"
      >
        <GoalForm
          initial={editing ?? undefined}
          projectId={projectId}
          availableProjects={availableProjects}
          onSave={saveGoal}
          onClose={handleModalClose}
          loading={saving}
          onFormChange={(data) => {
            formDataRef.current = data
            if (!editing) draft.triggerAutosave()
          }}
          draftIdParam={!editing ? initialDraftId : undefined}
        />
        {!editing && (
          <div className="flex items-center justify-between pt-2 pb-1">
            <SaveDraftStatus status={draft.saveStatus} />
            <GlassButton variant="secondary" size="sm" onClick={() => draft.saveDraft()}>
              Save Draft
            </GlassButton>
          </div>
        )}
      </Modal>

      <UnsavedChangesDialog
        isOpen={showUnsaved}
        onContinueEditing={() => setShowUnsaved(false)}
        onSaveAsDraft={async () => {
          await draft.saveDraft()
          setShowUnsaved(false)
          setModalOpen(false)
          setEditing(null)
        }}
        onDiscard={() => {
          draft.deleteDraft()
          setShowUnsaved(false)
          setModalOpen(false)
          setEditing(null)
        }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteGoal}
        title="Delete Goal"
        message={`Delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />

      {/* Move to project modal */}
      {moveTarget && (
        <Modal
          isOpen={!!moveTarget}
          onClose={() => setMoveTarget(null)}
          title="Move Goal to Project"
          size="sm"
        >
          <MoveToProjectModal
            goal={moveTarget}
            projects={availableProjects}
            onMove={moveGoal}
            onClose={() => setMoveTarget(null)}
            loading={movingSaving}
          />
        </Modal>
      )}
    </div>
  )
}
