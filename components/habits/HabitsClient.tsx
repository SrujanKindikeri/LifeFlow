'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Flame, Edit3, Trash2, Check, Target, ChevronLeft, ChevronRight } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, SkeletonCard } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { cn, HABIT_ICONS, getTodayString } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'
import type { Habit, HabitLog } from '@/types'

interface HabitWithStreak extends Habit {
  streak: number; bestStreak: number; completedToday: boolean; completionRate: number
}
interface HabitFormData {
  name: string; icon: string; description: string; frequency: 'daily' | 'weekly'; target: number
}
const defaultForm: HabitFormData = { name: '', icon: '⭐', description: '', frequency: 'daily', target: 1 }

function enrichHabits(rawHabits: Habit[], rawLogs: HabitLog[], today: string): HabitWithStreak[] {
  return rawHabits.map((h) => {
    const habitLogs  = rawLogs.filter((l) => l.habitId === h._id && l.completed)
    const logDates   = new Set(habitLogs.map((l) => l.date))
    const completedToday = logDates.has(today)
    let streak = 0
    const cd = new Date(today)
    while (true) {
      const ds = cd.toISOString().split('T')[0]
      if (logDates.has(ds)) { streak++; cd.setDate(cd.getDate() - 1) } else break
    }
    let c30 = 0
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      if (logDates.has(d.toISOString().split('T')[0])) c30++
    }
    const completionRate = Math.round((c30 / 30) * 100)
    const allDates = Array.from(logDates).sort()
    let best = 0, cur = 0
    for (let i = 0; i < allDates.length; i++) {
      if (i === 0) { cur = 1; continue }
      const prev = new Date(allDates[i - 1]); prev.setDate(prev.getDate() + 1)
      if (prev.toISOString().split('T')[0] === allDates[i]) cur++
      else cur = 1
      best = Math.max(best, cur)
    }
    return { ...h, streak, bestStreak: Math.max(best, streak), completedToday, completionRate }
  })
}

