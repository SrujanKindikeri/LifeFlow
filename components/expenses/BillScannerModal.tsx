'use client'

/**
 * BillScannerModal
 *
 * Full receipt scanning flow for Group Billing:
 *
 *   STAGE 1 — Upload / capture
 *   STAGE 2 — Client-side image preprocessing + upload to /api/group-bills/scan
 *   STAGE 3 — Review screen (editable items, taxes, totals, reconciliation badge)
 *   STAGE 4 — Confirm → calls onConfirm(result)
 *
 * Accuracy guarantees:
 *   - Math validation shown on every item (qty × unitPrice = lineTotal)
 *   - Total reconciliation badge (✓ verified / ⚠ review)
 *   - Low-confidence fields highlighted in amber
 *   - "Confirm & Use" blocked until user has seen the review screen
 *   - No final bill is created inside this component
 *
 * Performance:
 *   - Heavy scanner dependencies only loaded when modal is open (dynamic import handled by caller lazy-loading)
 *   - Image resized client-side before upload (max 2000px)
 *   - Progress stages shown immediately so the UI never appears frozen
 *
 * Data flow:
 *   User picks image
 *     → resizeForScan()     (client, canvas)
 *     → POST /api/group-bills/scan
 *     → ParsedReceipt
 *     → editable review UI
 *     → onConfirm(ScanResult)
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  ChangeEvent,
  DragEvent,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera,
  Upload,
  X,
  Check,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  Info,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { cn } from '@/lib/utils'
import type { ParsedReceipt, ScannedItem, FieldConfidence } from '@/lib/receiptParser'

// ─── Public types ─────────────────────────────────────────────────────────────

/** What the scanner hands back to the parent on confirm. */
export interface ScanResult {
  items: ScanResultItem[]
  /** Subtotal of line items (rupees). */
  subtotal: number
  /** GST to populate the bill's tax field (rupees). */
  taxAmount: number | null
  /** Service charge (rupees). */
  serviceCharge: number | null
  /** Other charges (rupees). */
  otherCharges: number | null
  /** Discount (rupees, positive = reduction). */
  discount: number | null
  /** Grand total from the receipt (rupees). */
  grandTotal: number | null
  /** Whether the parent should switch splitMode to 'item'. */
  suggestItemSplit: boolean
}

export interface ScanResultItem {
  name: string
  quantity: number
  /** Unit price per item (rupees). */
  unitPrice: number
  /** quantity × unitPrice (rupees). Stored as BillItem.price in GroupBillSplitter. */
  lineTotal: number
}

interface BillScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (result: ScanResult) => void
}

// ─── Stage machine ────────────────────────────────────────────────────────────

type Stage =
  | 'upload'      // waiting for user to pick an image
  | 'scanning'    // OCR in flight — show progress steps
  | 'review'      // show parsed receipt for user review/edit
  | 'error'       // unrecoverable failure

// ─── Review item (editable mirror of ScannedItem) ──────────────────────────

interface ReviewItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
  /** true = lineTotal was printed on receipt (not inferred). */
  lineTotalFromReceipt: boolean
  originalConfidence: FieldConfidence
  /** true = qty × unitPrice ≠ lineTotal (recalculated live). */
  mathMismatch: boolean
}

function makeReviewItem(s: ScannedItem, idx: number): ReviewItem {
  const computed = Math.round(s.quantity * s.unitPrice * 100) / 100
  return {
    id: `scan_${idx}_${Date.now()}`,
    name: s.name,
    quantity: s.quantity,
    unitPrice: s.unitPrice,
    lineTotal: s.lineTotal,
    lineTotalFromReceipt: s.lineTotalFromReceipt,
    originalConfidence: s.confidence,
    mathMismatch: Math.abs(Math.round(computed * 100) - Math.round(s.lineTotal * 100)) > 1,
  }
}

function recalcMismatch(item: ReviewItem): ReviewItem {
  const computed = Math.round(item.quantity * item.unitPrice * 100) / 100
  return {
    ...item,
    mathMismatch: Math.abs(Math.round(computed * 100) - Math.round(item.lineTotal * 100)) > 1,
  }
}

// ─── Progress steps ───────────────────────────────────────────────────────────

const PROGRESS_STEPS = [
  'Scanning receipt…',
  'Reading items…',
  'Checking totals…',
  'Ready for review.',
] as const

// ─── Image preprocessing ──────────────────────────────────────────────────────

const SCAN_MAX_PX = 2000  // longer side limit before upload

