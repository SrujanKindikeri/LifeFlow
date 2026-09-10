'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, Plus, CheckCircle2, Archive, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'

interface Goal {
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
  linkedTaskIds: string[]
  linkedHabitIds: string[]
}

const CATEGORY_ICONS: Record<string, string> = {
  health: '❤️', finance: '💰', education: '📚', career: '💼',
  personal: '🌱', fitness: '💪', creative: '🎨', other: '⭐',
}

const CATEGORIES = [
  { value: 'personal', label: 'Personal' },
  { value: 'finance', label: 'Finance' },
  { value: 'health', label: 'Health' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'education', label: 'Education' },
  { value: 'career', label: 'Career' },
  { value: 'creative', label: 'Creative' },
  { value: 'other', label: 'Other' },
]

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

function GoalForm({
  initial,
  onSave,
  onClose,
  loading,
  onFormChange,
  draftIdParam,
}: {
  initial?: Partial<Goal>
  onSave: (data: Partial<Goal>) => void
  onClose: () => void
  loading: boolean
  onFormChange?: (data: Record<string, unknown>) => void
  draftIdParam?: string
}) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    title:        initial?.title ?? '',
    description:  initial?.description ?? '',
    category:     initial?.category ?? 'personal',
    targetValue:  initial?.targetValue ?? 1,
    currentValue: initial?.currentValue ?? 0,
    unit:         initial?.unit ?? 'units',
    startDate:    initial?.startDate ?? today,
    targetDate:   initial?.targetDate ?? '',
  })
  const set = (k: string, v: unknown) => {
    const next = { ...form, [k]: v }
    setForm(next)
    onFormChange?.(next)
  }

  // Load draft data on mount
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
          }
          setForm(loaded)
          onFormChange?.(loaded)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <GlassInput label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Read 10 books" required />
      <GlassTextarea label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional details…" rows={2} />
      <div className="grid grid-cols-2 gap-3">
        <GlassSelect label="Category" value={form.category} onChange={(v) => set('category', v)} options={CATEGORIES} />
        <GlassInput label="Unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="books, km, ₹…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <GlassInput label="Target" type="number" min={0} value={form.targetValue} onChange={(e) => set('targetValue', Number(e.target.value))} />
        <GlassInput label="Current Progress" type="number" min={0} value={form.currentValue} onChange={(e) => set('currentValue', Number(e.target.value))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <GlassInput label="Start Date" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        <GlassInput label="Target Date" type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
      </div>
      <div className="flex gap-2.5 justify-end pt-1">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={() => onSave(form)}>
          {initial?._id ? 'Save Changes' : 'Create Goal'}
        </GlassButton>
      </div>
    </div>
  )
}

