'use client'

/**
 * BillScannerModal
 *
 * 4-stage receipt scanning flow for Group Billing.
 *
 *   STAGE 1 — Upload / capture
 *   STAGE 2 — Processing (client resize → POST /api/group-bills/scan)
 *   STAGE 3 — Review screen
 *               • Merchant info (name, address, phone, GSTIN)
 *               • Bill metadata (number, date, time, table, token)
 *               • Editable item table (ONLY actual food/product items)
 *               • Charges (tax, service charge, discount)
 *               • Live arithmetic reconciliation
 *   STAGE 4 — Error + recovery options
 *
 * Key guarantees:
 *   - Merchant info / bill metadata NEVER appear as items.
 *   - Live qty × unitPrice = lineTotal check on every edit.
 *   - Grand total null → "not visible" — never invented.
 *   - User can add, edit, delete items before confirming.
 *   - onConfirm(ScanResult) hands rupee-denominated data to GroupBillSplitter.
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
  Camera, Upload, X, Check, AlertTriangle,
  Loader2, RefreshCw, Trash2, Plus, Info,
  ShieldCheck, Store, Receipt, Clock,
} from 'lucide-react'
import { Modal }       from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput }  from '@/components/ui/GlassInput'
import { cn }          from '@/lib/utils'
import type {
  ScanPipelineResult,
  ReceiptItem,
  ConfidenceScore,
  ConfidenceBucket,
  MerchantInfo,
  BillMetadata,
} from '@/lib/receiptVision'
import { toBucket } from '@/lib/receiptVision'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ScanResultItem {
  name:      string
  quantity:  number
  unitPrice: number   // rupees
  lineTotal: number   // rupees
}

export interface ScanResult {
  merchant:         MerchantInfo
  bill:             BillMetadata
  items:            ScanResultItem[]
  subtotal:         number
  taxAmount:        number | null
  serviceCharge:    number | null
  discount:         number | null
  grandTotal:       number | null
  suggestItemSplit: boolean
}

// ─── Internal review item ─────────────────────────────────────────────────────

interface ReviewItem {
  id:           string
  name:         string
  quantity:     number
  unitPrice:    number
  lineTotal:    number
  fieldConf:    ReceiptItem['confidence']
  mathMismatch: boolean
  lowConf:      boolean
}

function makeReviewItem(item: ReceiptItem, idx: number): ReviewItem {
  const up  = item.unitPriceMinor / 100
  const lt  = item.lineTotalMinor / 100
  const computed = Math.round(item.quantity * up * 100) / 100
  return {
    id:           `scan_${idx}_${Date.now()}`,
    name:         item.name,
    quantity:     item.quantity,
    unitPrice:    up,
    lineTotal:    lt,
    fieldConf:    item.confidence,
    mathMismatch: Math.abs(Math.round(computed * 100) - Math.round(lt * 100)) > 1,
    lowConf:      Object.values(item.confidence).some((c) => c < 0.60),
  }
}

function recalcMismatch(item: ReviewItem): ReviewItem {
  const computed = Math.round(item.quantity * item.unitPrice * 100) / 100
  return { ...item, mathMismatch: Math.abs(Math.round(computed * 100) - Math.round(item.lineTotal * 100)) > 1 }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BillScannerModalProps {
  isOpen:    boolean
  onClose:   () => void
  onConfirm: (result: ScanResult) => void
}

// ─── Stage ────────────────────────────────────────────────────────────────────

type Stage = 'upload' | 'scanning' | 'review' | 'error'

const PROGRESS_STEPS = [
  'Uploading receipt…',
  'Reading receipt…',
  'Identifying items…',
  'Validating totals…',
  'Ready for review.',
] as const

// ─── Client-side resize ───────────────────────────────────────────────────────

const SCAN_MAX_PX = 2000

async function resizeForScan(file: File): Promise<Blob> {
  if (typeof document === 'undefined') return file
  return new Promise<Blob>((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img
      if (Math.max(w, h) <= SCAN_MAX_PX) { resolve(file); return }
      const scale  = SCAN_MAX_PX / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      canvas.toBlob((blob) => resolve(blob ?? file), mime, mime === 'image/jpeg' ? 0.92 : undefined)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRupees(n: number | null | undefined): string {
  if (n == null) return '—'
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseField(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''))
  return isFinite(n) && n >= 0 ? n : 0
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfBadge({ score }: { score: ConfidenceScore }) {
  const b: ConfidenceBucket = toBucket(score)
  if (b === 'high') return null
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border',
      b === 'medium'
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : 'text-red-600 bg-red-50 border-red-200',
    )}>
      <AlertTriangle size={8} />
      {b === 'medium' ? 'Review' : 'Low'}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BillScannerModal({ isOpen, onClose, onConfirm }: BillScannerModalProps) {
  const [stage,        setStage]        = useState<Stage>('upload')
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null)
  const [warnMsg,      setWarnMsg]      = useState<string | null>(null)
  const [fallbackMsg,  setFallbackMsg]  = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState(0)
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)
  const [dragging,     setDragging]     = useState(false)

  // Merchant / bill display
  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null)
  const [billMeta,     setBillMeta]     = useState<BillMetadata | null>(null)

  // Review items
  const [reviewItems,   setReviewItems]   = useState<ReviewItem[]>([])
  const [taxAmount,     setTaxAmount]     = useState('0')
  const [serviceCharge, setServiceCharge] = useState('0')
  const [discount,      setDiscount]      = useState('0')
  const [grandTotal,    setGrandTotal]    = useState<string | null>(null)
  const [reviewFlags,   setReviewFlags]   = useState<string[]>([])
  const [scanStatus,    setScanStatus]    = useState<ScanPipelineResult['status'] | null>(null)
  const [expandedItem,  setExpandedItem]  = useState<string | null>(null)

  const fileInputRef     = useRef<HTMLInputElement>(null)
  const abortRef         = useRef<AbortController | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort()
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      const prev = previewUrl
      setTimeout(() => {
        setStage('upload'); setErrorMsg(null); setWarnMsg(null); setProgressStep(0); setFallbackMsg(null)
        if (prev) { URL.revokeObjectURL(prev); setPreviewUrl(null) }
        setMerchantInfo(null); setBillMeta(null)
        setReviewItems([]); setTaxAmount('0'); setServiceCharge('0')
        setDiscount('0'); setGrandTotal(null)
        setReviewFlags([]); setScanStatus(null); setExpandedItem(null)
      }, 300)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  function startProgress() {
    setProgressStep(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      setProgressStep((p) => {
        if (p >= PROGRESS_STEPS.length - 2) { if (progressTimerRef.current) clearInterval(progressTimerRef.current); return p }
        return p + 1
      })
    }, 700)
  }

  const processFile = useCallback(async (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/i)) {
      setErrorMsg('Please use a PNG, JPG, or WEBP image.'); setStage('error'); return
    }
    if (file.size === 0)                { setErrorMsg('The selected file is empty.'); setStage('error'); return }
    if (file.size > 25 * 1024 * 1024)  { setErrorMsg('Image too large. Please use an image under 25 MB.'); setStage('error'); return }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    setStage('scanning'); setErrorMsg(null); setWarnMsg(null); startProgress()

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const blob = await resizeForScan(file)
      if (abort.signal.aborted) return

      const fd = new FormData()
      fd.append('image', blob, file.name)

      const res = await fetch('/api/group-bills/scan', { method: 'POST', body: fd, signal: abort.signal })
      if (abort.signal.aborted) return

      setProgressStep(PROGRESS_STEPS.length - 1)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      await new Promise((r) => setTimeout(r, 400))

      const data = await res.json() as {
        ok: boolean; message: string | null
        fallbackMessage: string | null
        result: ScanPipelineResult | null; provider: string | null
      }

      if (!data.ok || !data.result) {
        setErrorMsg(data.message ?? 'Unable to read this receipt. Try a clearer photo.')
        setStage('error'); return
      }

      const { extraction, status, reviewFlags: flags } = data.result

      // Populate merchant / bill metadata
      setMerchantInfo(extraction.merchant)
      setBillMeta(extraction.bill)

      // Items — minor units → rupees
      setReviewItems(extraction.items.map(makeReviewItem))

      // Tax: sum all tax entries
      const totalTaxMinor = extraction.taxes.reduce((s, t) => s + t.amountMinor, 0)
      setTaxAmount(String(totalTaxMinor / 100))
      setServiceCharge(String(extraction.serviceChargeMinor / 100))
      setDiscount(String(extraction.discountMinor / 100))
      setGrandTotal(extraction.grandTotalMinor !== null ? String(extraction.grandTotalMinor / 100) : null)

      setReviewFlags(flags)
      setScanStatus(status)

      // Fallback notice (AI was bypassed) — shown separately from review warnings
      if (data.fallbackMessage) {
        setFallbackMsg(data.fallbackMessage)
      }

      // Review-level warnings (arithmetic mismatches, missing grand total, etc.)
      // Skip if the message is the same as the fallback notice to avoid duplication
      const reviewMsg = data.message !== data.fallbackMessage ? data.message : null
      if (reviewMsg) {
        setWarnMsg(reviewMsg)
      } else if (status === 'grand_total_missing') {
        setWarnMsg('Grand total not visible in scanned image.')
      } else if (status === 'review_required') {
        setWarnMsg('Please review the highlighted values before continuing.')
      }

      setStage('review')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      setErrorMsg(err instanceof Error ? err.message : 'Scan failed. Please try again.')
      setStage('error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl])

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void processFile(file)
  }

  function handleRetry() { abortRef.current?.abort(); setStage('upload'); setErrorMsg(null); setWarnMsg(null); setFallbackMsg(null) }

  // Item CRUD
  function updateItem(id: string, patch: Partial<ReviewItem>) {
    setReviewItems((prev) => prev.map((it) => it.id !== id ? it : recalcMismatch({ ...it, ...patch })))
  }
  function removeItem(id: string) {
    setReviewItems((prev) => prev.filter((it) => it.id !== id))
    if (expandedItem === id) setExpandedItem(null)
  }
  function addItem() {
    const newIt: ReviewItem = {
      id: `scan_new_${Date.now()}`, name: '', quantity: 1, unitPrice: 0, lineTotal: 0,
      fieldConf: { name: 0, quantity: 0, unitPrice: 0, lineTotal: 0 },
      mathMismatch: false, lowConf: true,
    }
    setReviewItems((prev) => [...prev, newIt])
    setExpandedItem(newIt.id)
  }

  // Live totals
  const computedSubtotal = reviewItems.reduce((s, it) => Math.round((s + it.lineTotal) * 100) / 100, 0)
  const parsedTax        = parseField(taxAmount)
  const parsedService    = parseField(serviceCharge)
  const parsedDiscount   = parseField(discount)
  const computedTotal    = Math.round((computedSubtotal + parsedTax + parsedService - parsedDiscount) * 100) / 100
  const parsedGrand      = grandTotal !== null ? parseField(grandTotal) : null
  const totalDiff        = parsedGrand !== null ? Math.abs(Math.round(computedTotal * 100) - Math.round(parsedGrand * 100)) : null
  const liveMatch        = totalDiff !== null && totalDiff <= 100

  function handleConfirm() {
    const validItems = reviewItems.filter((it) => it.name.trim().length > 0 && it.lineTotal > 0)
    const result: ScanResult = {
      merchant:         merchantInfo ?? { name: null, address: null, phone: null, gstin: null, fssai: null },
      bill:             billMeta     ?? { number: null, date: null, time: null, orderType: null, tableNumber: null, tokenNumber: null, cashier: null },
      items:            validItems.map((it) => ({ name: it.name.trim(), quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.lineTotal })),
      subtotal:         computedSubtotal,
      taxAmount:        parsedTax    > 0 ? parsedTax    : null,
      serviceCharge:    parsedService > 0 ? parsedService : null,
      discount:         parsedDiscount > 0 ? parsedDiscount : null,
      grandTotal:       parsedGrand !== null && parsedGrand > 0 ? parsedGrand : null,
      suggestItemSplit: validItems.length > 1,
    }
    onConfirm(result)
    onClose()
  }

  const canConfirm = reviewItems.some((it) => it.name.trim().length > 0 && it.lineTotal > 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Scan Bill" size="xl" className="!max-h-[92dvh]">
      <div className="flex flex-col gap-0 -mt-1">
        <AnimatePresence mode="wait">

          {/* ── UPLOAD ─────────────────────────────────────────────────── */}
          {stage === 'upload' && (
            <motion.div key="upload" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="sr-only" onChange={handleFileInput} capture="environment" />

              <div
                role="button" tabIndex={0} aria-label="Upload receipt image"
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed',
                  'cursor-pointer transition-all select-none py-10 px-6',
                  dragging ? 'border-indigo-400 bg-indigo-50' : 'border-black/10 hover:border-indigo-300 hover:bg-indigo-50/40',
                )}
              >
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.10)' }}>
                  <Camera size={30} className="text-indigo-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Take a photo or upload your receipt</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>PNG, JPG or WEBP · up to 25 MB</p>
                </div>
                <div className="flex gap-2">
                  <GlassButton variant="primary" size="sm" className="gap-1.5" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                    <Camera size={13} /> Camera
                  </GlassButton>
                  <GlassButton variant="secondary" size="sm" className="gap-1.5" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                    <Upload size={13} /> Gallery
                  </GlassButton>
                </div>
              </div>

              <div className="mt-4 rounded-xl px-3.5 py-3 flex gap-2.5 items-start" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)' }}>
                <Info size={14} className="text-indigo-400 mt-0.5 shrink-0" />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Lay the receipt flat with good lighting. The scanner identifies restaurant info, bill metadata, and food items separately — only the food items will be added to your bill.
                </p>
              </div>
            </motion.div>
          )}

          {/* ── SCANNING ───────────────────────────────────────────────── */}
          {stage === 'scanning' && (
            <motion.div key="scanning" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="flex flex-col items-center gap-6 py-8">
              {previewUrl && (
                <div className="w-28 h-40 rounded-xl overflow-hidden shadow-md shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Receipt preview" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {PROGRESS_STEPS.map((label, idx) => {
                  const done = idx < progressStep, active = idx === progressStep, pending = idx > progressStep
                  return (
                    <div key={label} className={cn('flex items-center gap-2.5 text-sm transition-all', pending && 'opacity-30')}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                        {done    ? <Check   size={12} className="text-emerald-500" />
                        : active ? <Loader2 size={12} className="text-indigo-500 animate-spin" />
                        :          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-30" />}
                      </span>
                      <span style={{ color: (done || active) ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ── ERROR ──────────────────────────────────────────────────── */}
          {stage === 'error' && (
            <motion.div key="error" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="flex flex-col items-center gap-5 py-8 text-center">
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
              <div className="flex gap-2 flex-wrap justify-center">
                <GlassButton variant="secondary" size="sm" onClick={onClose}>Cancel</GlassButton>
                <GlassButton variant="primary" size="sm" className="gap-1.5" onClick={handleRetry}>
                  <RefreshCw size={13} /> Try Again
                </GlassButton>
              </div>
            </motion.div>
          )}

          {/* ── REVIEW ─────────────────────────────────────────────────── */}
          {stage === 'review' && (
            <motion.div key="review" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.20 }} className="flex flex-col gap-4 overflow-y-auto max-h-[70dvh] pr-0.5">

              {/* Receipt preview thumbnail */}
              {previewUrl && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-12 rounded-lg overflow-hidden shrink-0 border border-black/[0.08]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Review extracted data before adding to your bill.
                  </p>
                </div>
              )}

              {/* ── Status banner ─────────────────────────────────────── */}
              {scanStatus === 'verified' && reviewFlags.length === 0 && !warnMsg && !fallbackMsg && (
                <div className="flex gap-2 items-center rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.20)' }}>
                  <ShieldCheck size={13} className="text-emerald-500 shrink-0" />
                  <p className="text-xs font-medium text-emerald-700">All items and totals verified.</p>
                </div>
              )}
              {fallbackMsg && (
                <div className="flex gap-2 items-start rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
                  <Info size={13} className="text-indigo-500 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{fallbackMsg}</p>
                </div>
              )}
              {warnMsg && (
                <div className="flex gap-2 items-start rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
                  <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{warnMsg}</p>
                </div>
              )}
              {reviewFlags.length > 0 && (
                <div className="rounded-xl px-3.5 py-2.5 flex flex-col gap-1.5" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
                  {reviewFlags.map((f, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <AlertTriangle size={10} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{f}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Section A: Merchant info ───────────────────────────── */}
              {merchantInfo && (merchantInfo.name || merchantInfo.address || merchantInfo.gstin) && (
                <div className="rounded-xl p-3.5 flex flex-col gap-1.5" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.12)' }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Store size={12} className="text-indigo-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Restaurant / Merchant</span>
                  </div>
                  {merchantInfo.name    && <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{merchantInfo.name}</p>}
                  {merchantInfo.address && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{merchantInfo.address}</p>}
                  {merchantInfo.phone   && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>📞 {merchantInfo.phone}</p>}
                  {merchantInfo.gstin   && <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>GSTIN: {merchantInfo.gstin}</p>}
                </div>
              )}

              {/* ── Section B: Bill metadata ───────────────────────────── */}
              {billMeta && (billMeta.number || billMeta.date || billMeta.tableNumber || billMeta.tokenNumber || billMeta.orderType) && (
                <div className="rounded-xl p-3 flex flex-wrap gap-x-4 gap-y-1.5" style={{ background: 'rgba(0,0,0,0.025)', border: '1px solid rgba(0,0,0,0.06)' }}>
                  <div className="flex items-center gap-1.5 w-full mb-0.5">
                    <Receipt size={11} className="opacity-40" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Bill Details</span>
                  </div>
                  {billMeta.number      && <MetaChip label="Bill No."   value={billMeta.number} />}
                  {billMeta.date        && <MetaChip label="Date"        value={billMeta.date} />}
                  {billMeta.time        && <MetaChip label="Time"        value={billMeta.time} />}
                  {billMeta.orderType   && <MetaChip label="Order"       value={billMeta.orderType} />}
                  {billMeta.tableNumber && <MetaChip label="Table"       value={billMeta.tableNumber} />}
                  {billMeta.tokenNumber && <MetaChip label="Token"       value={billMeta.tokenNumber} />}
                </div>
              )}

              {/* ── Section C: Items ───────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Items ({reviewItems.length})
                  </p>
                  <GlassButton variant="ghost" size="sm" className="gap-1 text-xs" onClick={addItem}>
                    <Plus size={12} /> Add item
                  </GlassButton>
                </div>

                {reviewItems.length === 0 && (
                  <div className="py-4 text-center text-xs rounded-xl" style={{ color: 'var(--text-muted)', background: 'rgba(0,0,0,0.03)' }}>
                    No items extracted. Add them manually below.
                  </div>
                )}

                <div className="flex flex-col gap-0.5">
                  <AnimatePresence>
                    {reviewItems.map((item) => (
                      <motion.div key={item.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.14 }}>
                        <ReviewRow
                          item={item}
                          expanded={expandedItem === item.id}
                          onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                          onUpdate={(p) => updateItem(item.id, p)}
                          onRemove={() => removeItem(item.id)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              {/* ── Section D: Charges & totals ────────────────────────── */}
              <ChargesBlock
                subtotal={computedSubtotal}
                taxAmount={taxAmount}        setTaxAmount={setTaxAmount}
                serviceCharge={serviceCharge} setServiceCharge={setServiceCharge}
                discount={discount}           setDiscount={setDiscount}
                grandTotal={grandTotal}       setGrandTotal={setGrandTotal}
                computedTotal={computedTotal}
                liveMatch={liveMatch}
                totalDiff={totalDiff}
              />

              {/* ── Confirm ────────────────────────────────────────────── */}
              <div className="flex gap-2 pt-1 sticky bottom-0 pb-1" style={{ background: 'var(--bg-base)' }}>
                <GlassButton variant="secondary" size="md" className="flex-1" onClick={onClose}>Cancel</GlassButton>
                <GlassButton variant="primary" size="md" className="flex-2 gap-1.5" onClick={handleConfirm} disabled={!canConfirm}>
                  <Check size={14} /> Use These Items
                </GlassButton>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </Modal>
  )
}

// ─── MetaChip ─────────────────────────────────────────────────────────────────

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  )
}

// ─── ReviewRow ────────────────────────────────────────────────────────────────

interface ReviewRowProps {
  item:     ReviewItem
  expanded: boolean
  onToggle: () => void
  onUpdate: (p: Partial<ReviewItem>) => void
  onRemove: () => void
}

function ReviewRow({ item, expanded, onToggle, onUpdate, onRemove }: ReviewRowProps) {
  const hasMath = item.mathMismatch
  const hasLow  = item.lowConf

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      hasMath ? 'border-red-200 bg-red-50/50' : hasLow ? 'border-amber-200 bg-amber-50/30' : 'border-black/[0.06] bg-white/60',
    )}>
      {/* Collapsed row */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {item.name || <span className="italic opacity-50">Unnamed item</span>}
            </span>
            {hasMath && <ConfBadge score={0.2} />}
            {!hasMath && hasLow && <ConfBadge score={0.5} />}
            {!hasMath && !hasLow && <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"><Check size={8} /> OK</span>}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {item.quantity} × {fmtRupees(item.unitPrice)} = {fmtRupees(item.lineTotal)}
          </p>
        </div>
        <button
          aria-label="Remove item"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Expanded edit fields */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <GlassInput
                  label="Item name"
                  value={item.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  placeholder="e.g. Masala Dosa"
                />
              </div>
              <GlassInput
                label="Quantity"
                type="number"
                min="1"
                value={String(item.quantity)}
                onChange={(e) => {
                  const qty = Math.max(1, parseInt(e.target.value) || 1)
                  const lt  = Math.round(qty * item.unitPrice * 100) / 100
                  onUpdate({ quantity: qty, lineTotal: lt })
                }}
              />
              <GlassInput
                label="Unit price (₹)"
                type="number"
                min="0"
                step="0.01"
                value={String(item.unitPrice)}
                onChange={(e) => {
                  const up = parseFloat(e.target.value) || 0
                  const lt = Math.round(item.quantity * up * 100) / 100
                  onUpdate({ unitPrice: up, lineTotal: lt })
                }}
              />
              <GlassInput
                label="Line total (₹)"
                type="number"
                min="0"
                step="0.01"
                value={String(item.lineTotal)}
                onChange={(e) => onUpdate({ lineTotal: parseFloat(e.target.value) || 0 })}
                className={hasMath ? 'border-red-300' : ''}
              />
            </div>
            {hasMath && (
              <p className="px-3 pb-2.5 text-xs text-red-600">
                ⚠ {item.quantity} × ₹{item.unitPrice} = ₹{Math.round(item.quantity * item.unitPrice * 100) / 100}, but line total is ₹{item.lineTotal}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── ChargesBlock ─────────────────────────────────────────────────────────────

interface ChargesBlockProps {
  subtotal:      number
  taxAmount:     string; setTaxAmount:     (v: string) => void
  serviceCharge: string; setServiceCharge: (v: string) => void
  discount:      string; setDiscount:      (v: string) => void
  grandTotal:    string | null; setGrandTotal: (v: string | null) => void
  computedTotal: number
  liveMatch:     boolean
  totalDiff:     number | null
}

function ChargesBlock({
  subtotal, taxAmount, setTaxAmount, serviceCharge, setServiceCharge,
  discount, setDiscount, grandTotal, setGrandTotal,
  computedTotal, liveMatch, totalDiff,
}: ChargesBlockProps) {
  return (
    <div className="rounded-xl border border-black/[0.06] p-3.5 flex flex-col gap-3" style={{ background: 'rgba(0,0,0,0.015)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        Charges &amp; Totals
      </p>

      {/* Subtotal (read-only) */}
      <div className="flex justify-between items-center">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtRupees(subtotal)}</span>
      </div>

      {/* Tax */}
      <div className="flex items-center gap-2">
        <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>Tax</span>
        <div className="w-32">
          <GlassInput label="" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
      </div>

      {/* Service charge */}
      <div className="flex items-center gap-2">
        <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>Service charge</span>
        <div className="w-32">
          <GlassInput label="" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
      </div>

      {/* Discount */}
      <div className="flex items-center gap-2">
        <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>Discount</span>
        <div className="w-32">
          <GlassInput label="" value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
      </div>

      {/* Divider */}
      <div className="h-px" style={{ background: 'rgba(0,0,0,0.06)' }} />

      {/* Grand total */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Grand Total</span>
        <div className="flex items-center gap-2">
          {grandTotal === null ? (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>not visible</span>
          ) : (
            <div className="w-32">
              <GlassInput
                label=""
                value={grandTotal}
                onChange={(e) => setGrandTotal(e.target.value)}
                type="number" min="0" step="0.01"
                className={(!liveMatch && totalDiff !== null && totalDiff > 0) ? 'border-amber-300' : ''}
              />
            </div>
          )}
          {grandTotal === null && (
            <GlassButton variant="ghost" size="sm" className="text-xs" onClick={() => setGrandTotal(String(computedTotal))}>
              Enter
            </GlassButton>
          )}
        </div>
      </div>

      {/* Computed total */}
      <div className={cn('flex justify-between items-center rounded-lg px-2.5 py-1.5', liveMatch ? 'bg-emerald-50' : 'bg-amber-50')}>
        <span className="text-xs" style={{ color: liveMatch ? '#059669' : '#d97706' }}>
          {liveMatch ? '✓ Computed total matches' : '⚠ Computed total'}
        </span>
        <span className={cn('text-sm font-bold tabular-nums', liveMatch ? 'text-emerald-700' : 'text-amber-700')}>
          {fmtRupees(computedTotal)}
        </span>
      </div>
      {!liveMatch && totalDiff !== null && totalDiff > 0 && (
        <p className="text-xs text-amber-600">
          Difference of {fmtRupees(totalDiff / 100)} — please check items or totals above.
        </p>
      )}
    </div>
  )
}
