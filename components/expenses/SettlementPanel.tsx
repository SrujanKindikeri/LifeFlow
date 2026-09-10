'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Check, ChevronDown, ChevronUp, CreditCard, Plus, Minus } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { calculateBill } from '@/lib/billCalculator'
import { type GroupBillData, formatMoney, currencySymbol } from './types'

interface SettlementPanelProps {
  bill: GroupBillData
  onUpdate: (updatedBill: GroupBillData) => void
  onMarkSettled: (fromPerson: string, toPerson: string) => Promise<void>
}

export function SettlementPanel({ bill, onUpdate, onMarkSettled }: SettlementPanelProps) {
  const [editingPaid, setEditingPaid] = useState(false)
  const [paidAmounts, setPaidAmounts] = useState<Record<string, number>>(
    Object.fromEntries(bill.people.map((p) => [p.id, p.paidAmount]))
  )
  const [markingSettled, setMarkingSettled] = useState<string | null>(null)
  const { error: toastError, success: toastSuccess } = useToast()

  const sym = currencySymbol(bill.currency)

  const calcResult = calculateBill(
    bill.people.map((p) => ({ ...p, paidAmount: paidAmounts[p.id] ?? 0 })),
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
  )

  const settlements = calcResult.settlements

  const settledSet = new Set(
    bill.settlements
      .filter((s) => s.settled)
      .map((s) => `${s.fromPerson}→${s.toPerson}`)
  )

  function totalPaid() {
    return Object.values(paidAmounts).reduce((s, v) => s + v, 0)
  }

  function savePaidAmounts() {
    const updated: GroupBillData = {
      ...bill,
      people: bill.people.map((p) => ({ ...p, paidAmount: paidAmounts[p.id] ?? 0 })),
      settlements: settlements.map((s) => ({
        ...s,
        settled: settledSet.has(`${s.fromPerson}→${s.toPerson}`),
      })),
    }
    onUpdate(updated)
    setEditingPaid(false)
  }

  async function handleToggleSettled(fromPerson: string, toPerson: string) {
    const key = `${fromPerson}→${toPerson}`
    setMarkingSettled(key)
    try {
      await onMarkSettled(fromPerson, toPerson)
      toastSuccess('Settlement updated')
    } catch {
      toastError('Failed to update settlement')
    } finally {
      setMarkingSettled(null)
    }
  }

  const allSettled = settlements.length > 0 && settlements.every((s) =>
    settledSet.has(`${s.fromPerson}→${s.toPerson}`)
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Who paid section */}
      <GlassCard padding="md">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setEditingPaid((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-indigo-500" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Who paid?</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatMoney(totalPaid(), bill.currency)} / {formatMoney(bill.total, bill.currency)}
            </span>
            {editingPaid
              ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
              : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
            }
          </div>
        </div>

        <AnimatePresence>
          {editingPaid && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-3 flex flex-col gap-2">
                {bill.people.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs text-indigo-600 font-bold shrink-0">
                      {p.name[0]?.toUpperCase()}
                    </span>
                    <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          setPaidAmounts((prev) => ({
                            ...prev,
                            [p.id]: Math.max(0, (prev[p.id] ?? 0) - 100),
                          }))
                        }
                        className="w-6 h-6 rounded-lg glass hover:bg-black/[0.05] flex items-center justify-center transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Minus size={10} />
                      </button>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-faint)' }}>{sym}</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={paidAmounts[p.id] ?? 0}
                          onChange={(e) =>
                            setPaidAmounts((prev) => ({
                              ...prev,
                              [p.id]: parseFloat(e.target.value) || 0,
                            }))
                          }
                          className="glass-input rounded-xl pl-5 pr-2 py-1.5 text-sm w-24 text-right"
                        />
                      </div>
                      <button
                        onClick={() =>
                          setPaidAmounts((prev) => ({
                            ...prev,
                            [p.id]: (prev[p.id] ?? 0) + 100,
                          }))
                        }
                        className="w-6 h-6 rounded-lg glass hover:bg-black/[0.05] flex items-center justify-center transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Plus size={10} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Quick fill */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {bill.people.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        const updated: Record<string, number> = Object.fromEntries(
                          bill.people.map((person) => [person.id, 0])
                        )
                        updated[p.id] = bill.total
                        setPaidAmounts(updated)
                      }}
                      className="text-xs px-2.5 py-1 glass rounded-full hover:bg-black/[0.05] transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {p.name} paid all
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      const share = bill.total / bill.people.length
                      const updated: Record<string, number> = Object.fromEntries(
                        bill.people.map((p) => [p.id, share])
                      )
                      setPaidAmounts(updated)
                    }}
                    className="text-xs px-2.5 py-1 glass rounded-full hover:bg-black/[0.05] transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Equal paid
                  </button>
                </div>

                {/* Validation */}
                {Math.abs(totalPaid() - bill.total) > 0.5 && (
                  <p className="text-xs text-amber-600">
                    Total paid ({formatMoney(totalPaid(), bill.currency)}) doesn&apos;t match bill total ({formatMoney(bill.total, bill.currency)})
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <GlassButton size="sm" variant="ghost" onClick={() => setEditingPaid(false)}>Cancel</GlassButton>
                  <GlassButton size="sm" variant="primary" onClick={savePaidAmounts}>
                    <Check size={12} />Apply
                  </GlassButton>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      {/* Settlements */}
      <GlassCard padding="md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowRight size={16} className="text-indigo-500" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Settlements</span>
          </div>
          {allSettled && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <Check size={12} /> All settled
            </span>
          )}
        </div>

        {settlements.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {bill.people.every((p) => (paidAmounts[p.id] ?? 0) === 0)
                ? 'Enter who paid to see settlements'
                : '🎉 No transfers needed — everyone is even!'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {settlements.map((s) => {
              const key = `${s.fromPerson}→${s.toPerson}`
              const settled = settledSet.has(key)
              const fromName = bill.people.find((p) => p.id === s.fromPerson)?.name ?? s.fromPerson
              const toName = bill.people.find((p) => p.id === s.toPerson)?.name ?? s.toPerson
              const isMarking = markingSettled === key

              return (
                <motion.div
                  key={key}
                  layout
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 glass rounded-xl transition-all',
                    settled && 'opacity-55'
                  )}
                >
                  <span className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center text-xs text-red-600 font-bold shrink-0">
                    {fromName[0]?.toUpperCase()}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{fromName}</span>
                      <ArrowRight size={12} style={{ color: 'var(--text-faint)' }} className="shrink-0" />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{toName}</span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {settled ? 'Settled ✓' : 'Pending'}
                    </p>
                  </div>

                  <span className="text-sm font-bold shrink-0 mr-2" style={{ color: 'var(--text-primary)' }}>
                    {formatMoney(s.amount, bill.currency)}
                  </span>

                  <button
                    onClick={() => handleToggleSettled(s.fromPerson, s.toPerson)}
                    disabled={isMarking}
                    className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0',
                      settled
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : 'glass hover:bg-black/[0.06]',
                      isMarking && 'opacity-50 cursor-wait'
                    )}
                    style={!settled ? { color: 'var(--text-muted)' } : {}}
                    title={settled ? 'Mark as unsettled' : 'Mark as settled'}
                  >
                    {isMarking ? (
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Check size={13} />
                    )}
                  </button>
                </motion.div>
              )
            })}
          </div>
        )}
      </GlassCard>
    </div>
  )
}
