'use client'

/**
 * AddAmountModal
 *
 * Lets the user add additional money to an existing record without creating a
 * new record or touching the original amount.
 *
 * - Uses SmartAmountInput so expressions like "40+40+20" work.
 * - Generates a per-submit idempotency key to prevent double-adds on retry.
 * - Button is disabled while saving to prevent concurrent submissions.
 * - On success: closes, shows toast, calls onAmountAdded with updated record.
 * - On failure: keeps modal open, shows one error message, preserves input.
 */

import { useState, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, AlertCircle, TrendingUp } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { useToast } from '@/components/ui/Toast'
import { formatPaiseDisplay } from './types'
import type { MoneyRecordData } from './types'

interface Props {
  record: MoneyRecordData
  isOpen: boolean
  onClose: () => void
  /** Called after a successful add with the full updated record */
  onAmountAdded: (updatedRecord: MoneyRecordData) => void
}

export function AddAmountModal({ record, isOpen, onClose, onAmountAdded }: Props) {
  const { success } = useToast()
  // A fresh unique prefix per modal mount; combined with Date.now() at submit
  // to produce a per-attempt idempotency key.
  const mountId = useId()

  const today = new Date().toISOString().split('T')[0]

  const [amount, setAmount]             = useState('')
  const [reason, setReason]             = useState('')
  const [date, setDate]                 = useState(today)
  const [note, setNote]                 = useState('')
  const [saving, setSaving]             = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Derived: total after adding the entered amount (for preview)
  const parsedAmount = parseAmountExpression(amount)
  const previewTotalMinor =
    parsedAmount.value !== null
      ? record.totalAmountMinor + Math.round(parsedAmount.value * 100)
      : null

  function reset() {
    setAmount('')
    setReason('')
    setDate(today)
    setNote('')
    setValidationError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Client-side validation
    const parsed = parseAmountExpression(amount)
    const rupees = parsed.value
    if (!rupees || rupees <= 0) {
      setValidationError('Please enter a valid amount.')
      return
    }
    if (!reason.trim()) {
      setValidationError('Please enter a reason for this additional amount.')
      return
    }

    setValidationError(null)
    setSaving(true)

    // Unique key for this submit attempt — prevents double-add on network retry
    const idempotencyKey = `add-${record._id}-${mountId}-${Date.now()}`

    try {
      const res = await fetch(`/api/money-records/${record._id}/add-amount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: rupees,
          reason: reason.trim(),
          date,
          note: note.trim() || undefined,
          idempotencyKey,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // Keep modal open, preserve input, show one error
        setValidationError(data.error ?? 'Failed to add amount. Please try again.')
        return
      }

      const data = await res.json()
      success('Amount added successfully')
      onAmountAdded(data.record)
      handleClose()
    } catch {
      setValidationError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const personName = record.person.name
  const directionLabel =
    record.direction === 'given'
      ? `Additional money given to ${personName}`
      : `Additional money borrowed from ${personName}`

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
            className="glass-floating relative w-full sm:max-w-md rounded-t-[28px] sm:rounded-2xl overflow-hidden"
            style={{ boxShadow: 'var(--glass-shadow-xl)' }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 32 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Add More Amount
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {directionLabel}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="nav-hover p-1.5 rounded-xl transition-colors"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Current total context */}
              <div
                className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                style={{
                  background: 'rgba(99,102,241,0.07)',
                  border: '1px solid rgba(99,102,241,0.15)',
                }}
              >
                <div>
                  <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                    Current total
                  </p>
                  <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {formatPaiseDisplay(record.totalAmountMinor, record.currency)}
                  </p>
                </div>
                <TrendingUp size={22} style={{ color: 'rgba(99,102,241,0.5)' }} />
              </div>

              {/* Amount */}
              <SmartAmountInput
                label="Additional Amount"
                value={amount}
                onChange={(raw) => { setAmount(raw); setValidationError(null) }}
                currency={record.currency ?? 'INR'}
                hint='Supports expressions: "40+40+20" = ₹100'
                autoFocus
                required
              />

              {/* Preview new total */}
              <AnimatePresence>
                {previewTotalMinor !== null && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
                    style={{
                      background: 'rgba(22,163,74,0.07)',
                      border: '1px solid rgba(22,163,74,0.18)',
                    }}
                  >
                    <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      New total will be
                    </p>
                    <p className="text-[14px] font-bold tabular-nums text-emerald-600">
                      {formatPaiseDisplay(previewTotalMinor, record.currency)}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Reason */}
              <GlassInput
                label="Reason"
                placeholder={
                  record.direction === 'given'
                    ? 'e.g. Additional food expenses'
                    : 'e.g. Extra borrowed for rent'
                }
                value={reason}
                onChange={(e) => { setReason(e.target.value); setValidationError(null) }}
                required
              />

              {/* Date */}
              <GlassInput
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />

              {/* Note (optional) */}
              <GlassTextarea
                label="Note (optional)"
                placeholder="Any additional context…"
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
                disabled={saving || !amount || (parseAmountExpression(amount).value ?? 0) <= 0 || !reason.trim()}
              >
                <Plus size={14} />
                Add Amount
              </GlassButton>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
