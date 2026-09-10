'use client'

import { useState, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, IndianRupee, AlertCircle } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { useToast } from '@/components/ui/Toast'
import { formatPaiseDisplay } from './types'
import type { MoneyRecordData, MoneyPaymentData } from './types'

interface Props {
  record: MoneyRecordData
  isOpen: boolean
  onClose: () => void
  /** Called after a successful payment with the updated record + new payment */
  onPaymentRecorded: (updatedRecord: MoneyRecordData, payment: MoneyPaymentData) => void

  /** If provided, we are editing an existing payment instead of creating */
  editPayment?: MoneyPaymentData | null
  onPaymentUpdated?: (updatedRecord: MoneyRecordData, payment: MoneyPaymentData) => void
}

export function RecordPaymentModal({
  record,
  isOpen,
  onClose,
  onPaymentRecorded,
  editPayment = null,
  onPaymentUpdated,
}: Props) {
  const { success, error } = useToast()
  const idempotencyId = useId()

  const today = new Date().toISOString().split('T')[0]
  const [amount, setAmount]   = useState(
    editPayment ? String(editPayment.amountMinor / 100) : ''
  )
  const [date, setDate]       = useState(
    editPayment ? editPayment.paymentDate : today
  )
  const [note, setNote]       = useState(editPayment?.note ?? '')
  const [saving, setSaving]   = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const isEdit = !!editPayment
  const remainingMinor = isEdit
    ? record.remainingMinor + editPayment.amountMinor  // add back this payment's amount for edit validation
    : record.remainingMinor
  const maxRupees = remainingMinor / 100

  function reset() {
    setAmount(editPayment ? String(editPayment.amountMinor / 100) : '')
    setDate(editPayment ? editPayment.paymentDate : today)
    setNote(editPayment?.note ?? '')
    setValidationError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const rupees = parseFloat(amount)
    if (!rupees || rupees <= 0) {
      setValidationError('Please enter a valid amount.')
      return
    }
    const paise = Math.round(rupees * 100)
    if (paise > remainingMinor) {
      setValidationError(
        `Payment exceeds the remaining balance. Maximum: ${formatPaiseDisplay(remainingMinor, record.currency)}.`
      )
      return
    }
    setValidationError(null)
    setSaving(true)

    try {
      if (isEdit) {
        // PATCH existing payment
        const res = await fetch(
          `/api/money-records/${record._id}/payments/${editPayment._id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: rupees,
              paymentDate: date,
              note: note.trim() || undefined,
            }),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          error(data.error ?? 'Failed to update payment')
          return
        }
        const data = await res.json()
        success('Payment updated')
        onPaymentUpdated?.(data.record, data.payment)
        handleClose()
      } else {
        // POST new payment with idempotency key
        const idempotencyKey = `${record._id}-${idempotencyId}-${Date.now()}`
        const res = await fetch(`/api/money-records/${record._id}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: rupees,
            paymentDate: date,
            note: note.trim() || undefined,
            idempotencyKey,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          if (data.maxAllowedMinor !== undefined) {
            setValidationError(data.error ?? 'Payment exceeds remaining balance.')
            return
          }
          error(data.error ?? 'Failed to record payment')
          return
        }
        const data = await res.json()
        const wasFullyPaid = data.record.status === 'paid'
        success(wasFullyPaid ? '✓ Fully Paid!' : 'Payment recorded')
        onPaymentRecorded(data.record, data.payment)
        handleClose()
      }
    } catch {
      error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const personName = record.person.name
  const directionLabel =
    record.direction === 'given'
      ? `${personName} is paying you`
      : `You are paying ${personName}`

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(5px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            className="relative w-full sm:max-w-md rounded-t-[28px] sm:rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(36px) saturate(1.8)',
              WebkitBackdropFilter: 'blur(36px) saturate(1.8)',
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 16px 60px rgba(0,0,0,0.14)',
            }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 32 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(0,0,0,0.12)' }} />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4"
              style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}
            >
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {isEdit ? 'Edit Payment' : 'Record Payment'}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {directionLabel}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-xl hover:bg-black/[0.05] transition-colors"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Balance context */}
              <div
                className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                style={{
                  background: 'rgba(99,102,241,0.07)',
                  border: '1px solid rgba(99,102,241,0.15)',
                }}
              >
                <div>
                  <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>Remaining balance</p>
                  <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {formatPaiseDisplay(record.remainingMinor, record.currency)}
                  </p>
                </div>
                <IndianRupee size={22} style={{ color: 'rgba(99,102,241,0.5)' }} />
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Amount
                </label>
                <div className="relative">
                  <span
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ₹
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    max={maxRupees}
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setValidationError(null) }}
                    placeholder="0.00"
                    autoFocus
                    required
                    className="glass-input w-full rounded-xl text-sm pl-8 pr-3.5 py-3 text-base font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              <GlassInput
                label="Payment Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />

              <GlassTextarea
                label="Note (optional)"
                placeholder={
                  record.direction === 'given'
                    ? 'e.g. First repayment'
                    : 'e.g. Transferred via UPI'
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />

              {/* Validation error */}
              <AnimatePresence>
                {validationError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-start gap-2 px-3.5 py-3 rounded-xl"
                    style={{
                      background: 'rgba(220,38,38,0.07)',
                      border: '1px solid rgba(220,38,38,0.18)',
                    }}
                  >
                    <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
                    <p className="text-xs text-red-600 leading-relaxed">{validationError}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <GlassButton
                type="submit"
                variant="primary"
                fullWidth
                loading={saving}
                disabled={!amount || parseFloat(amount) <= 0}
              >
                <Check size={14} />
                {isEdit ? 'Update Payment' : 'Record Payment'}
              </GlassButton>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
