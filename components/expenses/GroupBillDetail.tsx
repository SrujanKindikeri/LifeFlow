'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Edit2, Wallet, Users, Receipt, CheckCircle2 } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { cn, formatDate, EXPENSE_CATEGORIES } from '@/lib/utils'
import { calculateBill, type BillCalculationResult } from '@/lib/billCalculator'
import { type GroupBillData, formatMoney } from './types'
import { PersonDetailModal } from './PersonDetailModal'
import { SettlementPanel } from './SettlementPanel'

interface GroupBillDetailProps {
  bill: GroupBillData
  onBack: () => void
  onEdit: () => void
  onUpdate: (updatedBill: GroupBillData) => Promise<void>
  onMarkSettled: (fromPerson: string, toPerson: string) => Promise<void>
}

type Tab = 'split' | 'settlements'

export function GroupBillDetail({
  bill,
  onBack,
  onEdit,
  onUpdate,
  onMarkSettled,
}: GroupBillDetailProps) {
  const [tab, setTab] = useState<Tab>('split')
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [showSaveExpense, setShowSaveExpense] = useState(false)
  const { success: toastSuccess, error: toastError } = useToast()

  const calcResult = useMemo<BillCalculationResult>(
    () =>
      calculateBill(
        bill.people,
        bill.items,
        {
          discountType: bill.discountType,
          discountValue: bill.discountValue,
          taxType: bill.taxType,
          taxValue: bill.taxValue,
          serviceChargeType: bill.serviceChargeType,
          serviceChargeValue: bill.serviceChargeValue,
          tipType: bill.tipType,
          tipValue: bill.tipValue,
        },
        bill.splitMode,
        bill.customSplits
      ),
    [bill]
  )

  const selectedShare =
    calcResult.personShares.find((ps) => ps.personId === selectedPersonId) ?? null

  function handleBillUpdate(updatedBill: GroupBillData) {
    onUpdate(updatedBill).catch(() => toastError('Failed to update'))
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <GlassButton variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft size={15} />
        </GlassButton>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {bill.name}
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatDate(bill.date)} · {bill.people.length} people
          </p>
        </div>
        <GlassButton variant="secondary" size="sm" onClick={onEdit}>
          <Edit2 size={13} />
        </GlassButton>
      </div>

      {/* Total hero */}
      <GlassCard padding="md" level="elevated" catchlight className="text-center">
        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total Group Bill</p>
        <p className="text-2xl font-bold gradient-text">{formatMoney(bill.total, bill.currency)}</p>
        <div className="flex justify-center gap-4 mt-2 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          {bill.subtotal !== bill.total && (
            <span>Subtotal {formatMoney(bill.subtotal, bill.currency)}</span>
          )}
          {bill.taxAmount > 0 && (
            <span>Tax +{formatMoney(bill.taxAmount, bill.currency)}</span>
          )}
          {bill.discountAmount > 0 && (
            <span>Disc −{formatMoney(bill.discountAmount, bill.currency)}</span>
          )}
          {bill.tipAmount > 0 && (
            <span>Tip +{formatMoney(bill.tipAmount, bill.currency)}</span>
          )}
        </div>
      </GlassCard>

      {/* ── Add to Personal Spending CTA ── */}
      {!bill.savedAsExpense ? (
        <GlassButton
          variant="secondary"
          fullWidth
          onClick={() => setShowSaveExpense(true)}
          className="gap-2 justify-center"
        >
          <Wallet size={15} className="text-emerald-500" />
          <span>Add my share to Personal Spending</span>
        </GlassButton>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5 glass-elevated rounded-xl border border-emerald-500/20">
          <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm text-emerald-600 font-medium">Added to Personal Spending</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Your share is tracked in your personal expenses.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 glass-elevated rounded-xl p-1" style={{ boxShadow: 'inset 0 1px 0 var(--glass-catchlight)' }}>
        {([
          { key: 'split',       label: 'Split',       icon: <Users   size={14} /> },
          { key: 'settlements', label: 'Settlements', icon: <Receipt size={14} /> },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              tab === t.key
                ? 'glass-segment-active'
                : 'nav-hover'
            )}
            style={tab === t.key
              ? { color: 'var(--accent-text)' }
              : { color: 'var(--text-muted)' }
            }
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'split' && (
        <SplitTab
          calcResult={calcResult}
          bill={bill}
          onSelectPerson={setSelectedPersonId}
        />
      )}
      {tab === 'settlements' && (
        <SettlementPanel
          bill={bill}
          onUpdate={handleBillUpdate}
          onMarkSettled={onMarkSettled}
        />
      )}

      {/* Person detail modal */}
      <PersonDetailModal
        isOpen={!!selectedPersonId}
        onClose={() => setSelectedPersonId(null)}
        personShare={selectedShare}
        bill={bill}
      />

      {/* Save as personal expense modal */}
      <SaveExpenseModal
        isOpen={showSaveExpense}
        onClose={() => setShowSaveExpense(false)}
        bill={bill}
        calcResult={calcResult}
        onSave={async (personId, category) => {
          try {
            const res = await fetch(`/api/group-bills/${bill._id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'saveAsExpense',
                yourPersonId: personId,
                category,
              }),
            })
            if (!res.ok) {
              const data = await res.json()
              throw new Error(data.error ?? 'Failed')
            }
            const data = await res.json()
            await onUpdate(data.groupBill)
            toastSuccess('Your share added to Personal Spending!')
            setShowSaveExpense(false)
          } catch (err) {
            toastError(err instanceof Error ? err.message : 'Failed to save expense')
          }
        }}
      />
    </div>
  )
}

// ── Split tab ─────────────────────────────────────────────────────────────────

function SplitTab({
  calcResult,
  bill,
  onSelectPerson,
}: {
  calcResult: BillCalculationResult
  bill: GroupBillData
  onSelectPerson: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {calcResult.personShares.map((ps, i) => (
        <motion.div
          key={ps.personId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <button
            className="w-full glass rounded-xl px-3 py-3 flex items-center gap-3 hover:bg-black/[0.03] transition-all text-left group"
            onClick={() => onSelectPerson(ps.personId)}
          >
            <span className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center text-sm text-indigo-600 font-bold shrink-0">
              {ps.personName[0]?.toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ps.personName}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {ps.items.length} item{ps.items.length !== 1 ? 's' : ''}
                {ps.taxShare > 0 && ` · tax ${formatMoney(ps.taxShare, bill.currency)}`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                {formatMoney(ps.total, bill.currency)}
              </span>
              <span className="transition-colors" style={{ color: 'var(--text-faint)' }}>›</span>
            </div>
          </button>
        </motion.div>
      ))}

      {/* Sum check */}
      <div
        className="flex items-center justify-between px-3 py-2 mt-1"
        style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Sum of all shares</span>
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          {formatMoney(
            calcResult.personShares.reduce((s, ps) => s + ps.total, 0),
            bill.currency
          )}
        </span>
      </div>
    </div>
  )
}

// ── Save as personal expense modal ────────────────────────────────────────────

function SaveExpenseModal({
  isOpen,
  onClose,
  bill,
  calcResult,
  onSave,
}: {
  isOpen: boolean
  onClose: () => void
  bill: GroupBillData
  calcResult: BillCalculationResult
  onSave: (personId: string, category: string) => Promise<void>
}) {
  const [selectedPersonId, setSelectedPersonId] = useState(bill.people[0]?.id ?? '')
  const [category, setCategory] = useState('food')
  const [saving, setSaving] = useState(false)

  const myShare = calcResult.personShares.find((ps) => ps.personId === selectedPersonId)

  async function handleSave() {
    if (!selectedPersonId) return
    setSaving(true)
    try {
      await onSave(selectedPersonId, category)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add My Share to Personal Spending" size="sm">
      <div className="flex flex-col gap-4">
        {/* Explanation */}
        <div className="glass rounded-xl p-3 flex items-start gap-2.5">
          <Wallet size={14} className="text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Only <strong style={{ color: 'var(--text-primary)' }}>your share</strong> will be added to Personal
            Spending — not the full group bill total of{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(bill.total, bill.currency)}</strong>.
          </p>
        </div>

        {/* Which person are you? */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Which person are you?
          </label>
          <select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
            className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm appearance-none"
          >
            {bill.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Share preview */}
        {myShare && (
          <div className="glass rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Your share</p>
              <p className="text-xl font-bold gradient-text">
                {formatMoney(myShare.total, bill.currency)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Full bill</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{formatMoney(bill.total, bill.currency)}</p>
            </div>
          </div>
        )}

        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm appearance-none"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 justify-end">
          <GlassButton variant="ghost" onClick={onClose} size="sm">
            Cancel
          </GlassButton>
          <GlassButton variant="primary" onClick={handleSave} loading={saving} size="sm">
            <Wallet size={13} />
            Add to Personal Spending
          </GlassButton>
        </div>
      </div>
    </Modal>
  )
}