async function resizeForScan(file: File): Promise<Blob> {
  if (typeof document === 'undefined') return file
  return new Promise<Blob>((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img
      const longest = Math.max(w, h)
      if (longest <= SCAN_MAX_PX) { resolve(file); return }
      const scale = SCAN_MAX_PX / longest
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        outMime,
        outMime === 'image/jpeg' ? 0.92 : undefined,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseNumField(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''))
  return isFinite(n) && n >= 0 ? n : 0
}

function confidenceBadge(c: FieldConfidence) {
  if (c === 'high')   return null   // no badge for high confidence
  if (c === 'medium') return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
      <AlertTriangle size={9} />
      Review
    </span>
  )
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
      <AlertTriangle size={9} />
      Low
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BillScannerModal({ isOpen, onClose, onConfirm }: BillScannerModalProps) {
  // ── Stage & error ──────────────────────────────────────────────────────────
  const [stage, setStage]         = useState<Stage>('upload')
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [warnMsg, setWarnMsg]     = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState(0)

  // ── Image state ────────────────────────────────────────────────────────────
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragging, setDragging]     = useState(false)

  // ── Review state (editable mirror of ParsedReceipt) ────────────────────────
  const [reviewItems, setReviewItems]   = useState<ReviewItem[]>([])
  const [taxAmount, setTaxAmount]       = useState<string>('0')
  const [serviceCharge, setServiceCharge] = useState<string>('0')
  const [otherCharges, setOtherCharges]   = useState<string>('0')
  const [discount, setDiscount]         = useState<string>('0')
  const [grandTotal, setGrandTotal]     = useState<string>('0')
  const [receiptName, setReceiptName]   = useState<string>('')
  const [reconciliationNote, setReconciliationNote] = useState<string | null>(null)
  const [totalsMatch, setTotalsMatch]   = useState<boolean>(false)
  const [reviewFlags, setReviewFlags]   = useState<string[]>([])
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef     = useRef<AbortController | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Reset on close ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort()
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      setTimeout(() => {
        setStage('upload')
        setErrorMsg(null)
        setWarnMsg(null)
        setProgressStep(0)
        if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }
        setReviewItems([])
        setTaxAmount('0')
        setServiceCharge('0')
        setOtherCharges('0')
        setDiscount('0')
        setGrandTotal('0')
        setReceiptName('')
        setReconciliationNote(null)
        setTotalsMatch(false)
        setReviewFlags([])
        setExpandedItem(null)
      }, 300)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ── Start progress animation ───────────────────────────────────────────────
  function startProgress() {
    setProgressStep(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      setProgressStep((p) => {
        if (p >= PROGRESS_STEPS.length - 2) {
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          return p
        }
        return p + 1
      })
    }, 900)
  }

  // ── File handling ──────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
      setErrorMsg('Please use a PNG, JPG, or WEBP image.')
      setStage('error')
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setErrorMsg('Image is too large. Please use an image under 25 MB.')
      setStage('error')
      return
    }
    if (file.size === 0) {
      setErrorMsg('The selected file is empty.')
      setStage('error')
      return
    }

    // Revoke previous preview
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    setStage('scanning')
    setErrorMsg(null)
    setWarnMsg(null)
    startProgress()

    const abort = new AbortController()
    abortRef.current = abort

    try {
      // Client-side resize
      const blob = await resizeForScan(file)

      if (abort.signal.aborted) return

      const fd = new FormData()
      fd.append('image', blob, file.name)

      const res = await fetch('/api/group-bills/scan', {
        method: 'POST',
        body: fd,
        signal: abort.signal,
      })

      if (abort.signal.aborted) return

      if (!res.ok && res.status !== 422) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { message?: string }).message ?? 'Scan failed')
      }

      const data = await res.json() as {
        ok: boolean
        message: string | null
        receipt: ParsedReceipt | null
      }

      // Complete the progress animation
      setProgressStep(PROGRESS_STEPS.length - 1)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)

      await new Promise((r) => setTimeout(r, 400))  // let user see "Ready for review."

      if (!data.ok || !data.receipt) {
        setErrorMsg(data.message ?? 'Unable to read this receipt. Try a clearer photo.')
        setStage('error')
        return
      }

      // ── Populate review state ──────────────────────────────────────────────
      const r = data.receipt
      setReviewItems(r.items.map(makeReviewItem))
      setTaxAmount(String(
        r.gst.cgstAmount !== null || r.gst.sgstAmount !== null || r.gst.igstAmount !== null
          ? r.gst.totalGstAmount
          : (r.gst.totalGstAmount || 0)
      ))
      setServiceCharge(String(r.serviceCharge ?? 0))
      setOtherCharges(String(r.otherCharges ?? 0))
      setDiscount(String(r.discount ?? 0))
      setGrandTotal(String(r.grandTotal ?? 0))
      setReceiptName(r.restaurantName ?? '')
      setReconciliationNote(r.reconciliationNote)
      setTotalsMatch(r.totalsMatch)
      setReviewFlags(r.reviewFlags)
      if (data.message) setWarnMsg(data.message)

      setStage('review')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setProgressStep(0)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      const msg = err instanceof Error ? err.message : 'Scan failed. Please try again.'
      setErrorMsg(msg)
      setStage('error')
    }
  }, [previewUrl])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleRetry() {
    abortRef.current?.abort()
    setStage('upload')
    setErrorMsg(null)
    setWarnMsg(null)
    setProgressStep(0)
  }

  // ── Review item operations ─────────────────────────────────────────────────
  function updateItem(id: string, patch: Partial<ReviewItem>) {
    setReviewItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        return recalcMismatch({ ...it, ...patch })
      })
    )
  }

  function removeItem(id: string) {
    setReviewItems((prev) => prev.filter((it) => it.id !== id))
    if (expandedItem === id) setExpandedItem(null)
  }

  function addItem() {
    const newItem: ReviewItem = {
      id: `scan_new_${Date.now()}`,
      name: '',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      lineTotalFromReceipt: false,
      originalConfidence: 'low',
      mathMismatch: false,
    }
    setReviewItems((prev) => [...prev, newItem])
    setExpandedItem(newItem.id)
  }

  // ── Live reconciliation ────────────────────────────────────────────────────
  const computedSubtotal = reviewItems.reduce(
    (sum, it) => Math.round((sum + it.lineTotal) * 100) / 100,
    0
  )
  const computedTotal = Math.round((
    computedSubtotal +
    parseNumField(taxAmount) +
    parseNumField(serviceCharge) +
    parseNumField(otherCharges) -
    parseNumField(discount)
  ) * 100) / 100

  const printedTotal   = parseNumField(grandTotal)
  const totalDiff      = Math.abs(Math.round(computedTotal * 100) - Math.round(printedTotal * 100))
  const liveMatch      = printedTotal > 0 && totalDiff <= 100   // within ₹1

  // ── Confirm ────────────────────────────────────────────────────────────────
  function handleConfirm() {
    const result: ScanResult = {
      items: reviewItems
        .filter((it) => it.name.trim().length > 0 && it.lineTotal > 0)
        .map((it) => ({
          name:      it.name.trim(),
          quantity:  it.quantity,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
        })),
      subtotal:      computedSubtotal,
      taxAmount:     parseNumField(taxAmount)      > 0 ? parseNumField(taxAmount)      : null,
      serviceCharge: parseNumField(serviceCharge)  > 0 ? parseNumField(serviceCharge)  : null,
      otherCharges:  parseNumField(otherCharges)   > 0 ? parseNumField(otherCharges)   : null,
      discount:      parseNumField(discount)        > 0 ? parseNumField(discount)        : null,
      grandTotal:    printedTotal                  > 0 ? printedTotal                  : null,
      suggestItemSplit: reviewItems.length > 1,
    }
    onConfirm(result)
    onClose()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Scan Bill"
      size="xl"
      className="!max-h-[92dvh]"
    >
      <div className="flex flex-col gap-0 -mt-1">
        <AnimatePresence mode="wait">

          {/* ── STAGE: Upload ─────────────────────────────────────────── */}
          {stage === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                className="sr-only"
                onChange={handleFileInput}
                capture="environment"
              />

              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed',
                  'cursor-pointer transition-all select-none py-10 px-6',
                  dragging
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-black/10 hover:border-indigo-300 hover:bg-indigo-50/40'
                )}
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(99,102,241,0.1)' }}
                >
                  <Camera size={30} className="text-indigo-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Take a photo or upload your receipt
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    PNG, JPG or WEBP · up to 25 MB
                  </p>
                </div>
                <div className="flex gap-2">
                  <GlassButton
                    variant="primary"
                    size="sm"
                    className="gap-1.5"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                  >
                    <Camera size={13} />
                    Camera
                  </GlassButton>
                  <GlassButton
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                  >
                    <Upload size={13} />
                    Gallery
                  </GlassButton>
                </div>
              </div>

              {/* Tips */}
              <div
                className="mt-4 rounded-xl px-3.5 py-3 flex gap-2.5 items-start"
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)' }}
              >
                <Info size={14} className="text-indigo-400 mt-0.5 shrink-0" />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  For best results: lay the receipt flat, use good lighting, and keep the whole
                  receipt in frame. Supports CGST&nbsp;+&nbsp;SGST, IGST, service charge, and
                  discounts.
                </p>
              </div>
            </motion.div>
          )}

          {/* ── STAGE: Scanning ───────────────────────────────────────── */}
          {stage === 'scanning' && (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col items-center gap-6 py-8"
            >
              {/* Preview thumbnail */}
              {previewUrl && (
                <div className="w-32 h-44 rounded-xl overflow-hidden shadow-md shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Receipt preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Progress steps */}
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {PROGRESS_STEPS.map((label, idx) => {
                  const done    = idx < progressStep
                  const active  = idx === progressStep
                  const pending = idx > progressStep
                  return (
                    <div key={label} className={cn('flex items-center gap-2.5 text-sm transition-all', pending && 'opacity-30')}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                        {done ? (
                          <Check size={12} className="text-emerald-500" />
                        ) : active ? (
                          <Loader2 size={12} className="text-indigo-500 animate-spin" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-30" />
                        )}
                      </span>
                      <span style={{ color: done ? 'var(--text-primary)' : active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ── STAGE: Error ──────────────────────────────────────────── */}
          {stage === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col items-center gap-5 py-8 text-center"
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-red-50">
                <AlertTriangle size={26} className="text-red-500" />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {errorMsg ?? 'Unable to read this receipt.'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Try retaking the photo with better lighting and the full receipt in frame.
                </p>
              </div>
              <div className="flex gap-2">
                <GlassButton variant="secondary" size="sm" onClick={onClose}>
                  Cancel
                </GlassButton>
                <GlassButton variant="primary" size="sm" className="gap-1.5" onClick={handleRetry}>
                  <RefreshCw size={13} />
                  Try Again
                </GlassButton>
              </div>
            </motion.div>
          )}

          {/* ── STAGE: Review ─────────────────────────────────────────── */}
          {stage === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-4"
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {receiptName ? (
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {receiptName}
                    </p>
                  ) : null}
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Review extracted items before adding to your bill.
                  </p>
                </div>
                {previewUrl && (
                  <div className="w-10 h-14 rounded-lg overflow-hidden shrink-0 border border-black/[0.08]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* Warning banner */}
              {warnMsg && (
                <div
                  className="flex gap-2 items-start rounded-xl px-3.5 py-2.5"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}
                >
                  <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {warnMsg}
                  </p>
                </div>
              )}

              {/* Review flags */}
              {reviewFlags.length > 0 && (
                <div
                  className="rounded-xl px-3.5 py-2.5 flex flex-col gap-1"
                  style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}
                >
                  {reviewFlags.map((f, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <AlertTriangle size={11} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{f}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Item list ──────────────────────────────────────────── */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Items ({reviewItems.length})
                  </p>
                  <GlassButton
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={addItem}
                  >
                    <Plus size={12} />
                    Add item
                  </GlassButton>
                </div>

                {reviewItems.length === 0 && (
                  <div
                    className="py-4 text-center text-xs rounded-xl"
                    style={{ color: 'var(--text-muted)', background: 'rgba(0,0,0,0.03)' }}
                  >
                    No items extracted. Add them manually.
                  </div>
                )}

                <AnimatePresence>
                  {reviewItems.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <ReviewItemRow
                        item={item}
                        isExpanded={expandedItem === item.id}
                        onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                        onUpdate={(p) => updateItem(item.id, p)}
                        onRemove={() => removeItem(item.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* ── Charges section ────────────────────────────────────── */}
              <ChargesSection
                subtotal={computedSubtotal}
                taxAmount={taxAmount}        setTaxAmount={setTaxAmount}
                serviceCharge={serviceCharge} setServiceCharge={setServiceCharge}
                otherCharges={otherCharges}  setOtherCharges={setOtherCharges}
                discount={discount}          setDiscount={setDiscount}
                grandTotal={grandTotal}      setGrandTotal={setGrandTotal}
                computedTotal={computedTotal}
                liveMatch={liveMatch}
                reconciliationNote={reconciliationNote}
              />

              {/* ── Action buttons ─────────────────────────────────────── */}
              <div className="flex gap-2.5 pt-1">
                <GlassButton variant="ghost" size="md" className="gap-1.5" onClick={handleRetry}>
                  <RefreshCw size={13} />
                  Rescan
                </GlassButton>
                <div className="flex-1" />
                <GlassButton variant="secondary" size="md" onClick={onClose}>
                  Cancel
                </GlassButton>
                <GlassButton
                  variant="primary"
                  size="md"
                  className="gap-1.5"
                  onClick={handleConfirm}
                  disabled={reviewItems.filter((i) => i.name.trim() && i.lineTotal > 0).length === 0}
                >
                  <Check size={14} />
                  Use Items
                </GlassButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}

// ─── ReviewItemRow ────────────────────────────────────────────────────────────

function ReviewItemRow({
  item,
  isExpanded,
  onToggle,
  onUpdate,
  onRemove,
}: {
  item: ReviewItem
  isExpanded: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<ReviewItem>) => void
  onRemove: () => void
}) {
  const lineDisplay = item.lineTotal > 0
    ? fmt(item.lineTotal)
    : (item.name ? '₹0.00' : '—')

  const needsReview = item.originalConfidence !== 'high' || item.mathMismatch

  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden mb-1 transition-colors',
        needsReview
          ? 'border border-amber-200 bg-amber-50/40'
          : 'border border-black/[0.07] bg-transparent'
      )}
    >
      {/* Summary row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-black/[0.02] transition-colors"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        aria-expanded={isExpanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-sm font-medium truncate"
              style={{ color: item.name ? 'var(--text-primary)' : 'var(--text-faint)' }}
            >
              {item.name || 'Unnamed item'}
            </span>
            {item.quantity > 1 && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                ×{item.quantity}
              </span>
            )}
            {confidenceBadge(item.originalConfidence)}
            {item.mathMismatch && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-full">
                <AlertTriangle size={9} />
                Math check
              </span>
            )}
          </div>
          {item.quantity > 1 && item.unitPrice > 0 && (
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {fmt(item.unitPrice)} each
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {lineDisplay}
          </span>
          <span style={{ color: 'var(--text-faint)' }}>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </div>
      </div>

      {/* Expanded editor */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-black/[0.06]"
          >
            <div className="p-3 flex flex-col gap-3">
              {/* Name */}
              <GlassInput
                label="Item name"
                placeholder="e.g. Paneer Butter Masala"
                value={item.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
              />

              {/* Qty / Unit price / Line total */}
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Qty</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="glass-input rounded-xl px-2.5 py-2 text-sm text-center w-full"
                    value={item.quantity}
                    onChange={(e) => {
                      const q = Math.max(1, parseInt(e.target.value) || 1)
                      const lt = Math.round(q * item.unitPrice * 100) / 100
                      onUpdate({ quantity: q, lineTotal: lt })
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Unit price</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-faint)' }}>₹</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="glass-input rounded-xl pl-5 pr-2 py-2 text-sm w-full"
                      value={item.unitPrice || ''}
                      onChange={(e) => {
                        const up = parseFloat(e.target.value) || 0
                        const lt = Math.round(item.quantity * up * 100) / 100
                        onUpdate({ unitPrice: up, lineTotal: lt })
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Line total
                    {item.mathMismatch && (
                      <AlertTriangle size={9} className="inline ml-1 text-amber-500" />
                    )}
                  </label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-faint)' }}>₹</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={cn(
                        'glass-input rounded-xl pl-5 pr-2 py-2 text-sm w-full',
                        item.mathMismatch && 'border border-amber-300 bg-amber-50/60'
                      )}
                      value={item.lineTotal || ''}
                      onChange={(e) => onUpdate({ lineTotal: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              </div>

              {/* Math mismatch explanation */}
              {item.mathMismatch && (
                <p className="text-[11px] text-amber-700">
                  ⚠ {item.quantity} × ₹{item.unitPrice.toFixed(2)} = ₹{(item.quantity * item.unitPrice).toFixed(2)},
                  but line total shows ₹{item.lineTotal.toFixed(2)}.
                  Please verify and correct.
                </p>
              )}

              {/* Remove */}
              <div className="flex justify-end">
                <GlassButton variant="danger" size="sm" className="gap-1" onClick={onRemove}>
                  <Trash2 size={12} />
                  Remove
                </GlassButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── ChargesSection ───────────────────────────────────────────────────────────

function ChargesSection({
  subtotal,
  taxAmount,      setTaxAmount,
  serviceCharge,  setServiceCharge,
  otherCharges,   setOtherCharges,
  discount,       setDiscount,
  grandTotal,     setGrandTotal,
  computedTotal,
  liveMatch,
  reconciliationNote,
}: {
  subtotal: number
  taxAmount: string;       setTaxAmount: (v: string) => void
  serviceCharge: string;   setServiceCharge: (v: string) => void
  otherCharges: string;    setOtherCharges: (v: string) => void
  discount: string;        setDiscount: (v: string) => void
  grandTotal: string;      setGrandTotal: (v: string) => void
  computedTotal: number
  liveMatch: boolean
  reconciliationNote: string | null
}) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.07)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        Charges &amp; Taxes
      </p>

      {/* Subtotal (read-only — computed from items) */}
      <TotalRow label="Items subtotal" value={fmt(subtotal)} muted />

      {/* Editable charges */}
      <EditableChargeRow label="GST / Tax (₹)"       value={taxAmount}      onChange={setTaxAmount}      />
      <EditableChargeRow label="Service charge (₹)"  value={serviceCharge}  onChange={setServiceCharge}  />
      <EditableChargeRow label="Other charges (₹)"   value={otherCharges}   onChange={setOtherCharges}   />
      <EditableChargeRow label="Discount (₹)"        value={discount}       onChange={setDiscount}       isDiscount />

      {/* Divider */}
      <div className="border-t border-black/[0.08]" />

      {/* Computed total */}
      <TotalRow label="Computed total" value={fmt(computedTotal)} bold />

      {/* Printed total (editable) */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium flex-1" style={{ color: 'var(--text-secondary)' }}>
          Receipt total (₹)
        </label>
        <div className="relative w-28">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-faint)' }}>₹</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className="glass-input rounded-xl pl-5 pr-2 py-1.5 text-sm w-full font-semibold"
            value={grandTotal}
            onChange={(e) => setGrandTotal(e.target.value)}
          />
        </div>
      </div>

      {/* Reconciliation badge */}
      <ReconciliationBadge
        liveMatch={liveMatch}
        note={reconciliationNote}
        printedTotal={parseNumField(grandTotal)}
        computedTotal={computedTotal}
      />
    </div>
  )
}

function TotalRow({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span
        className="text-xs"
        style={{ color: muted ? 'var(--text-faint)' : 'var(--text-secondary)' }}
      >
        {label}
      </span>
      <span
        className={cn('text-sm', bold && 'font-semibold')}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  )
}

function EditableChargeRow({
  label,
  value,
  onChange,
  isDiscount,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  isDiscount?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        className="text-xs flex-1"
        style={{ color: isDiscount ? 'var(--text-secondary)' : 'var(--text-secondary)' }}
      >
        {isDiscount ? <span className="text-emerald-600">{label}</span> : label}
      </label>
      <div className="relative w-28">
        {isDiscount && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-emerald-500">−₹</span>
        )}
        {!isDiscount && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-faint)' }}>₹</span>
        )}
        <input
          type="number"
          min={0}
          step="0.01"
          className={cn(
            'glass-input rounded-xl pr-2 py-1.5 text-sm w-full',
            isDiscount ? 'pl-7' : 'pl-5'
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

// ─── ReconciliationBadge ──────────────────────────────────────────────────────

function ReconciliationBadge({
  liveMatch,
  note,
  printedTotal,
  computedTotal,
}: {
  liveMatch: boolean
  note: string | null
  printedTotal: number
  computedTotal: number
}) {
  if (printedTotal <= 0) return null

  if (liveMatch) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.22)' }}
      >
        <Check size={13} className="text-emerald-500 shrink-0" />
        <p className="text-xs font-medium text-emerald-700">
          ✓ Receipt total verified
        </p>
      </div>
    )
  }

  const diff = Math.round((computedTotal - printedTotal) * 100) / 100
  const sign = diff > 0 ? '+' : ''

  return (
    <div
      className="flex items-start gap-2 rounded-xl px-3 py-2.5"
      style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
    >
      <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-semibold text-amber-700">
          ⚠ Please review this receipt
        </p>
        <p className="text-[11px] text-amber-600 mt-0.5">
          {note
            ? note
            : `Computed ₹${computedTotal.toFixed(2)} vs. receipt ₹${printedTotal.toFixed(2)} (${sign}₹${Math.abs(diff).toFixed(2)})`}
        </p>
      </div>
    </div>
  )
}
