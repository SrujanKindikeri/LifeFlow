'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { FolderOpen, Plus, Archive, Pencil, Trash2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'
import { GoalsPanel } from '@/components/goals/GoalsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  _id: string
  title: string
  description?: string
  status: 'active' | 'on_hold' | 'completed' | 'archived'
  dueDate?: string
  color: string
  taskCount: number
  completedTaskCount: number
  noteCount: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: '#3b82f6' },
  on_hold:   { label: 'On Hold',   color: '#f59e0b' },
  completed: { label: 'Completed', color: '#16a34a' },
  archived:  { label: 'Archived',  color: '#6b7280' },
}

const STATUS_OPTIONS = [
  { value: 'active',    label: 'Active'    },
  { value: 'on_hold',   label: 'On Hold'   },
  { value: 'completed', label: 'Completed' },
  { value: 'archived',  label: 'Archived'  },
]

const COLOR_PRESETS = [
  '#3b82f6','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#ef4444','#6366f1','#0ea5e9',
]

// ─── ProjectForm ──────────────────────────────────────────────────────────────

function ProjectForm({
  initial, onSave, onClose, loading, onFormChange, draftIdParam,
}: {
  initial?: Partial<Project>
  onSave: (d: Partial<Project>) => void
  onClose: () => void
  loading: boolean
  onFormChange?: (data: Record<string, unknown>) => void
  draftIdParam?: string
}) {
  const [form, setForm] = useState({
    title:       initial?.title       ?? '',
    description: initial?.description ?? '',
    status:      initial?.status      ?? 'active',
    dueDate:     initial?.dueDate     ?? '',
    color:       initial?.color       ?? '#3b82f6',
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
            title:       data.title       ?? '',
            description: data.description ?? '',
            status:      (data.status     ?? 'active') as typeof form['status'],
            dueDate:     data.dueDate     ?? '',
            color:       data.color       ?? '#3b82f6',
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
      <GlassInput
        label="Project Name"
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
        placeholder="e.g. Final Year Project"
        required
      />
      <GlassTextarea
        label="Description"
        value={form.description}
        onChange={(e) => set('description', e.target.value)}
        placeholder="What is this project about?"
        rows={2}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassSelect
          label="Status"
          value={form.status}
          onChange={(v) => set('status', v)}
          options={STATUS_OPTIONS}
        />
        <GlassInput
          label="Deadline"
          type="date"
          value={form.dueDate}
          onChange={(e) => set('dueDate', e.target.value)}
        />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Color</p>
        <div className="flex gap-2 flex-wrap">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => set('color', c)}
              className="w-7 h-7 rounded-full transition-transform hover:scale-110"
              style={{
                background: c,
                outline: form.color === c ? `3px solid ${c}` : 'none',
                outlineOffset: 2,
              }}
              aria-label={`Select color ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2.5 justify-end pt-1">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton
          variant="primary"
          size="sm"
          loading={loading}
          onClick={() => onSave(form)}
        >
          {initial?._id ? 'Save Changes' : 'Create Project'}
        </GlassButton>
      </div>
    </div>
  )
}

// ─── ProjectsTab ──────────────────────────────────────────────────────────────

function ProjectsTab() {
  const searchParams   = useSearchParams()
  const draftIdParam   = searchParams.get('draftId') ?? undefined
  const openNew        = searchParams.get('new') === '1'
  const { success, error: showError } = useToast()

  const [projects, setProjects]       = useState<Project[]>([])
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [filter, setFilter]           = useState<string>('active')
  const [modalOpen, setModalOpen]     = useState(false)
  const [editing, setEditing]         = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const formDataRef = useRef<Record<string, unknown>>({})

  const draft = useDraft({
    type: 'project',
    initialDraftId: draftIdParam,
    getTitle:          () => (formDataRef.current.title as string) || 'Project Draft',
    getData:           () => ({ ...formDataRef.current }),
    hasMeaningfulData: () => Boolean((formDataRef.current.title as string)?.trim()),
  })

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!openNew) return
    if (draftIdParam) {
      fetch(`/api/drafts/${draftIdParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.draft) { setEditing(null); setModalOpen(true) } })
        .catch(() => { setEditing(null); setModalOpen(true) })
    } else {
      setEditing(null); setModalOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew])

  function handleModalClose() {
    if (!editing && draft.hasMeaningfulData()) { setShowUnsaved(true) }
    else { setModalOpen(false); setEditing(null) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = filter === 'all' ? '/api/projects' : `/api/projects?status=${filter}`
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setProjects(data.projects)
    } catch {
      showError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [filter, showError])

  useEffect(() => { void load() }, [load])

  async function save(form: Partial<Project>) {
    if (!form.title?.trim()) { showError('Title is required'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/projects/${editing._id}` : '/api/projects'
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      if (!editing) await draft.deleteDraft()
      success(editing ? 'Project updated' : 'Project created')
      setModalOpen(false); setEditing(null); load()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  async function del() {
    if (!deleteTarget) return
    try {
      await fetch(`/api/projects/${deleteTarget._id}`, { method: 'DELETE' })
      success('Project deleted'); setDeleteTarget(null); load()
    } catch { showError('Failed to delete') }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Projects</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Organise tasks and notes into projects
          </p>
        </div>
        <GlassButton
          variant="primary"
          icon={<Plus size={15} />}
          onClick={() => { setEditing(null); setModalOpen(true) }}
        >
          New Project
        </GlassButton>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl overflow-x-auto">
        {['active', 'on_hold', 'completed', 'archived', 'all'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
              filter === f ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
            }`}
            style={filter !== f ? { color: 'var(--text-muted)' } : {}}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass rounded-2xl h-40 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <FolderOpen size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold text-[15px]" style={{ color: 'var(--text-secondary)' }}>
            No projects yet
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Create a project to organise your work.
          </p>
          <GlassButton
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => { setEditing(null); setModalOpen(true) }}
          >
            New Project
          </GlassButton>
        </GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <AnimatePresence>
            {projects.map((p) => {
              const progress    = p.taskCount > 0 ? Math.round((p.completedTaskCount / p.taskCount) * 100) : 0
              const statusInfo  = STATUS_LABELS[p.status]
              return (
                <motion.div
                  key={p._id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <GlassCard padding="md" className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5" style={{ background: p.color }} />
                        <div className="min-w-0">
                          <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--text-primary)' }}>
                            {p.title}
                          </p>
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: `${statusInfo.color}18`, color: statusInfo.color }}
                          >
                            {statusInfo.label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => { setEditing(p); setModalOpen(true) }}
                          className="p-1.5 rounded-lg hover:bg-black/[0.05]"
                          style={{ color: 'var(--text-muted)' }}
                          aria-label="Edit project"
                        >
                          <Pencil size={12} />
                        </button>
                        {p.status !== 'archived' && (
                          <button
                            onClick={() => save({ ...p, status: 'archived' })}
                            className="p-1.5 rounded-lg hover:bg-black/[0.05]"
                            style={{ color: 'var(--text-faint)' }}
                            aria-label="Archive project"
                          >
                            <Archive size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteTarget(p)}
                          className="p-1.5 rounded-lg hover:bg-red-50"
                          style={{ color: 'var(--danger)' }}
                          aria-label="Delete project"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {p.description && (
                      <p className="text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                        {p.description}
                      </p>
                    )}

                    <div className="flex gap-4 text-xs" style={{ color: 'var(--text-faint)' }}>
                      <span>{p.completedTaskCount}/{p.taskCount} tasks</span>
                      <span>{p.noteCount} notes</span>
                      {p.dueDate && <span>Due {formatDate(p.dueDate)}</span>}
                    </div>

                    {p.taskCount > 0 && (
                      <div>
                        <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-faint)' }}>
                          <span>Progress</span><span>{progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${progress}%`, background: p.color }}
                          />
                        </div>
                      </div>
                    )}

                    <Link
                      href={`/app/projects/${p._id}`}
                      className="flex items-center gap-1 text-xs font-medium mt-1 hover:underline"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      View details <ChevronRight size={12} />
                    </Link>
                  </GlassCard>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={handleModalClose}
        title={editing ? 'Edit Project' : 'New Project'}
        size="md"
      >
        <ProjectForm
          initial={editing ?? undefined}
          onSave={save}
          onClose={handleModalClose}
          loading={saving}
          onFormChange={(data) => { formDataRef.current = data; if (!editing) draft.triggerAutosave() }}
          draftIdParam={!editing ? draftIdParam : undefined}
        />
        {!editing && (
          <div className="flex items-center justify-between px-0 pt-2 pb-1">
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
          setShowUnsaved(false); setModalOpen(false); setEditing(null)
        }}
        onDiscard={() => {
          draft.deleteDraft()
          setShowUnsaved(false); setModalOpen(false); setEditing(null)
        }}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={del}
        title="Delete Project"
        message={`Delete "${deleteTarget?.title}"? Goals inside this project will become standalone goals. Tasks and notes will be unlinked but not deleted.`}
        confirmLabel="Delete Project"
        danger
      />
    </>
  )
}

// ─── ProjectsClient ───────────────────────────────────────────────────────────

export function ProjectsClient() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  // Read active tab from URL (?tab=goals or ?tab=projects, default=projects)
  const tabParam = searchParams.get('tab')
  const activeTab = tabParam === 'goals' ? 'goals' : 'projects'

  // ?new=1 on the goals tab opens the Goal modal
  const openNewGoal  = activeTab === 'goals' && searchParams.get('new') === '1'
  const goalDraftId  = activeTab === 'goals' ? (searchParams.get('draftId') ?? undefined) : undefined

  function switchTab(tab: 'projects' | 'goals') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    // Clear goal/project-specific params when switching
    params.delete('new')
    params.delete('draftId')
    router.replace(`/app/projects?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Projects</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Manage your projects and goals in one place
        </p>
      </div>

      {/* Segmented tab control */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['projects', 'goals'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
              activeTab === tab ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
            }`}
            style={activeTab !== tab ? { color: 'var(--text-muted)' } : {}}
          >
            {tab === 'projects' ? 'Projects' : 'Goals'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTab === 'projects' ? (
          <motion.div
            key="projects"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-6"
          >
            <ProjectsTab />
          </motion.div>
        ) : (
          <motion.div
            key="goals"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <GoalsPanel
              projectId={null}
              initialOpen={openNewGoal}
              initialDraftId={goalDraftId}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
