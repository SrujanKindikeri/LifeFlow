'use client'

/**
 * TransactionAnalysisModal
 *
 * Shows OCR-extracted transaction details for user review after uploading a
 * payment screenshot.
 *
 * Rules:
 *  - Never auto-creates an expense.
 *  - Every field is editable by the user before confirming.
 *  - Category is never guessed; user must select it.
 *  - If direction is "received", warns user instead of silently creating expense.
 *  - Checks for duplicates before confirming.
 *  - Attaches original screenshot(s) as transaction proof.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Eye,
  ImageIcon,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassSelect } from '@/components/ui/GlassInput'
import { useToast } from '@/components/ui/Toast'
import { EXPENSE_CATEGORIES } from '@/lib/utils'
import type { CapturedImage } from './TransactionCapturePanel'
import type { ParsedTransaction } from '@/lib/transactionParser'
import type { TransactionCapture, TransactionProofMeta, PaymentMethod } from '@/types/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfirmedExpenseData {
  amount: number          // rupees (float) — Expense.amount field
  category: string
  description: string
  date: string            // YYYY-MM-DD
  paymentMethod?: PaymentMethod
  transactionCapture: TransactionCapture
}

interface DuplicateInfo {
  _id: string
  amount: number
  category: string
  description?: string
  date: string
  createdAt: string
}

interface Props {
  isOpen: boolean
  images: CapturedImage[]
  onClose: () => void
  /** Called with the confirmed form data. Caller is responsible for POST /api/expenses. */
  onConfirm: (data: ConfirmedExpenseData) => void
  onViewImage?: (fileId: string, filename: string) => void
}