export function GoalsClient() {
  const searchParams = useSearchParams()
  const draftIdParam = searchParams.get('draftId') ?? undefined
  const openNew      = searchParams.get('new') === '1'
  const { success, error: showError } = useToast()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'active' | 'completed' | 'archived' | 'all'>('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const formDataRef = useRef<Record<string, unknown>>({})

  const draft = useDraft({
    type: 'goal',
    initialDraftId: draftIdParam,
    getTitle:  () => (formDataRef.current.title as string) || 'Goal Draft',
    getData:   () => ({ ...formDataRef.current }),
    hasMeaningfulData: () => Boolean((formDataRef.current.title as string)?.trim()),
  })

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!openNew) return
    setEditing(null); setModalOpen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew])

  function handleModalClose() {
    if (!editing && draft.hasMeaningfulData()) { setShowUnsaved(true) } else { setModalOpen(false); setEditing(null) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(filter === 'all' ? '/api/goals' : `/api/goals?status=${filter}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setGoals(data.goals)
    } catch {
      showError('Failed to load goals')
    } finally {
      setLoading(false)
    }
  }, [filter, showError])

  useEffect(() => { void load() }, [load])

  async function saveGoal(form: Partial<Goal>) {
    if (!form.title?.trim()) { showError('Title is required'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/goals/${editing._id}` : '/api/goals'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  async function updateStatus(goal: Goal, status: 'completed' | 'archived' | 'active') {
    try {
      const res = await fetch(`/api/goals/${goal._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      success(status === 'completed' ? '🎉 Goal completed!' : `Goal ${status}`)
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

  const filtered = goals

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Goals</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Track your long-term ambitions</p>
        </div>
        <GlassButton variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setModalOpen(true) }}>
          New Goal
        </GlassButton>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['active', 'completed', 'archived', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${filter === f ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'}`}
            style={filter !== f ? { color: 'var(--text-muted)' } : {}}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-2xl h-28 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <Target size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold text-[15px]" style={{ color: 'var(--text-secondary)' }}>No {filter === 'all' ? '' : filter} goals yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Create a goal and track your progress over time.</p>
          <GlassButton variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => { setEditing(null); setModalOpen(true) }}>
            Create Goal
          </GlassButton>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {filtered.map((goal) => {
              const pct = goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0
              const isExpanded = expandedId === goal._id
              return (
                <motion.div key={goal._id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                  <GlassCard padding="md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl flex-shrink-0">{CATEGORY_ICONS[goal.category] ?? '⭐'}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-[14px] truncate" style={{ color: goal.status === 'completed' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: goal.status === 'completed' ? 'line-through' : 'none' }}>
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
                        <button onClick={() => setExpandedId(isExpanded ? null : goal._id)} className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors" style={{ color: 'var(--text-muted)' }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button onClick={() => { setEditing(goal); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors" style={{ color: 'var(--text-muted)' }}>
                          <Pencil size={13} />
                        </button>
                        {goal.status === 'active' && (
                          <button onClick={() => updateStatus(goal, 'completed')} className="p-1.5 rounded-lg hover:bg-green-50 transition-colors" style={{ color: 'var(--success-text)' }}>
                            <CheckCircle2 size={13} />
                          </button>
                        )}
                        {goal.status !== 'archived' && (
                          <button onClick={() => updateStatus(goal, 'archived')} className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors" style={{ color: 'var(--text-faint)' }}>
                            <Archive size={13} />
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(goal)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" style={{ color: 'var(--danger)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="mt-3">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                          {goal.currentValue} / {goal.targetValue} {goal.unit}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: pct >= 100 ? 'var(--success-text)' : 'var(--accent-text)' }}>
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
                              <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{goal.description}</p>
                            )}
                            <div className="flex gap-4 text-xs" style={{ color: 'var(--text-faint)' }}>
                              <span>Started: {formatDate(goal.startDate)}</span>
                              {goal.linkedTaskIds.length > 0 && <span>{goal.linkedTaskIds.length} linked tasks</span>}
                              {goal.linkedHabitIds.length > 0 && <span>{goal.linkedHabitIds.length} linked habits</span>}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </GlassCard>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={handleModalClose} title={editing ? 'Edit Goal' : 'New Goal'} size="md">
        <GoalForm
          initial={editing ?? undefined}
          onSave={saveGoal}
          onClose={handleModalClose}
          loading={saving}
          onFormChange={(data) => { formDataRef.current = data; if (!editing) draft.triggerAutosave() }}
          draftIdParam={!editing ? draftIdParam : undefined}
        />
        {!editing && (
          <div className="flex items-center justify-between pt-2 pb-1">
            <SaveDraftStatus status={draft.saveStatus} />
            <GlassButton variant="secondary" size="sm" onClick={() => draft.saveDraft()}>Save Draft</GlassButton>
          </div>
        )}
      </Modal>

      <UnsavedChangesDialog
        isOpen={showUnsaved}
        onContinueEditing={() => setShowUnsaved(false)}
        onSaveAsDraft={async () => { await draft.saveDraft(); setShowUnsaved(false); setModalOpen(false); setEditing(null) }}
        onDiscard={() => { draft.deleteDraft(); setShowUnsaved(false); setModalOpen(false); setEditing(null) }}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteGoal}
        title="Delete Goal"
        message={`Delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}

