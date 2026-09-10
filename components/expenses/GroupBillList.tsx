'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Receipt, Calendar, Users, ChevronRight, Wallet } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { Modal } from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/Loading'
import { cn, formatDate } from '@/lib/utils'
import { type GroupBillData, formatMoney } from './types'

interface GroupBillListProps {
  bills: GroupBillData[]
  onSelect: (bill: GroupBillData) => void
  onEdit: (bill: GroupBillData) => void
  onDelete: (id: string, deleteExpense: boolean) => Promise<void>
  loading?: boolean
}

export function GroupBillList({
  bills,
  onSelect,
  onEdit,
  onDelete,
  loading = false,
}: GroupBillListProps) {
  const [confirmBill, setConfirmBill] = useState<GroupBillData | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { error: toastError } = useToast()

  async function handleDelete(deleteExpense: boolean) {
    if (!confirmBill?._id) return
    setDeleting(true)
    try {
      await onDelete(confirmBill._id, deleteExpense)
    } catch {
      toastError('Failed to delete bill')
    } finally {
      setDeleting(false)
      setConfirmBill(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-2xl p-4 h-20 skeleton" />
        ))}
      </div>
    )
  }

  if (bills.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No group bills yet"
        description="Split a bill with friends, family, or roommates."
      />
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <AnimatePresence>
          {bills.map((bill, i) => (
            <motion.div
              key={bill._id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ delay: i * 0.04, duration: 0.18 }}
            >
              <BillCard
                bill={bill}
                onSelect={() => onSelect(bill)}
                onEdit={() => onEdit(bill)}
                onDelete={() => setConfirmBill(bill)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {confirmBill && (
        <DeleteBillModal
          bill={confirmBill}
          deleting={deleting}
          onCancel={() => setConfirmBill(null)}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}

// ── Bill card ──────────────────────────────────────────────────────────────────

function BillCard({
  bill,
  onSelect,
  onEdit,
  onDelete,
}: {
  bill: GroupBillData
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const pendingSettlements = bill.settlements.filter((s) => !s.settled).length
  const totalSettlements = bill.settlements.length

  return (
    <GlassCard hover padding="md" className="cursor-pointer" onClick={onSelect}>
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
          <Receipt size={18} className="text-indigo-500" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {bill.name}
            </p>
            {bill.savedAsExpense && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-600 border border-emerald-500/20 shrink-0">
                <Wallet size={9} />
                In Personal Spending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Calendar size={10} />
              {formatDate(bill.date)}
            </span>
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Users size={10} />
              {bill.people.length} people
            </span>
            {totalSettlements > 0 && (
              <span className={cn(
                'text-xs font-medium',
                pendingSettlements === 0 ? 'text-emerald-600' : 'text-amber-600'
              )}>
                {pendingSettlements === 0
                  ? '✓ Settled'
                  : `${pendingSettlements}/${totalSettlements} pending`}
              </span>
            )}
          </div>
        </div>

        {/* Amount + actions */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatMoney(bill.total, bill.currency)}
          </span>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onEdit}
              className="text-[10px] px-1 transition-colors hover:text-indigo-500"
              style={{ color: 'var(--text-faint)' }}
            >
              Edit
            </button>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <button
              onClick={onDelete}
              className="text-[10px] px-1 hover:text-red-500 transition-colors"
              style={{ color: 'var(--text-faint)' }}
            >
              Delete
            </button>
          </div>
        </div>

        <ChevronRight size={14} style={{ color: 'var(--text-faint)' }} className="shrink-0" />
      </div>
    </GlassCard>
  )
}

// ── Delete modal ─────────────────────────────────────────────────────────────

function DeleteBillModal({
  bill,
  deleting,
  onCancel,
  onConfirm,
}: {
  bill: GroupBillData
  deleting: boolean
  onCancel: () => void
  onConfirm: (deleteExpense: boolean) => void
}) {
  const hasLinkedExpense = bill.savedAsExpense

  return (
    <Modal isOpen onClose={onCancel} title="Delete Group Bill" size="sm">
      <div className="flex flex-col gap-4">
        {hasLinkedExpense ? (
          <>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{bill.name}</strong> has a linked personal expense
              (your share). What would you like to do?
            </p>

            <div className="glass rounded-xl px-3.5 py-3 flex items-center gap-2.5">
              <Wallet size={14} className="text-emerald-500 shrink-0" />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Your share of{' '}
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatMoney(bill.total, bill.currency)}
                </span>{' '}
                is saved in Personal Spending.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <GlassButton variant="ghost" fullWidth onClick={onCancel} disabled={deleting}>
                Cancel
              </GlassButton>
              <GlassButton variant="secondary" fullWidth onClick={() => onConfirm(false)} loading={deleting}>
                Delete Group Bill Only
              </GlassButton>
              <GlassButton variant="danger" fullWidth onClick={() => onConfirm(true)} loading={deleting}>
                Delete Group Bill + Personal Expense
              </GlassButton>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Permanently delete <strong style={{ color: 'var(--text-primary)' }}>{bill.name}</strong>? This will
              remove all split data and cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <GlassButton variant="ghost" onClick={onCancel} disabled={deleting}>Cancel</GlassButton>
              <GlassButton variant="danger" onClick={() => onConfirm(false)} loading={deleting}>Delete</GlassButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