const CAT_OPTIONS = [
  { value: '', label: 'Select category…' },
  ...EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` })),
]

const PAYMENT_METHOD_OPTIONS = [
  { value: '',            label: 'Select method…' },
  { value: 'upi',         label: 'UPI' },
  { value: 'cash',        label: 'Cash' },
  { value: 'card',        label: 'Card' },
  { value: 'net_banking', label: 'Net Banking' },
  { value: 'wallet',      label: 'Wallet' },
  { value: 'other',       label: 'Other' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRef(type: string): string {
  const map: Record<string, string> = {
    UTR:               'UTR',
    UPI_REF:           'UPI Ref No.',
    UPI_TRANSACTION_ID:'UPI Transaction ID',
    TRANSACTION_ID:    'Transaction ID',
    REFERENCE_NUMBER:  'Reference No.',
    OTHER:             'Reference',
  }
  return map[type] ?? type
}

function bestParsed(images: CapturedImage[]): ParsedTransaction | null {
  // Pick the parsed result with the highest confidence from all done images
  const order: Record<string, number> = { high: 3, partial: 2, low: 1 }
  const candidates = images
    .filter((i) => i.status === 'done' && i.parsed)
    .map((i) => i.parsed!)
    .sort((a, b) => (order[b.confidence] ?? 0) - (order[a.confidence] ?? 0))
  return candidates[0] ?? null
}

function detectPaymentMethod(parsed: ParsedTransaction | null): PaymentMethod | '' {
  if (!parsed) return ''
  const text = [parsed.upiId, parsed.bank, parsed.paidTo, parsed.receivedFrom]
    .filter(Boolean).join(' ').toLowerCase()
  if (parsed.upiId || text.includes('upi') || text.includes('@')) return 'upi'
  if (text.includes('cash')) return 'cash'
  if (text.includes('card') || text.includes('debit') || text.includes('credit')) return 'card'
  if (text.includes('net banking') || text.includes('neft') || text.includes('rtgs')) return 'net_banking'
  if (text.includes('wallet') || text.includes('paytm') || text.includes('phonepe')) return 'wallet'
  return ''
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TransactionAnalysisModal({
  isOpen,
  images,
  onClose,
  onConfirm,
  onViewImage,
}: Props) {
  const { error: toastError } = useToast()

  const parsed = bestParsed(images)

  // ── Form state ─────────────────────────────────────────────────────────────
  const [amount,        setAmount]        = useState('')
  const [category,      setCategory]      = useState('')
  const [description,   setDescription]   = useState('')
  const [date,          setDate]          = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')

  // ── Direction warning state ────────────────────────────────────────────────
  const [directionChoice, setDirectionChoice] = useState<
    'none' | 'received-warning' | 'continue-as-expense'
  >('none')

  // ── Duplicate detection ────────────────────────────────────────────────────
  const [duplicate,       setDuplicate]       = useState<DuplicateInfo | null>(null)
  const [duplicateChecked,setDuplicateChecked]= useState(false)
  const [checkingDup,     setCheckingDup]     = useState(false)

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [saving,          setSaving]          = useState(false)
  const [detailsExpanded, setDetailsExpanded] = useState(true)

  // Pre-fill from parsed on open
  useEffect(() => {
    if (!isOpen) return
    if (!parsed) {
      setAmount('')
      setCategory('')
      setDescription('')
      setDate(new Date().toISOString().split('T')[0])
      setPaymentMethod('')
      setDirectionChoice('none')
      setDuplicate(null)
      setDuplicateChecked(false)
      return
    }

    setAmount(parsed.amountRupees != null ? String(parsed.amountRupees) : '')
    setCategory('')  // never pre-select — user must choose
    setDescription(
      parsed.paidTo
        ? parsed.paidTo
        : parsed.receivedFrom
          ? `From: ${parsed.receivedFrom}`
          : ''
    )
    setDate(parsed.transactionDate ?? new Date().toISOString().split('T')[0])
    setPaymentMethod(detectPaymentMethod(parsed))
    setDetailsExpanded(true)
    setDuplicate(null)
    setDuplicateChecked(false)

    // Show received-money warning
    if (parsed.direction === 'received') {
      setDirectionChoice('received-warning')
    } else {
      setDirectionChoice('none')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ── Duplicate check ────────────────────────────────────────────────────────
  async function checkDuplicate(): Promise<DuplicateInfo | null> {
    const amountNum = parseFloat(amount)
    if (!amountNum || !date) return null
    setCheckingDup(true)
    try {
      const firstRef = parsed?.references?.[0]?.value
      const res = await fetch('/api/expenses/duplicate-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountNum, date, referenceValue: firstRef }),
      })
      if (!res.ok) return null
      const data = await res.json() as { duplicate: boolean; existing?: DuplicateInfo }
      setDuplicateChecked(true)
      if (data.duplicate && data.existing) {
        setDuplicate(data.existing)
        return data.existing
      }
      setDuplicate(null)
      return null
    } catch {
      return null
    } finally {
      setCheckingDup(false)
    }
  }

  // ── Confirm ────────────────────────────────────────────────────────────────
  async function handleConfirm(forceDuplicate = false) {
    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toastError('Please enter a valid amount.')
      return
    }
    if (!category) {
      toastError('Please select a category.')
      return
    }
    if (!date) {
      toastError('Date is required.')
      return
    }

    setSaving(true)

    try {
      // Duplicate check (first confirm attempt only)
      if (!duplicateChecked && !forceDuplicate) {
        const dup = await checkDuplicate()
        if (dup) { setSaving(false); return } // UI will show duplicate warning
      }

      // Build proofs list from uploaded images
      const proofs: TransactionProofMeta[] = images
        .filter((i) => i.status === 'done' && i.fileId)
        .map((i) => ({
          fileId:     i.fileId as string,
          filename:   i.filename,
          mimeType:   i.mimeType,
          sizeBytes:  i.sizeBytes,
          uploadedAt: new Date().toISOString(),
        }))

      // Build transactionCapture from parsed + user confirmation
      const capture: TransactionCapture = {
        amountMinor:      Math.round(amountNum * 100),  // paise
        currency:         parsed?.currency ?? 'INR',
        direction:        parsed?.direction,
        status:           parsed?.status,
        paidTo:           parsed?.paidTo,
        receivedFrom:     parsed?.receivedFrom,
        upiId:            parsed?.upiId,
        phoneNumber:      parsed?.phoneNumber,
        bank:             parsed?.bank,
        references:       parsed?.references ?? [],
        transactionDate:  parsed?.transactionDate,
        transactionTime:  parsed?.transactionTime,
        extractedAt:      new Date().toISOString(),
        extractionMethod: 'ocr_text',
        multipleDetected: parsed?.multipleDetected ?? false,
        lowConfidence:    parsed?.lowConfidence ?? true,
        proofs,
      }

      onConfirm({
        amount:      amountNum,
        category,
        description: description.trim().slice(0, 200) || undefined as unknown as string,
        date,
        paymentMethod: paymentMethod || undefined,
        transactionCapture: capture,
      })
    } finally {
      setSaving(false)
    }
  }

  // ── Received-money warning screen ─────────────────────────────────────────
  if (directionChoice === 'received-warning') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Transaction Detected" size="sm">
        <div className="flex flex-col gap-5">
          {/* Direction indicator */}
          <div
            className="flex items-start gap-3 rounded-xl p-4"
            style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)' }}
          >
            <ArrowDownLeft size={20} style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                This appears to be a received transaction
              </p>
              {parsed?.amountRupees != null && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  ₹{parsed.amountRupees}{parsed.receivedFrom ? ` from ${parsed.receivedFrom}` : ''}
                </p>
              )}
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Received money is usually not a personal expense. What would you like to do?
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <GlassButton
              variant="secondary"
              onClick={() => {
                // TODO: deep-link to Money Tracker with pre-filled values
                toastError('Open Money Tracker to record money received from a person.')
                onClose()
              }}
            >
              Add to Money Tracker
            </GlassButton>

            <GlassButton
              variant="ghost"
              onClick={() => setDirectionChoice('continue-as-expense')}
            >
              <ArrowUpRight size={14} />
              Continue as Expense Anyway
            </GlassButton>

            <GlassButton variant="ghost" onClick={onClose}>
              Cancel
            </GlassButton>
          </div>
        </div>
      </Modal>
    )
  }

  // ── Multiple transactions detected ────────────────────────────────────────
  if (parsed?.multipleDetected) {
    // Just show a notice at the top, user still fills in details manually
    // (we don't show a selection screen since we can't reliably split them)
  }

  // ── Main review form ──────────────────────────────────────────────────────
  const hasParsedDetails =
    parsed &&
    (parsed.paidTo ||
      parsed.receivedFrom ||
      parsed.upiId ||
      parsed.bank ||
      parsed.references.length > 0 ||
      parsed.transactionDate ||
      parsed.status)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Review Transaction Details"
      size="md"
    >
      <div className="flex flex-col gap-4">

        {/* ── Confidence banner ─────────────────────────────────────────── */}
        {parsed && (
          <div
            className="flex items-start gap-2.5 rounded-xl p-3"
            style={{
              background: parsed.confidence === 'high'
                ? 'rgba(22,163,74,0.07)'
                : parsed.confidence === 'partial'
                  ? 'rgba(99,102,241,0.07)'
                  : 'rgba(245,158,11,0.07)',
              border: `1px solid ${
                parsed.confidence === 'high'
                  ? 'rgba(22,163,74,0.18)'
                  : parsed.confidence === 'partial'
                    ? 'rgba(99,102,241,0.15)'
                    : 'rgba(245,158,11,0.18)'
              }`,
            }}
          >
            {parsed.confidence === 'high' ? (
              <CheckCircle2 size={14} style={{ color: '#16a34a', flexShrink: 0, marginTop: 1 }} />
            ) : parsed.confidence === 'partial' ? (
              <Info size={14} style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }} />
            ) : (
              <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
            )}
            <p
              className="text-xs leading-relaxed"
              style={{
                color: parsed.confidence === 'high'
                  ? '#15803d'
                  : parsed.confidence === 'partial'
                    ? '#4338ca'
                    : '#92400e',
              }}
            >
              {parsed.confidence === 'high'
                ? 'Transaction details detected. Review and confirm before saving.'
                : parsed.confidence === 'partial'
                  ? 'Some details detected. Please verify and fill in the rest.'
                  : 'Could not read all details. Please fill in manually.'}
              {parsed.multipleDetected && (
                <><br /><strong>Note:</strong> Multiple transactions may be present in this screenshot. Please verify the values below.</>
              )}
            </p>
          </div>
        )}

        {!parsed && (
          <div
            className="flex items-start gap-2.5 rounded-xl p-3"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.18)' }}
          >
            <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
            <p className="text-xs leading-relaxed" style={{ color: '#92400e' }}>
              Transaction details could not be read from this screenshot.
              You can still attach it as proof and enter the details manually.
            </p>
          </div>
        )}

        {/* ── Core expense fields ────────────────────────────────────────── */}
        <div>
          <label className="text-sm font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Amount <span style={{ color: 'var(--danger, #dc2626)' }}>*</span>
          </label>
          <div className="relative">
            <span
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              ₹
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              className="glass-input w-full rounded-xl pl-8 pr-3.5 py-2.5 text-sm"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setDuplicateChecked(false); setDuplicate(null) }}
            />
          </div>
        </div>

        <GlassSelect
          label="Category *"
          value={category}
          onChange={(v) => setCategory(v)}
          options={CAT_OPTIONS}
        />

        <GlassInput
          label="Description (optional)"
          placeholder="Merchant name, notes…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="Date *"
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setDuplicateChecked(false); setDuplicate(null) }}
          />
          <GlassSelect
            label="Payment Method"
            value={paymentMethod}
            onChange={(v) => setPaymentMethod(v as PaymentMethod | '')}
            options={PAYMENT_METHOD_OPTIONS}
          />
        </div>

        {/* ── Detected details (collapsible) ────────────────────────────── */}
        {hasParsedDetails && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
          >
            <button
              type="button"
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
              onClick={() => setDetailsExpanded((v) => !v)}
            >
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Extracted Transaction Details
              </span>
              {detailsExpanded
                ? <ChevronUp size={14} style={{ color: 'var(--text-faint)' }} />
                : <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} />
              }
            </button>

            <AnimatePresence initial={false}>
              {detailsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden', borderTop: '1px solid var(--border)' }}
                >
                  <div className="px-3.5 py-3 flex flex-col gap-2">
                    {parsed?.status && <DetailRow label="Status" value={parsed.status} />}
                    {parsed?.direction && (
                      <DetailRow
                        label="Direction"
                        value={
                          <span className="flex items-center gap-1">
                            {parsed.direction === 'sent'
                              ? <ArrowUpRight size={12} style={{ color: 'var(--danger, #dc2626)' }} />
                              : parsed.direction === 'received'
                                ? <ArrowDownLeft size={12} style={{ color: 'var(--success, #16a34a)' }} />
                                : null}
                            {parsed.direction}
                          </span>
                        }
                      />
                    )}
                    {parsed?.paidTo     && <DetailRow label="Paid To"       value={parsed.paidTo} />}
                    {parsed?.receivedFrom && <DetailRow label="Received From" value={parsed.receivedFrom} />}
                    {parsed?.upiId      && <DetailRow label="UPI ID"        value={parsed.upiId} />}
                    {parsed?.bank       && <DetailRow label="Bank"          value={parsed.bank} />}
                    {parsed?.transactionDate && <DetailRow label="Date"     value={parsed.transactionDate} />}
                    {parsed?.transactionTime && <DetailRow label="Time"     value={parsed.transactionTime} />}
                    {(parsed?.references ?? []).map((ref, i) => (
                      <DetailRow key={i} label={formatRef(ref.type)} value={ref.value} mono />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Attached proofs ───────────────────────────────────────────── */}
        {images.filter((i) => i.fileId).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Transaction Proof
            </span>
            <div className="flex flex-wrap gap-2">
              {images
                .filter((i) => i.fileId)
                .map((img) => (
                  <button
                    key={img.fileId as string}
                    type="button"
                    onClick={() => onViewImage?.(img.fileId as string, img.filename)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/[0.05]"
                    style={{
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <ImageIcon size={12} />
                    {img.filename.length > 20 ? img.filename.slice(0, 17) + '…' : img.filename}
                    {onViewImage && (
                      <Eye size={11} style={{ color: 'var(--text-faint)', marginLeft: 2 }} />
                    )}
                  </button>
                ))}
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              ✓ Screenshot will be saved as private transaction proof
            </p>
          </div>
        )}

        {/* ── Duplicate warning ─────────────────────────────────────────── */}
        {duplicate && (
          <div
            className="rounded-xl p-3.5"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.20)' }}
          >
            <div className="flex items-start gap-2.5 mb-3">
              <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Possible duplicate transaction
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  A similar expense already exists:
                  ₹{duplicate.amount} · {duplicate.date} · {duplicate.category}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => setDuplicate(null)}
              >
                View Existing
              </GlassButton>
              <GlassButton
                variant="secondary"
                size="sm"
                loading={saving}
                onClick={() => { setDuplicate(null); setDuplicateChecked(true); handleConfirm(true) }}
              >
                Create Anyway
              </GlassButton>
            </div>
          </div>
        )}

        {/* ── Footer disclaimer ─────────────────────────────────────────── */}
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          Extracted details are suggestions only. Verify all values before saving.
        </p>

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex gap-2.5 justify-end pt-1">
          <GlassButton variant="ghost" onClick={onClose}>
            Cancel
          </GlassButton>
          <GlassButton
            variant="primary"
            loading={saving || checkingDup}
            onClick={() => handleConfirm(false)}
          >
            Create Expense
          </GlassButton>
        </div>
      </div>
    </Modal>
  )
}

// ─── Tiny detail row ──────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 min-h-[22px]">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 110 }}>
        {label}
      </span>
      <span
        className={`text-xs text-right break-all ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  )
}