export function HabitsClient() {
  const searchParams   = useSearchParams()
  const draftIdParam   = searchParams.get('draftId') ?? undefined
  const openNew        = searchParams.get('new') === '1'
  const [habits,       setHabits]       = useState<HabitWithStreak[]>([])
  const [logs,         setLogs]         = useState<HabitLog[]>([])
  const [loading,      setLoading]      = useState(true)
  const [isModalOpen,  setIsModalOpen]  = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [toggling,     setToggling]     = useState<string | null>(null)
  const [form,         setForm]         = useState<HabitFormData>(defaultForm)
  const [showUnsaved,  setShowUnsaved]  = useState(false)
  const formRef = useRef<HabitFormData>(form)
  useEffect(() => { formRef.current = form }, [form])
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }
  })
  const { success, error: toastError } = useToast()
  const today = getTodayString()

  const draft = useDraft({
    type: 'habit',
    initialDraftId: draftIdParam,
    getTitle:  () => formRef.current.name || 'Habit Draft',
    getData:   () => ({ ...formRef.current }),
    hasMeaningfulData: () => Boolean(formRef.current.name.trim()),
  })

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!openNew) return
    if (draftIdParam) {
      fetch(`/api/drafts/${draftIdParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.draft?.data) {
            const data = d.draft.data as Partial<HabitFormData>
            setForm({ name: data.name ?? '', icon: data.icon ?? '⭐', description: data.description ?? '', frequency: (data.frequency ?? 'daily') as HabitFormData['frequency'], target: data.target ?? 1 })
          }
          setEditingHabit(null); setIsModalOpen(true)
        })
        .catch(() => { setEditingHabit(null); setForm(defaultForm); setIsModalOpen(true) })
    } else {
      setEditingHabit(null); setForm(defaultForm); setIsModalOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew])

  const fetchData = useCallback(async () => {
    try {
      const [hr, lr] = await Promise.all([fetch('/api/habits'), fetch('/api/habits/log?range=30')])
      const hd = await hr.json(); const ld = await lr.json()
      const rawHabits: Habit[]    = hd.habits ?? []
      const rawLogs:   HabitLog[] = ld.logs   ?? []
      setLogs(rawLogs)
      setHabits(enrichHabits(rawHabits, rawLogs, getTodayString()))
    } catch { toastError('Failed to load habits') }
    finally  { setLoading(false) }
  }, [toastError])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchData() }, [fetchData])

  function openCreate() { setEditingHabit(null); setForm(defaultForm); setIsModalOpen(true) }
  function openEdit(habit: Habit) {
    setEditingHabit(habit)
    setForm({ name: habit.name, icon: habit.icon, description: habit.description ?? '', frequency: habit.frequency, target: habit.target })
    setIsModalOpen(true)
  }

  function handleModalClose() {
    if (!editingHabit && draft.hasMeaningfulData()) { setShowUnsaved(true) } else { setIsModalOpen(false) }
  }

  async function handleSave() {
    if (!form.name.trim()) { toastError('Name is required'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), icon: form.icon, description: form.description.trim() || undefined, frequency: form.frequency, target: form.target }
      if (editingHabit) {
        const res = await fetch(`/api/habits/${editingHabit._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) throw new Error()
      } else {
        const res = await fetch('/api/habits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) throw new Error()
        await draft.deleteDraft()
      }
      await fetchData()
      success(editingHabit ? 'Habit updated' : 'Habit created')
      setIsModalOpen(false)
    } catch { toastError('Failed to save habit') }
    finally   { setSaving(false) }
  }

  async function handleToggle(habit: HabitWithStreak) {
    setToggling(habit._id)
    try {
      const res = await fetch('/api/habits/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ habitId: habit._id, completed: !habit.completedToday, date: today }) })
      if (!res.ok) throw new Error()
      await fetchData()
    } catch { toastError('Failed to update habit') }
    finally   { setToggling(null) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/habits/${deleteTarget._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      await fetchData()
      success('Habit deleted'); setDeleteTarget(null)
    } catch { toastError('Failed to delete habit') }
    finally   { setDeleting(false) }
  }

  const { year, month } = calendarMonth
  const daysInMonth    = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const monthStr       = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthName      = new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const completedToday = habits.filter((h) => h.completedToday).length

  function prevMonth() {
    setCalendarMonth((m) => { const d = new Date(m.year, m.month - 1); return { year: d.getFullYear(), month: d.getMonth() } })
  }
  function nextMonth() {
    setCalendarMonth((m) => { const d = new Date(m.year, m.month + 1); return { year: d.getFullYear(), month: d.getMonth() } })
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Habits</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{completedToday}/{habits.length} done today</p>
        </div>
        <GlassButton variant="primary" onClick={openCreate}>
          <Plus size={14} /><span className="hidden sm:inline">New Habit</span><span className="sm:hidden">New</span>
        </GlassButton>
      </div>

      {/* Stats */}
      {habits.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Best streak',  value: habits.reduce((m, h) => Math.max(m, h.streak), 0), unit: 'days',  icon: <Flame size={14} className="text-orange-500 mx-auto mt-1" /> },
            { label: 'Today',        value: completedToday, unit: `/ ${habits.length}`,           icon: <Check  size={14} className="text-emerald-500 mx-auto mt-1" /> },
            { label: '30-day avg',   value: habits.length > 0 ? Math.round(habits.reduce((s, h) => s + h.completionRate, 0) / habits.length) : 0, unit: '%', icon: <Target size={14} className="text-indigo-500 mx-auto mt-1" /> },
          ].map(({ label, value, unit, icon }) => (
            <div key={label} className="glass rounded-2xl p-4 text-center">
              <div className="text-[22px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {value}
                <span className="text-[13px] font-normal ml-0.5" style={{ color: 'var(--text-muted)' }}>{unit}</span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
              {icon}
            </div>
          ))}
        </div>
      )}

      {/* Habit list */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : habits.length === 0 ? (
        <EmptyState icon="🔥" title="No habits yet" description="Build positive routines by tracking your daily habits."
          action={<GlassButton variant="primary" size="sm" onClick={openCreate}><Plus size={13} /> Create Habit</GlassButton>}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          <AnimatePresence mode="popLayout">
            {habits.map((habit) => (
              <HabitCard key={habit._id} habit={habit} toggling={toggling === habit._id} onToggle={handleToggle} onEdit={openEdit} onDelete={(h) => setDeleteTarget(h)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Calendar heatmap */}
      {habits.length > 0 && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{monthName}</h2>
            <div className="flex gap-1">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs min-w-[400px]">
              <thead>
                <tr>
                  <th className="text-left font-medium pb-2 pr-3 min-w-[90px] text-[11px]" style={{ color: 'var(--text-faint)' }}>Habit</th>
                  {['S','M','T','W','T','F','S'].map((d, i) => (
                    <th key={i} className="text-center font-medium pb-2 w-7 text-[11px]" style={{ color: 'var(--text-faint)' }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {habits.slice(0, 5).map((habit) => {
                  const habitLogs = logs.filter((l) => l.habitId === habit._id && l.completed && l.date.startsWith(monthStr))
                  const logDates  = new Set(habitLogs.map((l) => l.date))
                  return (
                    <tr key={habit._id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                      <td className="py-2 pr-3 truncate max-w-[90px] text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {habit.icon} {habit.name}
                      </td>
                      {Array.from({ length: firstDayOfWeek }).map((_, i) => <td key={`pre-${i}`} />)}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day     = i + 1
                        const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
                        const done    = logDates.has(dateStr)
                        const isToday = dateStr === today
                        const isFuture= dateStr > today
                        return (
                          <td key={day} className="py-1.5">
                            <div className={cn(
                              'w-6 h-6 rounded-full mx-auto flex items-center justify-center text-[9px] font-medium transition-all',
                              done    ? 'bg-indigo-500 text-white shadow-[0_2px_8px_rgba(99,102,241,0.30)]' :
                              isFuture? 'text-[11px]' :
                                        'text-[11px]',
                              isToday && !done && 'ring-1 ring-indigo-400'
                            )}
                            style={{
                              background: done ? undefined : isFuture ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.05)',
                              color: done ? undefined : isFuture ? 'var(--text-faint)' : 'var(--text-muted)',
                            }}
                            >
                              {done ? '✓' : day}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-4">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-indigo-500" />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full ring-1 ring-indigo-400" style={{ background: 'rgba(0,0,0,0.05)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Today</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: 'rgba(0,0,0,0.05)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Missed</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      <Modal isOpen={isModalOpen} onClose={handleModalClose} title={editingHabit ? 'Edit Habit' : 'New Habit'} size="md">
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: 'var(--text-muted)' }}>Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {HABIT_ICONS.map((icon) => (
                <button key={icon} onClick={() => { setForm((f) => ({ ...f, icon })); if (!editingHabit) draft.triggerAutosave() }}
                  className={cn('w-9 h-9 rounded-xl text-lg transition-all hover:scale-110', form.icon === icon ? 'bg-indigo-500/15 ring-1 ring-indigo-500/45' : 'hover:bg-black/[0.05]')}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <GlassInput label="Habit Name" placeholder="e.g. Drink 8 glasses of water" value={form.name} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); if (!editingHabit) draft.triggerAutosave() }} />
          <GlassTextarea label="Description (optional)" placeholder="Why is this habit important?" rows={2} value={form.description} onChange={(e) => { setForm((f) => ({ ...f, description: e.target.value })); if (!editingHabit) draft.triggerAutosave() }} />
          <div className="grid grid-cols-2 gap-3">
            <GlassSelect label="Frequency" value={form.frequency} onChange={(v) => { setForm((f) => ({ ...f, frequency: v as 'daily' | 'weekly' })); if (!editingHabit) draft.triggerAutosave() }} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} />
            <GlassInput label="Daily Target" type="number" min={1} max={100} value={String(form.target)} onChange={(e) => { setForm((f) => ({ ...f, target: parseInt(e.target.value) || 1 })); if (!editingHabit) draft.triggerAutosave() }} />
          </div>
          <div className="flex items-center justify-between pt-1">
            {!editingHabit && <SaveDraftStatus status={draft.saveStatus} />}
            <div className="flex gap-2 ml-auto">
              {!editingHabit && <GlassButton variant="secondary" size="sm" onClick={() => draft.saveDraft()}>Save Draft</GlassButton>}
              <GlassButton variant="secondary" onClick={handleModalClose}>Cancel</GlassButton>
              <GlassButton variant="primary" onClick={handleSave} loading={saving}>{editingHabit ? 'Save Changes' : 'Create Habit'}</GlassButton>
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

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Habit" message={`"${deleteTarget?.name}" and all its history will be permanently deleted.`} confirmLabel="Delete" danger loading={deleting} />
    </div>
  )
}

/* ── Habit Card ─────────────────────────────────────────────────────────────── */
function HabitCard({ habit, toggling, onToggle, onEdit, onDelete }: {
  habit: HabitWithStreak; toggling: boolean
  onToggle: (h: HabitWithStreak) => void; onEdit: (h: Habit) => void; onDelete: (h: Habit) => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'glass rounded-2xl p-4 flex items-center gap-4 group transition-all',
        habit.completedToday && 'border-indigo-500/18 bg-indigo-500/[0.035]'
      )}
    >
      {/* Icon */}
      <div className={cn(
        'w-11 h-11 rounded-xl flex items-center justify-center text-[20px] flex-shrink-0 transition-all',
        habit.completedToday ? 'bg-indigo-500/15' : ''
      )}
      style={!habit.completedToday ? { background: 'rgba(0,0,0,0.05)' } : {}}
      >
        {habit.icon}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[13px] font-semibold"
            style={{ color: habit.completedToday ? 'var(--accent-text)' : 'var(--text-primary)' }}
          >
            {habit.name}
          </span>
          {habit.streak > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-orange-500 font-semibold">
              <Flame size={10} />{habit.streak}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-20 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
              <div
                className="h-full bg-indigo-500/70 rounded-full transition-all duration-500"
                style={{ width: `${habit.completionRate}%` }}
              />
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{habit.completionRate}%</span>
          </div>
          <span className="text-[10px] capitalize" style={{ color: 'var(--text-faint)' }}>{habit.frequency}</span>
        </div>
      </div>

      {/* Actions + toggle */}
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(habit)}
            className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
            style={{ color: 'var(--text-faint)' }}
          >
            <Edit3 size={12} />
          </button>
          <button
            onClick={() => onDelete(habit)}
            className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors"
            style={{ color: 'var(--text-faint)' }}
          >
            <Trash2 size={12} />
          </button>
        </div>

        <motion.button
          onClick={() => onToggle(habit)}
          disabled={toggling}
          whileTap={{ scale: 0.88 }}
          className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
            habit.completedToday
              ? 'bg-indigo-500 text-white shadow-[0_4px_14px_rgba(99,102,241,0.30)]'
              : 'glass hover:bg-black/[0.06]'
          )}
          style={!habit.completedToday ? { color: 'var(--text-muted)' } : {}}
        >
          {toggling ? (
            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Check size={16} strokeWidth={habit.completedToday ? 3 : 1.5} />
          )}
        </motion.button>
      </div>
    </motion.div>
  )
}
