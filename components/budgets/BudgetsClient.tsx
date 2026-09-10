'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart2, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { EXPENSE_CATEGORIES } from '@/lib/utils'
import { formatPaise } from '@/lib/moneyCalculator'

interface Budget {
  _id: string; category: string; amountMinor: number; amount: number; currency: string
  month: string; status: 'active'|'paused'; spentMinor: number; spent: number
  remainingMinor: number; remaining: number; pct: number; overBudget: boolean; overAmount: number
}

const CAT_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` }))

function BudgetForm({ initial, onSave, onClose, loading }: {
  initial?: Partial<Budget>; onSave:(d:Record<string,unknown>)=>void; onClose:()=>void; loading:boolean
}) {
  const currentMonth = new Date().toISOString().slice(0,7)
  const [form, setForm] = useState({
    category: initial?.category ?? 'food',
    amount: initial?.amount ?? 0,
    month: initial?.month ?? currentMonth,
    currency: initial?.currency ?? 'INR',
  })
  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }))
  return (
    <div className="flex flex-col gap-4">
      <GlassSelect label="Category" value={form.category} onChange={(v) => set('category', v)} options={CAT_OPTIONS} />
      <div className="grid grid-cols-2 gap-3">
        <GlassInput label="Budget (₹)" type="number" min={1} value={form.amount || ''} onChange={(e) => set('amount', Number(e.target.value))} />
        <GlassInput label="Month" type="month" value={form.month} onChange={(e) => set('month', e.target.value)} />
      </div>
      <div className="flex gap-2.5 justify-end">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={() => onSave(form)}>
          {initial?._id ? 'Update Budget' : 'Set Budget'}
        </GlassButton>
      </div>
    </div>
  )
}

export function BudgetsClient() {
  const { success, error: showError } = useToast()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Budget | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/budgets?month=${month}`)
      const data = await res.json()
      setBudgets(data.budgets ?? [])
    } catch { showError('Failed to load budgets') }
    finally { setLoading(false) }
  }, [month, showError])

  useEffect(() => { void load() }, [load])

  async function save(form: Record<string, unknown>) {
    if (!form.amount || Number(form.amount) <= 0) { showError('Amount required'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/budgets/${editing._id}` : '/api/budgets'
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      success(editing ? 'Budget updated' : 'Budget set')
      setModalOpen(false); setEditing(null); load()
    } catch (e) { showError(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function togglePause(b: Budget) {
    await fetch(`/api/budgets/${b._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: b.status === 'active' ? 'paused' : 'active' }) })
    load()
  }

  async function del() {
    if (!deleteTarget) return
    await fetch(`/api/budgets/${deleteTarget._id}`, { method: 'DELETE' })
    success('Budget deleted'); setDeleteTarget(null); load()
  }

  const overCount = budgets.filter((b) => b.overBudget).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Budgets</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Monthly spending limits by category</p>
        </div>
        <GlassButton variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setModalOpen(true) }}>Set Budget</GlassButton>
      </div>

      {/* Month selector */}
      <GlassCard padding="sm" className="flex items-center gap-3 w-fit">
        <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="glass-input rounded-xl text-sm px-3 py-1.5 min-w-0" />
      </GlassCard>

      {overCount > 0 && (
        <GlassCard padding="sm" className="flex items-center gap-3" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
          <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <p className="text-sm" style={{ color: 'var(--danger-text)' }}>
            {overCount} categor{overCount===1?'y':'ies'} over budget this month.
          </p>
        </GlassCard>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">{[1,2,3].map((i)=><div key={i} className="glass rounded-2xl h-24 animate-pulse" style={{background:'rgba(0,0,0,0.04)'}}/>)}</div>
      ) : budgets.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <BarChart2 size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No budgets set for {month}</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Set spending limits per category.</p>
          <GlassButton variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => { setEditing(null); setModalOpen(true) }}>Set Budget</GlassButton>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {budgets.map((b) => {
              const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === b.category)
              return (
                <motion.div key={b._id} layout initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
                  <GlassCard padding="md" className={b.overBudget ? 'ring-1 ring-red-400/30' : ''}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">{catInfo?.emoji ?? '📦'}</span>
                        <div>
                          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{catInfo?.label ?? b.category}</p>
                          {b.status === 'paused' && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)' }}>Paused</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditing(b); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--text-muted)' }}><Pencil size={12}/></button>
                        <button onClick={() => togglePause(b)} className="p-1.5 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--text-faint)' }}>
                          {b.status==='active' ? '⏸' : '▶'}
                        </button>
                        <button onClick={() => setDeleteTarget(b)} className="p-1.5 rounded-lg hover:bg-red-50" style={{ color: 'var(--danger)' }}><Trash2 size={12}/></button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        <span>Spent: {formatPaise(b.spentMinor)}</span>
                        {b.overBudget
                          ? <span className="font-semibold" style={{ color: 'var(--danger-text)' }}>Over by {formatPaise(b.overAmount * 100)}</span>
                          : <span className="font-semibold" style={{ color: 'var(--accent-text)' }}>{b.pct}%</span>}
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${Math.min(100, b.pct)}%`,
                          background: b.overBudget ? '#dc2626' : b.pct > 80 ? '#f59e0b' : '#3b82f6',
                        }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
                        <span>Remaining: {b.overBudget ? '—' : formatPaise(b.remainingMinor)}</span>
                        <span>Budget: {formatPaise(b.amountMinor)}</span>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setEditing(null) }} title={editing ? 'Edit Budget' : 'Set Budget'} size="sm">
        <BudgetForm initial={editing ?? undefined} onSave={save} onClose={() => { setModalOpen(false); setEditing(null) }} loading={saving} />
      </Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={del} title="Delete Budget" message={`Remove the ${deleteTarget?.category} budget for ${deleteTarget?.month}?`} confirmLabel="Delete" danger />
    </div>
  )
}
