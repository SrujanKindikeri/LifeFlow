'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Check, Trash2, Edit3, Calendar, Clock,
  AlertCircle, ChevronDown, ChevronUp, Flag, RefreshCw,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, SkeletonList } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { cn, PRIORITY_CONFIG, formatDate, getTodayString } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'
import type { Task } from '@/types'

type TabView = 'today' | 'upcoming' | 'completed'

interface TaskFormData {
  title:       string
  description: string
  priority:    'low' | 'medium' | 'high'
  dueDate:     string
  dueTime:     string
  recurring:   'none' | 'daily' | 'weekly' | 'monthly'
}

const defaultForm: TaskFormData = {
  title: '', description: '', priority: 'medium',
  dueDate: getTodayString(), dueTime: '', recurring: 'none',
}

export function TasksClient() {
  const searchParams  = useSearchParams()
  const [tasks,       setTasks]       = useState<Task[]>([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState<TabView>('today')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [deleteTarget,setDeleteTarget]= useState<Task | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [toggling,    setToggling]    = useState<string | null>(null)
  const [form,        setForm]        = useState<TaskFormData>(defaultForm)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const formRef = useRef<TaskFormData>(form)
  useEffect(() => { formRef.current = form }, [form])
  const { success, error: toastError } = useToast()

  // ── Draft integration ──────────────────────────────────────────────────────
  const draftIdParam   = searchParams.get('draftId') ?? undefined
  const openNew        = searchParams.get('new') === '1'

  const draft = useDraft({
    type: 'task',
    initialDraftId: draftIdParam,
    getTitle:  () => formRef.current.title || 'Task Draft',
    getData:   () => ({ ...formRef.current }),
    hasMeaningfulData: () => Boolean(formRef.current.title.trim() || formRef.current.description.trim()),
  })

  const fetchTasks = useCallback(async () => {
    try {
      const res  = await fetch('/api/tasks')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch { toastError('Failed to load tasks') }
    finally   { setLoading(false) }
  }, [toastError])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchTasks() }, [fetchTasks])

  const today         = getTodayString()
  const todayTasks    = tasks.filter((t) => !t.completed && (t.dueDate === today || !t.dueDate))
  const upcomingTasks = tasks.filter((t) => !t.completed && t.dueDate && t.dueDate > today).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
  const completedTasks= tasks.filter((t) => t.completed).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  const currentList   = tab === 'today' ? todayTasks : tab === 'upcoming' ? upcomingTasks : completedTasks

  const completedToday = tasks.filter((t) => t.completed && t.dueDate === today).length
  const totalToday     = tasks.filter((t) => t.dueDate === today || (!t.completed && !t.dueDate)).length

  /* ── Open modal from URL params (e.g. ?new=1 or ?new=1&draftId=xxx) ── */
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!openNew) return
    // If continuing from a draft, load draft data first
    if (draftIdParam) {
      fetch(`/api/drafts/${draftIdParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.draft?.data) {
            const data = d.draft.data as Partial<TaskFormData>
            setForm({
              title:       data.title       ?? defaultForm.title,
              description: data.description ?? defaultForm.description,
              priority:    (data.priority   ?? defaultForm.priority) as TaskFormData['priority'],
              dueDate:     data.dueDate     ?? today,
              dueTime:     data.dueTime     ?? defaultForm.dueTime,
              recurring:   (data.recurring  ?? defaultForm.recurring) as TaskFormData['recurring'],
            })
          }
          setEditingTask(null)
          setIsModalOpen(true)
        })
        .catch(() => { setEditingTask(null); setForm({ ...defaultForm, dueDate: today }); setIsModalOpen(true) })
    } else {
      setEditingTask(null)
      setForm({ ...defaultForm, dueDate: today })
      setIsModalOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew])

  /* ── Actions ── */
  function openCreate() { setEditingTask(null); setForm({ ...defaultForm, dueDate: today }); setIsModalOpen(true) }
  function openEdit(task: Task) {
    setEditingTask(task)
    setForm({ title: task.title, description: task.description ?? '', priority: task.priority, dueDate: task.dueDate ?? today, dueTime: task.dueTime ?? '', recurring: task.recurring })
    setIsModalOpen(true)
  }

  function handleModalClose() {
    // Only show unsaved dialog for new tasks (not edits) with meaningful data
    if (!editingTask && draft.hasMeaningfulData()) {
      setShowUnsaved(true)
    } else {
      setIsModalOpen(false)
    }
  }

  async function handleSave() {
    if (!form.title.trim()) { toastError('Title is required'); return }
    setSaving(true)
    try {
      const payload = { title: form.title.trim(), description: form.description.trim() || undefined, priority: form.priority, dueDate: form.dueDate || undefined, dueTime: form.dueTime || undefined, recurring: form.recurring }
      if (editingTask) {
        const res  = await fetch(`/api/tasks/${editingTask._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setTasks((p) => p.map((t) => t._id === editingTask._id ? data.task : t))
        success('Task updated')
      } else {
        const res  = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setTasks((p) => [data.task, ...p])
        // Delete draft if we just finalized one
        await draft.deleteDraft()
        success('Task created')
      }
      setIsModalOpen(false)
    } catch { toastError('Failed to save task') }
    finally   { setSaving(false) }
  }

  async function handleToggle(task: Task) {
    setToggling(task._id)
    try {
      const res  = await fetch(`/api/tasks/${task._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: !task.completed }) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks((p) => p.map((t) => t._id === task._id ? data.task : t))
    } catch { toastError('Failed to update task') }
    finally   { setToggling(null) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/tasks/${deleteTarget._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setTasks((p) => p.filter((t) => t._id !== deleteTarget._id))
      success('Task deleted')
      setDeleteTarget(null)
    } catch { toastError('Failed to delete task') }
    finally   { setDeleting(false) }
  }

  const tabCounts = { today: todayTasks.length, upcoming: upcomingTasks.length, completed: completedTasks.length }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Tasks</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {tasks.filter((t) => !t.completed).length === 0 ? 'All done! 🎉' : `${tasks.filter((t) => !t.completed).length} remaining`}
          </p>
        </div>
        <GlassButton variant="primary" onClick={openCreate}>
          <Plus size={14} />
          <span className="hidden sm:inline">Add Task</span>
          <span className="sm:hidden">Add</span>
        </GlassButton>
      </div>

      {/* Today progress bar */}
      {totalToday > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Today&apos;s progress</span>
            <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{completedToday} / {totalToday}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${totalToday > 0 ? (completedToday / totalToday) * 100 : 0}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {(['today', 'upcoming', 'completed'] as TabView[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all capitalize flex items-center gap-1.5',
              tab === t ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
            )}
            style={tab === t ? {} : { color: 'var(--text-muted)' }}
          >
            {t}
            {tabCounts[t] > 0 && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold',
                tab === t ? 'bg-indigo-500/25 text-indigo-200' : 'bg-black/[0.06]'
              )}
              style={tab === t ? {} : { color: 'var(--text-muted)' }}
              >
                {tabCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <SkeletonList lines={4} />
      ) : currentList.length === 0 ? (
        <EmptyState
          icon={tab === 'completed' ? '✅' : '📋'}
          title={tab === 'today' ? 'No tasks for today' : tab === 'upcoming' ? 'No upcoming tasks' : 'No completed tasks yet'}
          description={tab === 'today' ? 'Add a task to get started with your day.' : tab === 'upcoming' ? 'Schedule tasks with future due dates.' : undefined}
          action={tab !== 'completed' ? <GlassButton variant="primary" size="sm" onClick={openCreate}><Plus size={13} /> Add Task</GlassButton> : undefined}
        />
      ) : (
        <motion.div layout className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {currentList.map((task) => (
              <TaskItem key={task._id} task={task} toggling={toggling === task._id} onToggle={handleToggle} onEdit={openEdit} onDelete={(t) => setDeleteTarget(t)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Modal */}
      <Modal isOpen={isModalOpen} onClose={handleModalClose} title={editingTask ? 'Edit Task' : 'New Task'} size="md">
        <div className="flex flex-col gap-4">
          <GlassInput label="Task" placeholder="What needs to be done?" value={form.title} onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); if (!editingTask) draft.triggerAutosave() }} />
          <GlassTextarea label="Description (optional)" placeholder="Add more details…" rows={3} value={form.description} onChange={(e) => { setForm((f) => ({ ...f, description: e.target.value })); if (!editingTask) draft.triggerAutosave() }} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GlassInput label="Due Date" type="date" value={form.dueDate} onChange={(e) => { setForm((f) => ({ ...f, dueDate: e.target.value })); if (!editingTask) draft.triggerAutosave() }} />
            <GlassInput label="Due Time" type="time" value={form.dueTime} onChange={(e) => { setForm((f) => ({ ...f, dueTime: e.target.value })); if (!editingTask) draft.triggerAutosave() }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GlassSelect label="Priority" value={form.priority} onChange={(v) => { setForm((f) => ({ ...f, priority: v as TaskFormData['priority'] })); if (!editingTask) draft.triggerAutosave() }} options={[{ value: 'low', label: '🟢 Low' }, { value: 'medium', label: '🟡 Medium' }, { value: 'high', label: '🔴 High' }]} />
            <GlassSelect label="Recurring" value={form.recurring} onChange={(v) => { setForm((f) => ({ ...f, recurring: v as TaskFormData['recurring'] })); if (!editingTask) draft.triggerAutosave() }} options={[{ value: 'none', label: 'One-time' }, { value: 'daily', label: '🔁 Daily' }, { value: 'weekly', label: '📅 Weekly' }, { value: 'monthly', label: '🗓️ Monthly' }]} />
          </div>
          <div className="flex items-center justify-between pt-1">
            {!editingTask && <SaveDraftStatus status={draft.saveStatus} />}
            <div className="flex gap-2 ml-auto">
              {!editingTask && (
                <GlassButton variant="secondary" size="sm" onClick={() => draft.saveDraft()}>
                  Save Draft
                </GlassButton>
              )}
              <GlassButton variant="secondary" onClick={handleModalClose}>Cancel</GlassButton>
              <GlassButton variant="primary" onClick={handleSave} loading={saving}>{editingTask ? 'Save Changes' : 'Create Task'}</GlassButton>
            </div>
          </div>
        </div>
      </Modal>

      <UnsavedChangesDialog
        isOpen={showUnsaved}
        onContinueEditing={() => setShowUnsaved(false)}
        onSaveAsDraft={async () => { await draft.saveDraft(); setShowUnsaved(false); setIsModalOpen(false) }}
        onDiscard={() => { draft.deleteDraft(); setShowUnsaved(false); setIsModalOpen(false) }}
      />

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Task" message={`"${deleteTarget?.title}" will be permanently deleted.`} confirmLabel="Delete" danger loading={deleting} />
    </div>
  )
}

/* ── Task Item ─────────────────────────────────────────────────────────────── */
function TaskItem({ task, toggling, onToggle, onEdit, onDelete }: {
  task: Task; toggling: boolean
  onToggle: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const priority  = PRIORITY_CONFIG[task.priority]
  const isOverdue = task.dueDate && task.dueDate < getTodayString() && !task.completed

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, height: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('glass rounded-xl overflow-hidden group', task.completed && 'opacity-60', isOverdue && 'border-red-400/30')}
    >
      <div className="flex items-start gap-3 p-3.5">
        {/* Checkbox */}
        <motion.button
          onClick={() => onToggle(task)}
          disabled={toggling}
          whileTap={{ scale: 0.88 }}
          className={cn(
            'mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all duration-200',
            task.completed ? 'bg-indigo-500 border-indigo-500' : 'border-black/20 hover:border-indigo-400'
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {task.completed && (
              <motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                <Check size={11} className="text-white" strokeWidth={3} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn('text-sm font-medium leading-snug', task.completed && 'line-through')}
              style={{ color: task.completed ? 'var(--text-faint)' : 'var(--text-primary)' }}
            >
              {task.title}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {task.description && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
                  style={{ color: 'var(--text-faint)' }}
                >
                  {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
              <button
                onClick={() => onEdit(task)}
                className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
                style={{ color: 'var(--text-faint)' }}
              >
                <Edit3 size={11} />
              </button>
              <button
                onClick={() => onDelete(task)}
                className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors"
                style={{ color: 'var(--text-faint)' }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', priority.bg, priority.color)}>
              <Flag size={7} className="inline mr-0.5" />{priority.label}
            </span>
            {task.dueDate && (
              <span className={cn('flex items-center gap-1 text-[11px]', isOverdue ? 'text-red-500' : '')}
                style={!isOverdue ? { color: 'var(--text-faint)' } : {}}
              >
                <Calendar size={10} />{isOverdue ? 'Overdue · ' : ''}{formatDate(task.dueDate)}
              </span>
            )}
            {task.dueTime && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                <Clock size={10} />{task.dueTime}
              </span>
            )}
            {task.recurring !== 'none' && (
              <span className="flex items-center gap-1 text-[11px] text-indigo-500">
                <RefreshCw size={10} />{task.recurring}
              </span>
            )}
            {isOverdue && <AlertCircle size={10} className="text-red-500" />}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && task.description && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p
              className="px-3.5 pb-3.5 text-[12px] leading-relaxed pt-2.5 ml-8"
              style={{
                color: 'var(--text-secondary)',
                borderTop: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              {task.description}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
