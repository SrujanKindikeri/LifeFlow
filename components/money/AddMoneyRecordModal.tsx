'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { useToast } from '@/components/ui/Toast'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'
import type { MoneyDirection, MoneyRecordData } from './types'

interface Props {
  isOpen: boolean
  defaultDirection?: MoneyDirection
  onClose: () => void
  onCreated: (record: MoneyRecordData) => void
  /** If navigating from /app/drafts, the draftId to restore */
  draftId?: string
}

export function AddMoneyRecordModal({ isOpen, defaultDirection = 'given', onClose, onCreated, draftId }: Props) {
  const { success, error } = useToast()
  const [saving, setSaving] = useState(false)
  const [showUnsaved, setShowUnsaved] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const [direction, setDirection] = useState<MoneyDirection>(defaultDirection)
  const [personName, setPersonName] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [givenDate, setGivenDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')

  // Keep a ref for useDraft callbacks (avoids stale closures)
  const formRef = useRef({ direction, personName, amount, reason, givenDate, dueDate, note })
  useEffect(() => {
    formRef.current = { direction, personName, amount, reason, givenDate, dueDate, note }
  }, [direction, personName, amount, reason, givenDate, dueDate, note])

  const draft = useDraft({
    type: direction === 'given' ? 'moneyGiven' : 'moneyBorrowed',
    initialDraftId: draftId,
    getTitle:  () => formRef.current.personName ? `${formRef.current.personName} · ₹${formRef.current.amount}` : 'Money Draft',
    getData:   () => ({
      direction: formRef.current.direction,
      personName: formRef.current.personName,
      amount:     formRef.current.amount,
      reason:     formRef.current.reason,
      givenDate:  formRef.current.givenDate,
      dueDate:    formRef.current.dueDate,
      note:       formRef.current.note,
    }),
    hasMeaningfulData: () => Boolean(
      formRef.current.personName.trim() || formRef.current.amount || formRef.current.reason.trim()
    ),
  })

  // Load draft data when modal opens with a draftId
  useEffect(() => {
    if (!draftId || !isOpen) return
    fetch(`/api/drafts/${draftId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.draft?.data) return
        const data = d.draft.data as Record<string, string>
        if (data.direction === 'given' || data.direction === 'borrowed') setDirection(data.direction)
        if (data.personName)  setPersonName(data.personName)
        if (data.amount)      setAmount(data.amount)
        if (data.reason)      setReason(data.reason)
        if (data.givenDate)   setGivenDate(data.givenDate)
        if (data.dueDate)     setDueDate(data.dueDate)
        if (data.note)        setNote(data.note)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, isOpen])

  function reset() {
    setPersonName(''); setAmount(''); setReason('')
    setGivenDate(today); setDueDate(''); setNote('')
  }

  function handleClose() {
    if (draft.hasMeaningfulData()) {
      setShowUnsaved(true)
    } else {
      reset(); onClose()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseAmountExpression(amount)
    const amt = parsed.value
    if (!amt || amt <= 0 || !personName.trim() || !reason.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/money-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person: { name: personName.trim() },
          direction,
          amount: amt,
          reason: reason.trim(),
          givenDate,
          dueDate: dueDate || undefined,
          note: note.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        error(data.error ?? 'Failed to create record')
        return
      }
      const data = await res.json()
      // Delete draft after successful creation
      await draft.deleteDraft()
      success(direction === 'given' ? 'Money Given recorded' : 'Money Borrowed recorded')
      onCreated(data.record)
      reset()
      onClose()
    } catch {
      error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(5px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          <motion.div
            className="glass-floating relative w-full sm:max-w-md rounded-t-[28px] sm:rounded-2xl max-h-[92dvh] overflow-y-auto"
            style={{ boxShadow: 'var(--glass-shadow-xl)' }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 32 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {direction === 'given' ? '+ Money Given' : '+ Money Borrowed'}
              </h2>
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
              {/* Direction toggle */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: 'var(--text-muted)' }}>
                  Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['given', 'borrowed'] as MoneyDirection[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDirection(d)}
                      className="py-2.5 rounded-xl text-sm font-medium border transition-all"
                      style={
                        direction === d
                          ? {
                              background: d === 'given' ? 'rgba(99,102,241,0.12)' : 'rgba(249,115,22,0.12)',
                              borderColor: d === 'given' ? 'rgba(99,102,241,0.4)' : 'rgba(249,115,22,0.4)',
                              color: d === 'given' ? '#6366f1' : '#f97316',
                            }
                          : {
                              background: 'transparent',
                              borderColor: 'var(--border-strong)',
                              color: 'var(--text-muted)',
                            }
                      }
                    >
                      {d === 'given' ? '💸 Money Given' : '🤝 Money Borrowed'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
                  {direction === 'given'
                    ? 'You gave money · They owe you'
                    : 'Someone gave you money · You owe them'}
                </p>
              </div>

              <GlassInput
                label="Person's Name"
                placeholder="e.g. Rahul"
                value={personName}
                onChange={(e) => { setPersonName(e.target.value); draft.triggerAutosave() }}
                required
                autoFocus
              />

              <SmartAmountInput
                label="Amount"
                value={amount}
                onChange={(raw) => { setAmount(raw); draft.triggerAutosave() }}
                currency="INR"
                required
              />

              <GlassInput
                label="Reason"
                placeholder={direction === 'given' ? 'e.g. College fees' : 'e.g. Trip booking'}
                value={reason}
                onChange={(e) => { setReason(e.target.value); draft.triggerAutosave() }}
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <GlassInput
                  label="Date"
                  type="date"
                  value={givenDate}
                  onChange={(e) => { setGivenDate(e.target.value); draft.triggerAutosave() }}
                  required
                />
                <GlassInput
                  label="Due Date (optional)"
                  type="date"
                  value={dueDate}
                  onChange={(e) => { setDueDate(e.target.value); draft.triggerAutosave() }}
                />
              </div>

              <GlassTextarea
                label="Note (optional)"
                placeholder={direction === 'given' ? 'e.g. Will return after salary' : 'e.g. For trip expenses'}
                value={note}
                onChange={(e) => { setNote(e.target.value); draft.triggerAutosave() }}
                rows={2}
              />

              {/* Draft save status */}
              <div className="flex items-center justify-between">
                <SaveDraftStatus status={draft.saveStatus} />
                <button
                  type="button"
                  onClick={() => draft.saveDraft()}
                  className="text-[11px] font-medium transition-colors"
                  style={{ color: 'var(--accent)' }}
                >
                  Save Draft
                </button>
              </div>

              <GlassButton
                type="submit"
                variant="primary"
                fullWidth
                loading={saving}
                disabled={!personName.trim() || !amount || (parseAmountExpression(amount).value ?? 0) <= 0 || !reason.trim()}
              >
                <Check size={14} />
                {direction === 'given' ? 'Record Money Given' : 'Record Money Borrowed'}
              </GlassButton>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    <UnsavedChangesDialog
      isOpen={showUnsaved}
      onContinueEditing={() => setShowUnsaved(false)}
      onSaveAsDraft={async () => {
        await draft.saveDraft()
        setShowUnsaved(false)
        reset()
        onClose()
      }}
      onDiscard={() => {
        draft.deleteDraft()
        setShowUnsaved(false)
        reset()
        onClose()
      }}
    />
    </>
  )
}

// Re-export for backward compat (QuickAddModal uses AddMoneyRecordModal)
export type { Props as AddMoneyRecordModalProps }
