'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { PiggyBank, Plus, Pencil, Trash2, History } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import { formatPaise } from '@/lib/moneyCalculator'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'

interface SGoal {
  _id: string; title: string; targetAmountMinor: number; targetAmount: number
  savedMinor: number; saved: number; remainingMinor: number; remaining: number
  progressPct: number; currency: string; icon: string; color: string; targetDate?: string; notes?: string
}

interface Contribution {
  _id: string; amountMinor: number; amount: number; date: string; note?: string
}

const ICONS = ['🎯','💻','✈️','🏠','🚗','📱','🎓','💍','🏋️','🌴','🎨','🎵']

function GoalForm({ initial, onSave, onClose, loading, onFormChange, draftIdParam }: {
  initial?: Partial<SGoal>; onSave:(d:Partial<SGoal>)=>void; onClose:()=>void; loading:boolean
  onFormChange?: (d: Record<string, unknown>) => void
  draftIdParam?: string
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '', targetAmountExpr: initial?.targetAmount != null ? String(initial.targetAmount) : '',
    icon: initial?.icon ?? '🎯', color: initial?.color ?? '#3b82f6',
    targetDate: initial?.targetDate ?? '', notes: initial?.notes ?? '',
  })
  const set = (k: string, v: unknown) => { const next = { ...form, [k]: v }; setForm(next); onFormChange?.(next) }
  const COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#f97316']

  useEffect(() => {
    if (!draftIdParam || initial?._id) return
    fetch(`/api/drafts/${draftIdParam}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.draft?.data) {
          const data = d.draft.data as Partial<typeof form>
          const loaded = { title: data.title ?? '', targetAmountExpr: data.targetAmountExpr ?? '', icon: data.icon ?? '🎯', color: data.color ?? '#3b82f6', targetDate: data.targetDate ?? '', notes: data.notes ?? '' }
          setForm(loaded); onFormChange?.(loaded)
        }
      }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSave() {
    const parsed = parseAmountExpression(form.targetAmountExpr)
    const targetAmount = parsed.value
    onSave({ ...form, targetAmount: targetAmount ?? 0 })
  }

  return (
    <div className="flex flex-col gap-4">
      <GlassInput label="Goal Title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Laptop Fund" required />
      <SmartAmountInput
        label="Target Amount"
        value={form.targetAmountExpr}
        onChange={(raw) => set('targetAmountExpr', raw)}
        currency="INR"
      />
      <GlassInput label="Target Date" type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Icon</p>
        <div className="flex gap-1.5 flex-wrap">
          {ICONS.map((ic) => (
            <button key={ic} onClick={() => set('icon', ic)}
              className={`w-9 h-9 rounded-xl text-lg transition-all hover:scale-110 ${form.icon===ic ? 'ring-2 ring-blue-400' : ''}`}
              style={{ background: form.icon===ic ? 'rgba(59,130,246,0.12)' : 'rgba(0,0,0,0.04)' }}>
              {ic}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Color</p>
        <div className="flex gap-2">
          {COLORS.map((c) => <button key={c} onClick={() => set('color', c)} className="w-7 h-7 rounded-full hover:scale-110 transition-transform" style={{ background: c, outline: form.color===c ? `3px solid ${c}` : 'none', outlineOffset: 2 }} />)}
        </div>
      </div>
      <GlassTextarea label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
      <div className="flex gap-2.5 justify-end">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={handleSave}>
          {initial?._id ? 'Save' : 'Create Goal'}
        </GlassButton>
      </div>
    </div>
  )
}

function ContributionModal({ goal, onAdded }: { goal: SGoal; onClose: ()=>void; onAdded:()=>void }) {
  const { success, error: showError } = useToast()
  const today = new Date().toISOString().split('T')[0]
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [contribs, setContribs] = useState<Contribution[]>([])
  const [delTarget, setDelTarget] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/savings-goals/${goal._id}/contributions`).then(r=>r.json()).then(d=>setContribs(d.contributions??[]))
  }, [goal._id])

  async function add() {
    const parsed = parseAmountExpression(amount)
    const numericAmount = parsed.value
    if (!numericAmount || numericAmount <= 0) { showError('Amount must be > 0'); return }
    setAdding(true)
    try {
      const res = await fetch(`/api/savings-goals/${goal._id}/contributions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numericAmount, date, note }),
      })
      if (!res.ok) throw new Error()
      success('Contribution added'); setAmount(''); setNote('')
      const d = await res.json()
      setContribs((p) => [d.contribution, ...p])
      onAdded()
    } catch { showError('Failed') }
    finally { setAdding(false) }
  }

  async function del(id: string) {
    await fetch(`/api/savings-goals/${goal._id}/contributions/${id}`, { method: 'DELETE' })
    setContribs((p) => p.filter((c) => c._id !== id))
    setDelTarget(null); onAdded()
    success('Contribution removed')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{goal.icon}</span>
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{goal.title}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Saved: {formatPaise(goal.savedMinor)} of {formatPaise(goal.targetAmountMinor)}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SmartAmountInput label="Amount" value={amount} onChange={(raw) => setAmount(raw)} currency="INR" />
        <GlassInput label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <GlassInput label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      <GlassButton variant="primary" loading={adding} onClick={add} icon={<Plus size={13} />}>Add Contribution</GlassButton>

      {contribs.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>History</p>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {contribs.map((c) => (
              <div key={c._id} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)' }}>
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatPaise(c.amountMinor)}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{formatDate(c.date)}</span>
                  {c.note && <span className="text-xs ml-2" style={{ color: 'var(--text-faint)' }}>{c.note}</span>}
                </div>
                <button onClick={() => setDelTarget(c._id)} className="p-1 rounded-lg hover:bg-red-50" style={{ color: 'var(--danger)' }}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog isOpen={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={() => del(delTarget!)} title="Remove Contribution" message="Remove this contribution? This cannot be undone." confirmLabel="Remove" danger />
    </div>
  )
}

export function SavingsClient() {
  const searchParams  = useSearchParams()
  const draftIdParam  = searchParams.get('draftId') ?? undefined
  const openNew       = searchParams.get('new') === '1'
  const { success, error: showError } = useToast()
  const [goals, setGoals] = useState<SGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SGoal | null>(null)
  const [contribTarget, setContribTarget] = useState<SGoal | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SGoal | null>(null)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const formDataRef = useRef<Record<string, unknown>>({})

  const draft = useDraft({
    type: 'savingsGoal',
    initialDraftId: draftIdParam,
    getTitle:  () => (formDataRef.current.title as string) || 'Savings Goal Draft',
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
      const res = await fetch('/api/savings-goals')
      const data = await res.json()
      setGoals(data.goals ?? [])
    } catch { showError('Failed to load') }
    finally { setLoading(false) }
  }, [showError])

  useEffect(() => { void load() }, [load])

  async function save(form: Partial<SGoal>) {
    if (!form.title?.trim()) { showError('Title required'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/savings-goals/${editing._id}` : '/api/savings-goals'
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      if (!editing) await draft.deleteDraft()
      success(editing ? 'Updated' : 'Goal created')
      setModalOpen(false); setEditing(null); load()
    } catch (e) { showError(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function del() {
    if (!deleteTarget) return
    await fetch(`/api/savings-goals/${deleteTarget._id}`, { method: 'DELETE' })
    success('Deleted'); setDeleteTarget(null); load()
  }

  const totalSaved = goals.reduce((s, g) => s + g.savedMinor, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Savings Goals</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Save towards specific targets</p>
        </div>
        <GlassButton variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setModalOpen(true) }}>New Goal</GlassButton>
      </div>

      {goals.length > 0 && (
        <GlassCard padding="sm" className="flex items-center gap-4">
          <PiggyBank size={24} style={{ color: 'var(--accent)' }} />
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{formatPaise(totalSaved)} saved</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>across {goals.length} goal{goals.length !== 1 ? 's' : ''}</p>
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-4">{[1,2].map((i)=><div key={i} className="glass rounded-2xl h-40 animate-pulse" style={{background:'rgba(0,0,0,0.04)'}}/>)}</div>
      ) : goals.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <PiggyBank size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No savings goals yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Create a goal and start saving towards it.</p>
          <GlassButton variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => { setEditing(null); setModalOpen(true) }}>Create Goal</GlassButton>
        </GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <AnimatePresence>
            {goals.map((g) => (
              <motion.div key={g._id} layout initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
                <GlassCard padding="md" className="flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{g.icon}</span>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{g.title}</p>
                        {g.targetDate && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Target: {formatDate(g.targetDate)}</p>}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <button onClick={() => setContribTarget(g)} className="p-1.5 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--accent)' }} title="Add contribution"><History size={12}/></button>
                      <button onClick={() => { setEditing(g); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--text-muted)' }}><Pencil size={12}/></button>
                      <button onClick={() => setDeleteTarget(g)} className="p-1.5 rounded-lg hover:bg-red-50" style={{ color: 'var(--danger)' }}><Trash2 size={12}/></button>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      <span>{formatPaise(g.savedMinor)} saved</span>
                      <span className="font-semibold" style={{ color: g.progressPct >= 100 ? 'var(--success-text)' : 'var(--accent-text)' }}>{g.progressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <motion.div className="h-full rounded-full" style={{ background: g.color }} initial={{ width: 0 }} animate={{ width: `${g.progressPct}%` }} transition={{ duration: 0.6 }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
                      <span>Remaining: {formatPaise(g.remainingMinor)}</span>
                      <span>Target: {formatPaise(g.targetAmountMinor)}</span>
                    </div>
                  </div>

                  <GlassButton variant="ghost" size="xs" icon={<Plus size={11} />} onClick={() => setContribTarget(g)}>Add Contribution</GlassButton>
                </GlassCard>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={handleModalClose} title={editing ? 'Edit Goal' : 'New Savings Goal'} size="md">
        <GoalForm
          initial={editing ?? undefined} onSave={save} onClose={handleModalClose} loading={saving}
          onFormChange={(d) => { formDataRef.current = d; if (!editing) draft.triggerAutosave() }}
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

      {contribTarget && (
        <Modal isOpen={true} onClose={() => setContribTarget(null)} title="Contributions" size="md">
          <ContributionModal goal={contribTarget} onClose={() => setContribTarget(null)} onAdded={load} />
        </Modal>
      )}

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={del} title="Delete Savings Goal" message={`Delete "${deleteTarget?.title}"? All contributions will also be removed.`} confirmLabel="Delete" danger />
    </div>
  )
}

