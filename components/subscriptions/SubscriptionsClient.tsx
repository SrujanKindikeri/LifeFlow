'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { CreditCard, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, Clock } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import { formatPaise } from '@/lib/moneyCalculator'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'

interface Sub {
  _id: string
  serviceName: string
  amountMinor: number
  amount: number
  currency: string
  billingCycle: string
  nextBillingDate: string
  lastBillingDate?: string | null
  category: string
  paymentMethod?: string
  status: 'active' | 'paused' | 'cancelled'
  autoCreateExpense: boolean
  notes?: string
}

interface Summary { monthlyTotalMinor: number; yearlyTotalMinor: number; activeCount: number }

const CYCLES = [
  { value: 'weekly',    label: 'Weekly'    },
  { value: 'monthly',   label: 'Monthly'   },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly',    label: 'Yearly'    },
  { value: 'custom',    label: 'Custom'    },
]
const CATEGORIES = [
  'streaming','music','software','cloud','fitness','news','gaming','education','utilities','other',
].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))

const STATUSES = [
  { value: 'active',    label: 'Active'    },
  { value: 'paused',    label: 'Paused'    },
  { value: 'cancelled', label: 'Cancelled' },
]

const CYCLE_LABEL: Record<string, string> = {
  weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom',
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${
        checked ? 'bg-blue-500' : 'bg-gray-300'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ── Subscription form ─────────────────────────────────────────────────────────

function SubForm({
  initial,
  onSave,
  onClose,
  loading,
  onFormChange,
  draftIdParam,
}: {
  initial?: Partial<Sub>
  onSave: (d: Partial<Sub>) => void
  onClose: () => void
  loading: boolean
  onFormChange?: (d: Record<string, unknown>) => void
  draftIdParam?: string
}) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    serviceName:       initial?.serviceName       ?? '',
    amountExpr:        initial?.amount != null ? String(initial.amount) : '',
    currency:          initial?.currency          ?? 'INR',
    billingCycle:      initial?.billingCycle      ?? 'monthly',
    nextBillingDate:   initial?.nextBillingDate   ?? today,
    category:          initial?.category          ?? 'other',
    paymentMethod:     initial?.paymentMethod     ?? '',
    status:            initial?.status            ?? 'active',
    autoCreateExpense: initial?.autoCreateExpense ?? true,
    notes:             initial?.notes             ?? '',
  })

  const set = (k: string, v: unknown) => {
    const next = { ...form, [k]: v }
    setForm(next)
    onFormChange?.(next)
  }

  useEffect(() => {
    if (!draftIdParam || initial?._id) return
    fetch(`/api/drafts/${draftIdParam}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.draft?.data) {
          const data = d.draft.data as Partial<typeof form>
          const loaded = {
            serviceName:       data.serviceName       ?? '',
            amountExpr:        data.amountExpr        ?? '',
            currency:          data.currency          ?? 'INR',
            billingCycle:      data.billingCycle      ?? 'monthly',
            nextBillingDate:   data.nextBillingDate   ?? today,
            category:          data.category          ?? 'other',
            paymentMethod:     data.paymentMethod     ?? '',
            status:            data.status            ?? 'active',
            autoCreateExpense: data.autoCreateExpense ?? true,
            notes:             data.notes             ?? '',
          }
          setForm(loaded)
          onFormChange?.(loaded)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSave() {
    const parsed = parseAmountExpression(form.amountExpr)
    const amount = parsed.value ?? 0
    onSave({ ...form, amount })
  }
  return (
    <div className="flex flex-col gap-4">
      <GlassInput
        label="Service Name"
        value={form.serviceName}
        onChange={(e) => set('serviceName', e.target.value)}
        placeholder="e.g. Spotify, Netflix"
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <SmartAmountInput
          label="Amount"
          value={form.amountExpr}
          onChange={(raw) => set('amountExpr', raw)}
          currency={form.currency}
        />
        <GlassSelect
          label="Billing Cycle"
          value={form.billingCycle}
          onChange={(v) => set('billingCycle', v)}
          options={CYCLES}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <GlassInput
          label="Next Billing Date"
          type="date"
          value={form.nextBillingDate}
          onChange={(e) => set('nextBillingDate', e.target.value)}
        />
        <GlassSelect
          label="Category"
          value={form.category}
          onChange={(v) => set('category', v)}
          options={CATEGORIES}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <GlassInput
          label="Payment Method"
          value={form.paymentMethod ?? ''}
          onChange={(e) => set('paymentMethod', e.target.value)}
          placeholder="UPI, Card…"
        />
        <GlassSelect
          label="Status"
          value={form.status}
          onChange={(v) => set('status', v)}
          options={STATUSES}
        />
      </div>

      {/* Auto-add to Expenses toggle */}
      <div
        className="flex items-start gap-3 rounded-xl p-3"
        style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)' }}
      >
        <Toggle
          checked={form.autoCreateExpense}
          onChange={(v) => set('autoCreateExpense', v)}
          label="Auto-add to Expenses"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Auto-add to Expenses
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Automatically record this subscription as a Personal Expense when the billing date arrives.
          </p>
        </div>
      </div>

      <GlassTextarea
        label="Notes"
        value={form.notes ?? ''}
        onChange={(e) => set('notes', e.target.value)}
        rows={2}
      />

      <div className="flex gap-2.5 justify-end pt-1">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={handleSave}>
          {initial?._id ? 'Save Changes' : 'Add Subscription'}
        </GlassButton>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const daysUntil = (d: string) =>
  Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)

function cycleShortLabel(cycle: string): string {
  const map: Record<string, string> = {
    weekly: '/week', monthly: '/month', quarterly: '/quarter', yearly: '/year', custom: '/custom',
  }
  return map[cycle] ?? ''
}

// ── Main component ────────────────────────────────────────────────────────────

export function SubscriptionsClient() {
  const searchParams = useSearchParams()
  const draftIdParam = searchParams.get('draftId') ?? undefined
  const openNew      = searchParams.get('new') === '1'

  const { success, error: showError } = useToast()
  const [subs, setSubs]       = useState<Sub[]>([])
  const [summary, setSummary] = useState<Summary>({ monthlyTotalMinor: 0, yearlyTotalMinor: 0, activeCount: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [filter, setFilter]   = useState('active')
  const [modalOpen, setModalOpen]       = useState(false)
  const [editing, setEditing]           = useState<Sub | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Sub | null>(null)
  const [showUnsaved, setShowUnsaved]   = useState(false)
  const formDataRef = useRef<Record<string, unknown>>({})

  const draft = useDraft({
    type:     'subscription',
    initialDraftId: draftIdParam,
    getTitle: () => (formDataRef.current.serviceName as string) || 'Subscription Draft',
    getData:  () => ({ ...formDataRef.current }),
    hasMeaningfulData: () => Boolean((formDataRef.current.serviceName as string)?.trim()),
  })

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!openNew) return
    setEditing(null)
    setModalOpen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew])

  function handleModalClose() {
    if (!editing && draft.hasMeaningfulData()) {
      setShowUnsaved(true)
    } else {
      setModalOpen(false)
      setEditing(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = filter === 'all' ? '/api/subscriptions' : `/api/subscriptions?status=${filter}`
      const res  = await fetch(url)
      const data = await res.json()
      setSubs(data.subscriptions ?? [])
      setSummary(data.summary ?? { monthlyTotalMinor: 0, yearlyTotalMinor: 0, activeCount: 0 })
    } catch {
      showError('Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }, [filter, showError])

  useEffect(() => { void load() }, [load])

  async function save(form: Partial<Sub>) {
    if (!form.serviceName?.trim()) { showError('Service name required'); return }
    setSaving(true)
    try {
      const url    = editing ? `/api/subscriptions/${editing._id}` : '/api/subscriptions'
      const method = editing ? 'PATCH' : 'POST'
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      if (!editing) await draft.deleteDraft()
      success(editing ? 'Updated' : 'Subscription added')
      setModalOpen(false)
      setEditing(null)
      load()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function del() {
    if (!deleteTarget) return
    await fetch(`/api/subscriptions/${deleteTarget._id}`, { method: 'DELETE' })
    success('Deleted')
    setDeleteTarget(null)
    load()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Subscriptions
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Track recurring subscriptions · expenses auto-added on billing dates
          </p>
        </div>
        <GlassButton
          variant="primary"
          icon={<Plus size={15} />}
          onClick={() => { setEditing(null); setModalOpen(true) }}
        >
          Add
        </GlassButton>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Monthly Cost', value: formatPaise(summary.monthlyTotalMinor) },
          { label: 'Yearly Cost',  value: formatPaise(summary.yearlyTotalMinor)  },
          { label: 'Active',       value: String(summary.activeCount)            },
        ].map((s) => (
          <GlassCard key={s.label} padding="sm" className="text-center">
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
            <p className="text-xs mt-0.5"    style={{ color: 'var(--text-muted)'    }}>{s.label}</p>
          </GlassCard>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {['active', 'paused', 'cancelled', 'all'].map((f) => (
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

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass rounded-2xl h-20 animate-pulse"
              style={{ background: 'rgba(0,0,0,0.04)' }}
            />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <CreditCard size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
            No subscriptions yet
          </p>
          <GlassButton
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => { setEditing(null); setModalOpen(true) }}
          >
            Add Subscription
          </GlassButton>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {subs.map((s) => {
              const days   = daysUntil(s.nextBillingDate)
              const urgent = days <= 3 && s.status === 'active'
              // A billing date in the past means the expense was just created and
              // nextBillingDate has been advanced — show "Added to expenses".
              const justPaid = s.lastBillingDate != null && s.lastBillingDate < s.nextBillingDate

              return (
                <motion.div
                  key={s._id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <GlassCard padding="sm" className={urgent ? 'ring-1 ring-amber-400/30' : ''}>
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.15)' }}
                      >
                        <RefreshCw size={16} style={{ color: 'var(--accent)' }} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            {s.serviceName}
                          </p>
                          {s.status !== 'active' && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)' }}
                            >
                              {s.status}
                            </span>
                          )}
                          {/* Auto-add badge */}
                          {s.autoCreateExpense && s.status === 'active' && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5"
                              style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent)' }}
                              title="Auto-add to Expenses is ON"
                            >
                              <RefreshCw size={9} /> Auto
                            </span>
                          )}
                        </div>

                        {/* Next / last payment */}
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {justPaid && s.lastBillingDate && (
                            <p className="text-xs flex items-center gap-1" style={{ color: '#22c55e' }}>
                              <CheckCircle2 size={10} />
                              Last payment: {formatDate(s.lastBillingDate)}
                            </p>
                          )}
                          <p
                            className="text-xs flex items-center gap-1"
                            style={{ color: urgent ? '#f59e0b' : 'var(--text-muted)' }}
                          >
                            <Clock size={10} />
                            {CYCLE_LABEL[s.billingCycle]}{cycleShortLabel(s.billingCycle)}
                            {' · '}
                            {urgent
                              ? `Due in ${days} day${days !== 1 ? 's' : ''}`
                              : `Next payment: ${formatDate(s.nextBillingDate)}`
                            }
                          </p>
                        </div>
                      </div>

                      {/* Amount + actions */}
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {formatPaise(s.amountMinor, s.currency)}
                        </p>
                        <button
                          onClick={() => { setEditing(s); setModalOpen(true) }}
                          className="p-1.5 rounded-lg hover:bg-black/[0.05]"
                          style={{ color: 'var(--text-muted)' }}
                          aria-label={`Edit ${s.serviceName}`}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(s)}
                          className="p-1.5 rounded-lg hover:bg-red-50"
                          style={{ color: 'var(--danger)' }}
                          aria-label={`Delete ${s.serviceName}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={handleModalClose}
        title={editing ? 'Edit Subscription' : 'Add Subscription'}
        size="md"
      >
        <SubForm
          initial={editing ?? undefined}
          onSave={save}
          onClose={handleModalClose}
          loading={saving}
          onFormChange={(d) => {
            formDataRef.current = d
            if (!editing) draft.triggerAutosave()
          }}
          draftIdParam={!editing ? draftIdParam : undefined}
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

      {/* Unsaved changes dialog */}
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
        onConfirm={del}
        title="Delete Subscription"
        message={`Delete "${deleteTarget?.serviceName}"? This will not remove existing expenses.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}
