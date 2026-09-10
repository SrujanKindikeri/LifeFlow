'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, X, Edit3, Trash2, Filter, Calendar,
  Wallet, TrendingUp, Users, ImageIcon, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Info, RefreshCw,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassSelect } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, SkeletonList } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { cn, formatCurrency, formatDate, EXPENSE_CATEGORIES, getTodayString } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'
import { ExpenseCalendar } from './ExpenseCalendar'
import { TransactionCapturePanel, detectProvider } from './TransactionCapturePanel'
import { ProofImageViewer } from './ProofImageViewer'
import type { CapturedImage } from './TransactionCapturePanel'
import type { ParsedTransaction } from '@/lib/transactionParser'
import type { Expense, TransactionCapture, TransactionReference, TransactionProofMeta, PaymentMethod } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpenseFormData {
  amount: string
  category: Expense['category']
  description: string
  date: string
  paymentMethod: string
  /** First transaction reference detected by OCR (UTR / UPI Txn ID / etc.) — editable. */
  transactionReference: string
}

const defaultForm: ExpenseFormData = {
  amount: '',
  category: 'food',
  description: '',
  date: getTodayString(),
  paymentMethod: '',
  transactionReference: '',
}

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({
  value: c.value,
  label: `${c.emoji} ${c.label}`,
}))

// Fields that OCR pre-filled — used to show ⚠ verify badge
type OcrFilledFields = Partial<Record<keyof ExpenseFormData, boolean>>

/**
 * Inline warning produced after OCR, shown in the Transaction Capture section.
 * 'received'  → money received, not an expense
 * 'failed'    → transaction failed
 * 'pending'   → transaction pending
 */
type CaptureWarning = 'received' | 'failed' | 'pending' | null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSelectedDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

function detectPaymentMethodFromParsed(parsed: ParsedTransaction | null): PaymentMethod | '' {
  if (!parsed) return ''
  const text = [parsed.upiId, parsed.bank, parsed.paidTo, parsed.receivedFrom]
    .filter(Boolean).join(' ').toLowerCase()
  if (parsed.upiId || text.includes('upi') || text.includes('@')) return 'upi'
  if (text.includes('cash')) return 'cash'
  if (text.includes('card') || text.includes('debit') || text.includes('credit')) return 'card'
  if (text.includes('net banking') || text.includes('neft') || text.includes('rtgs')) return 'net_banking'
  if (text.includes('wallet')) return 'wallet'
  return ''
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PersonalExpensesClient() {
  const searchParams   = useSearchParams()
  const draftIdParam   = searchParams.get('draftId') ?? undefined
  const openNew        = searchParams.get('new') === '1'

  const [expenses,       setExpenses]       = useState<Expense[]>([])
  const [loading,        setLoading]        = useState(true)
  const [isModalOpen,    setIsModalOpen]    = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteTarget,   setDeleteTarget]   = useState<Expense | null>(null)
  const [deleting,       setDeleting]       = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [form,           setForm]           = useState<ExpenseFormData>(defaultForm)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [showUnsaved,    setShowUnsaved]    = useState(false)
  const formRef = useRef<ExpenseFormData>(form)
  useEffect(() => { formRef.current = form }, [form])

  // Date filter
  const [dateFilter,   setDateFilter]   = useState<'all' | 'today' | 'week' | 'month' | 'custom' | 'calendar'>('month')
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarTriggerRef = useRef<HTMLButtonElement | null>(null)

  // ── Transaction Capture state ──────────────────────────────────────────────
  // Start expanded so the upload zone is immediately visible
  const [captureExpanded, setCaptureExpanded] = useState(true)
  // Which form fields OCR pre-filled (show ✓ detected badge)
  const [ocrFilled, setOcrFilled] = useState<OcrFilledFields>({})
  // Inline warning after OCR (received / failed / pending)
  const [captureWarning, setCaptureWarning] = useState<CaptureWarning>(null)
  // Pending capture data attached to the expense on save (proofs start with no fileId)
  const [pendingCapture, setPendingCapture] = useState<TransactionCapture | null>(null)
  // Compact summary shown after OCR fills form (confidence level)
  const [ocrConfidence, setOcrConfidence] = useState<'high' | 'partial' | 'low' | null>(null)
  // Duplicate-detection state
  const [dupWarning, setDupWarning] = useState<{ ref: string; expenseId: string } | null>(null)
  // Subscription-duplicate detection state (amount+date matches an auto-generated expense)
  const [subDupWarning, setSubDupWarning] = useState<{ subscriptionName: string; existingExpenseId: string } | null>(null)
  /**
   * Original File objects from TransactionCapturePanel, held here so handleSave
   * can upload them to /api/expenses/scan-upload right before the expense is
   * created.  Proof upload is deferred to save time so it never blocks OCR.
   */
  const capturedFilesRef = useRef<CapturedImage[]>([])

  // Proof viewer
  const [viewerFileId,   setViewerFileId]   = useState<string | null>(null)
  const [viewerFilename, setViewerFilename] = useState<string | undefined>()

  const { success, error: toastError } = useToast()
  const today = getTodayString()

  // ── Draft integration ──────────────────────────────────────────────────────
  const draft = useDraft({
    type: 'expense',
    initialDraftId: draftIdParam,
    getTitle:  () => formRef.current.description || `₹${formRef.current.amount} ${formRef.current.category}` || 'Expense Draft',
    getData:   () => ({
      ...formRef.current,
      // Also persist the transactionCapture so draft can be restored
      transactionCapture: pendingCaptureRef.current ?? undefined,
    }),
    hasMeaningfulData: () => Boolean(formRef.current.amount || formRef.current.description),
  })

  // Keep a ref for pendingCapture so useDraft's getData() callback always reads the latest
  const pendingCaptureRef = useRef<TransactionCapture | null>(null)
  useEffect(() => { pendingCaptureRef.current = pendingCapture }, [pendingCapture])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openNew) return
    if (draftIdParam) {
      fetch(`/api/drafts/${draftIdParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.draft?.data) {
            const data = d.draft.data as Partial<ExpenseFormData & { transactionCapture?: TransactionCapture }>
            setForm({
              amount:               data.amount ?? '',
              category:             (data.category ?? 'food') as Expense['category'],
              description:          data.description ?? '',
              date:                 data.date ?? today,
              paymentMethod:        data.paymentMethod ?? '',
              transactionReference: data.transactionReference ?? '',
            })
            if (data.transactionCapture) {
              setPendingCapture(data.transactionCapture)
            }
          }
          setEditingExpense(null); setIsModalOpen(true)
        })
        .catch(() => { setEditingExpense(null); setForm(defaultForm); setIsModalOpen(true) })
    } else {
      setEditingExpense(null); setForm(defaultForm); setIsModalOpen(true)
    }
  }, [openNew])

  function handleModalClose() {
    if (!editingExpense && draft.hasMeaningfulData()) { setShowUnsaved(true) } else { closeModal() }
  }

  function closeModal() {
    setIsModalOpen(false)
    setCaptureExpanded(false)
    setCaptureWarning(null)
    setOcrFilled({})
    setOcrConfidence(null)
    setPendingCapture(null)
    setDupWarning(null)
    setSubDupWarning(null)
    capturedFilesRef.current = []
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  function getDateRange(): { from: string; to: string } | null {
    if (dateFilter === 'all')   return null
    if (dateFilter === 'today') return { from: today, to: today }
    if (dateFilter === 'week') {
      const d = new Date(); const day = d.getDay()
      const daysToMon = day === 0 ? 6 : day - 1
      const mon = new Date(d); mon.setDate(d.getDate() - daysToMon)
      return { from: mon.toISOString().split('T')[0], to: today }
    }
    if (dateFilter === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
    if (dateFilter === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo }
    if (dateFilter === 'calendar' && selectedDate) return { from: selectedDate, to: selectedDate }
    return null
  }

  function getWeekStart(): string {
    const d = new Date(); const day = d.getDay()
    const daysToMon = day === 0 ? 6 : day - 1
    const mon = new Date(d); mon.setDate(d.getDate() - daysToMon)
    return mon.toISOString().split('T')[0]
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/expenses?limit=500&source=all')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setExpenses(data.expenses ?? [])
    } catch { toastError('Failed to load personal spending') }
    finally { setLoading(false) }
  }, [toastError])

  useEffect(() => { void fetchExpenses() }, [fetchExpenses])

  // ── Filter ────────────────────────────────────────────────────────────────
  const range     = getDateRange()
  const weekStart = getWeekStart()

  const filtered = expenses
    .filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (range && (e.date < range.from || e.date > range.to)) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (e.description ?? '').toLowerCase().includes(q) || e.category.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  const todayTotal    = expenses.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0)
  const weekTotal     = expenses.filter((e) => e.date >= weekStart && e.date <= today).reduce((s, e) => s + e.amount, 0)
  const monthTotal    = expenses.filter((e) => e.date.startsWith(today.slice(0, 7))).reduce((s, e) => s + e.amount, 0)
  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0)

  // ── Calendar ──────────────────────────────────────────────────────────────
  function handleCalendarSelect(date: string) { setSelectedDate(date); setDateFilter('calendar'); setCalendarOpen(false) }
  function clearCalendarDate()                { setSelectedDate(null); setDateFilter('month') }
  function handleDateChipClick(f: 'all' | 'today' | 'week' | 'month' | 'custom') { setDateFilter(f); setSelectedDate(null) }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  function openCreate() {
    setEditingExpense(null)
    setForm({ ...defaultForm, date: today })
    setCaptureExpanded(true)     // open so the upload zone is immediately visible
    setCaptureWarning(null)
    setOcrFilled({})
    setOcrConfidence(null)
    setPendingCapture(null)
    setDupWarning(null)
    setSubDupWarning(null)
    capturedFilesRef.current = []
    setIsModalOpen(true)
  }

  function openEdit(expense: Expense) {
    if (expense.source === 'group_bill') { toastError('Edit this expense from the Group Bills tab.'); return }
    setEditingExpense(expense)
    setForm({
      amount:               String(expense.amount),
      category:             expense.category,
      description:          expense.description ?? '',
      date:                 expense.date,
      paymentMethod:        expense.paymentMethod ?? '',
      transactionReference: expense.transactionCapture?.references?.[0]?.value ?? '',
    })
    setCaptureExpanded(false)
    setCaptureWarning(null)
    setOcrFilled({})
    setOcrConfidence(null)
    setPendingCapture(null)
    setDupWarning(null)
    setSubDupWarning(null)
    capturedFilesRef.current = []
    setIsModalOpen(true)
  }

  async function handleSave(forceAdd = false) {
    const amount = parseFloat(form.amount)
    if (!form.amount || isNaN(amount) || amount <= 0) { toastError('Enter a valid amount'); return }
    if (!form.date) { toastError('Date is required'); return }

    // ── Duplicate reference check (create mode only) ───────────────────────
    if (!editingExpense && !forceAdd && form.transactionReference.trim()) {
      const refVal = form.transactionReference.trim().toLowerCase()
      const duplicate = expenses.find((e) => {
        const refs = e.transactionCapture?.references ?? []
        return refs.some((r) => r.value.toLowerCase() === refVal)
      })
      if (duplicate) {
        setDupWarning({ ref: form.transactionReference.trim(), expenseId: duplicate._id })
        return
      }
    }

    // ── Subscription duplicate check (create mode only) ────────────────────
    // Warn if a manually-entered expense looks like a duplicate of an
    // auto-generated subscription expense for the same date/amount.
    if (!editingExpense && !forceAdd) {
      const amt = parseFloat(form.amount)
      const subDup = expenses.find(
        (e) =>
          e.source === 'subscription' &&
          e.date === form.date &&
          Math.abs(e.amount - amt) < 1
      )
      if (subDup) {
        setSubDupWarning({
          subscriptionName: subDup.description ?? 'Subscription',
          existingExpenseId: subDup._id,
        })
        return
      }
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        amount,
        category: form.category,
        description: form.description.trim() || undefined,
        date: form.date,
        paymentMethod: form.paymentMethod || undefined,
      }

      // ── Upload proof images at save time ─────────────────────────────────
      // capturedFilesRef holds the original File objects from the panel.
      // We upload each one now to get a permanent fileId, then stitch the
      // resulting metadata into the transactionCapture before saving.
      if (!editingExpense && pendingCapture && capturedFilesRef.current.length > 0) {
        const uploadedProofs: TransactionProofMeta[] = []

        for (const img of capturedFilesRef.current) {
          try {
            const fd = new FormData()
            fd.append('image', img.file, img.filename)
            const res = await fetch('/api/expenses/scan-upload', { method: 'POST', body: fd })
            if (res.ok) {
              const data = await res.json() as {
                fileId: string; filename: string; mimeType: string; sizeBytes: number
              }
              uploadedProofs.push({
                fileId:     data.fileId,
                filename:   data.filename,
                mimeType:   data.mimeType,
                sizeBytes:  data.sizeBytes,
                uploadedAt: new Date().toISOString(),
              })
            }
            // If upload fails for one image, continue — partial proof is fine
          } catch {
            // Non-fatal: expense still saves without this proof
          }
        }

        // Replace placeholder proofs with real uploaded ones
        const captureWithProofs: TransactionCapture = {
          ...pendingCapture,
          proofs: uploadedProofs.length > 0 ? uploadedProofs : (pendingCapture.proofs ?? []),
        }
        payload.transactionCapture = captureWithProofs
      } else if (!editingExpense && pendingCapture) {
        // pendingCapture may already have proofs from a previous save (draft restore)
        payload.transactionCapture = pendingCapture
      }

      if (editingExpense) {
        const res = await fetch(`/api/expenses/${editingExpense._id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setExpenses((prev) => prev.map((e) => e._id === editingExpense._id ? data.expense : e))
        success('Expense updated')
      } else {
        const res = await fetch('/api/expenses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setExpenses((prev) => [data.expense, ...prev])
        await draft.deleteDraft()
        const hasProof = (payload.transactionCapture as TransactionCapture | undefined)?.proofs?.length ?? 0
        success(hasProof > 0 ? 'Expense added with transaction proof' : 'Expense added')
      }
      closeModal()
    } catch { toastError('Failed to save expense') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/expenses/${deleteTarget._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setExpenses((prev) => prev.filter((e) => e._id !== deleteTarget._id))
      success('Expense deleted'); setDeleteTarget(null)
    } catch { toastError('Failed to delete expense') }
    finally { setDeleting(false) }
  }

  // ── OCR fill-from-capture ─────────────────────────────────────────────────
  /**
   * Called by TransactionCapturePanel when the user clicks "Read Transaction".
   * Populates the main form with detected values and shows inline warnings.
   * The user reviews everything before clicking Add Expense.
   *
   * NOTE: `images` carry the original File objects but have no `fileId` yet.
   * fileIds are assigned when the expense is saved (handleSave uploads proofs
   * to /api/expenses/scan-upload and stitches the resulting fileIds in).
   */
  function handleFillFromCapture(parsed: ParsedTransaction | null, images: CapturedImage[]) {
    // Collapse the panel once OCR is done (success or failure) so the
    // user can see the populated form fields above.
    setCaptureExpanded(false)

    // Keep the File objects for proof upload at save time
    capturedFilesRef.current = images.filter((i) => i.status === 'done')

    // Build placeholder proof metadata — no fileId yet (assigned at save time)
    const proofs: TransactionProofMeta[] = capturedFilesRef.current.map((i) => ({
      fileId:     '',           // placeholder; replaced by handleSave
      filename:   i.filename,
      mimeType:   i.mimeType,
      sizeBytes:  i.sizeBytes,
      uploadedAt: new Date().toISOString(),
    }))

    // If OCR completely failed, still attach proof but leave form alone
    if (!parsed) {
      const noParseCapture: TransactionCapture = {
        currency:         'INR',
        references:       [],
        extractedAt:      new Date().toISOString(),
        extractionMethod: 'ocr_text',
        multipleDetected: false,
        lowConfidence:    true,
        proofs,
      }
      setPendingCapture(proofs.length > 0 ? noParseCapture : null)
      setOcrFilled({})
      setOcrConfidence(null)
      setCaptureWarning(null)
      toastError("Couldn't read the transaction details. You can still enter them manually.")
      draft.triggerAutosave()
      return
    }

    // ── Direction warning: received money ────────────────────────────────────
    if (parsed.direction === 'received') {
      // Build the capture object first
      const captureForWarning: TransactionCapture = {
        amountMinor:      parsed.amountRupees != null ? Math.round(parsed.amountRupees * 100) : undefined,
        currency:         parsed.currency ?? 'INR',
        direction:        parsed.direction,
        status:           parsed.status,
        paidTo:           parsed.paidTo,
        receivedFrom:     parsed.receivedFrom,
        upiId:            parsed.upiId,
        phoneNumber:      parsed.phoneNumber,
        bank:             parsed.bank,
        provider:         detectProvider(parsed),
        references:       parsed.references ?? [],
        transactionDate:  parsed.transactionDate,
        transactionTime:  parsed.transactionTime,
        extractedAt:      new Date().toISOString(),
        extractionMethod: 'ocr_text',
        multipleDetected: parsed.multipleDetected,
        lowConfidence:    parsed.lowConfidence,
        proofs,
      }
      setPendingCapture(captureForWarning)
      // IMPORTANT: still fill the form so the user doesn't have to re-enter
      // everything if they choose "Continue as Expense Anyway".
      doFillForm(parsed, proofs)
      setCaptureWarning('received')
      setCaptureExpanded(true)   // re-open panel to show warning
      return
    }

    // ── Status warnings: failed / pending ────────────────────────────────────
    if (parsed.status === 'failed' || parsed.status === 'declined') {
      // Still fill the form — user may want to review and save manually
      doFillForm(parsed, proofs)
      setCaptureWarning('failed')
      setCaptureExpanded(true)
      return
    }

    if (parsed.status === 'pending') {
      setCaptureWarning('pending')
      setCaptureExpanded(true)
    }

    // ── Normal flow: fill the form ───────────────────────────────────────────
    doFillForm(parsed, proofs)
  }

  /** Shared form-fill logic (also called when user overrides the received warning). */
  function doFillForm(parsed: ParsedTransaction, proofs: TransactionProofMeta[]) {
    const filled: OcrFilledFields = {}

    // Build the extracted values up-front (no closure over `form` state here)
    const newAmount    = parsed.amountRupees != null ? String(parsed.amountRupees) : ''
    const newDate      = parsed.transactionDate ?? ''
    // Prefer paidTo for expense description; fall back to receivedFrom with a prefix
    const newDesc      = parsed.paidTo
      ? parsed.paidTo
      : parsed.receivedFrom
        ? `From: ${parsed.receivedFrom}`
        : ''
    const newMethod    = detectPaymentMethodFromParsed(parsed)
    // Use the highest-priority reference (UTR first, then UPI txn ID, then others)
    const REF_PRIORITY: Record<string, number> = {
      UTR: 1, UPI_TRANSACTION_ID: 2, UPI_REF: 3, TRANSACTION_ID: 4, REFERENCE_NUMBER: 5, OTHER: 6,
    }
    const sortedRefs   = [...(parsed.references ?? [])].sort(
      (a, b) => (REF_PRIORITY[a.type] ?? 9) - (REF_PRIORITY[b.type] ?? 9)
    )
    const newRef       = sortedRefs[0]?.value ?? ''

    if (newAmount)  filled.amount = true
    if (newDate)    filled.date   = true
    if (newDesc)    filled.description = true
    if (newMethod)  filled.paymentMethod = true
    if (newRef)     filled.transactionReference = true

    // Use a functional updater so we always merge into the *latest* form state,
    // never a stale closure snapshot. Only fill fields where OCR found a value;
    // leave existing user-typed values for fields OCR couldn't detect.
    setForm((prev) => ({
      ...prev,
      amount:               newAmount  || prev.amount,
      description:          newDesc    || prev.description,
      date:                 newDate    || prev.date,
      paymentMethod:        newMethod  || prev.paymentMethod,
      transactionReference: newRef     || prev.transactionReference,
      // category is intentionally never auto-set
    }))

    setOcrFilled(filled)
    setOcrConfidence(parsed.confidence)

    const capture: TransactionCapture = {
      amountMinor:      parsed.amountRupees != null ? Math.round(parsed.amountRupees * 100) : undefined,
      currency:         parsed.currency ?? 'INR',
      direction:        parsed.direction,
      status:           parsed.status,
      paidTo:           parsed.paidTo,
      receivedFrom:     parsed.receivedFrom,
      upiId:            parsed.upiId,
      phoneNumber:      parsed.phoneNumber,
      bank:             parsed.bank,
      provider:         detectProvider(parsed),
      references:       parsed.references ?? [],
      transactionDate:  parsed.transactionDate,
      transactionTime:  parsed.transactionTime,
      extractedAt:      new Date().toISOString(),
      extractionMethod: 'ocr_text',
      multipleDetected: parsed.multipleDetected,
      lowConfidence:    parsed.lowConfidence,
      proofs,
    }
    setPendingCapture(capture)
    draft.triggerAutosave()
  }

  // ── Proof viewer ──────────────────────────────────────────────────────────
  function openProofViewer(fileId: string, filename?: string) {
    setViewerFileId(fileId); setViewerFilename(filename)
  }
  function closeProofViewer() { setViewerFileId(null); setViewerFilename(undefined) }

  // ── Grouping ──────────────────────────────────────────────────────────────
  const grouped: Record<string, Expense[]> = {}
  for (const e of filtered) {
    if (!grouped[e.date]) grouped[e.date] = []
    grouped[e.date].push(e)
  }
  const sortedDates    = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  const isCalendarActive = dateFilter === 'calendar' && !!selectedDate

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Personal Spending</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Your individual expenses</p>
        </div>
        <GlassButton variant="primary" onClick={openCreate} className="gap-1.5">
          <Plus size={15} />
          <span className="hidden sm:inline">Add Expense</span>
          <span className="sm:hidden">Add</span>
        </GlassButton>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Today',      value: todayTotal,  icon: <Calendar size={14} />,   color: 'text-sky-400'     },
          { label: 'This Week',  value: weekTotal,   icon: <TrendingUp size={14} />, color: 'text-violet-400'  },
          { label: 'This Month', value: monthTotal,  icon: <Wallet size={14} />,     color: 'text-emerald-400' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="glass rounded-2xl p-3 sm:p-4">
            <div className={cn('flex items-center gap-1.5 mb-1.5', color)}>
              {icon}
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
            </div>
            <p className="text-base sm:text-lg font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input
              className="glass-input w-full rounded-xl pl-9 pr-9 py-2.5 text-sm"
              placeholder="Search personal spending..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-80" style={{ color: 'var(--text-faint)' }} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>

          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="glass-input rounded-xl px-3 py-2 text-xs appearance-none" style={{ color: 'var(--text-secondary)' }} aria-label="Filter by category">
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
          </select>

          <div className="relative">
            <button
              ref={calendarTriggerRef}
              onClick={() => setCalendarOpen((o) => !o)}
              aria-label="Open expense calendar"
              aria-expanded={calendarOpen}
              aria-haspopup="dialog"
              className={cn('h-full px-3 rounded-xl transition-colors border text-sm focus-ring flex items-center gap-1.5',
                isCalendarActive ? 'bg-indigo-500/12 text-indigo-600 border-indigo-500/25' : calendarOpen ? 'bg-black/[0.05] border-black/[0.09]' : 'glass hover:bg-black/[0.04]')}
              style={!isCalendarActive && !calendarOpen ? { color: 'var(--text-secondary)' } : {}}
            >
              <Calendar size={14} />
              <span className="hidden sm:inline text-xs font-medium">{isCalendarActive ? 'Date' : 'Browse'}</span>
            </button>
            <div className="sm:relative">
              <ExpenseCalendar selectedDate={selectedDate} onSelectDate={handleCalendarSelect} triggerRef={calendarTriggerRef} isOpen={calendarOpen} onClose={() => setCalendarOpen(false)} />
            </div>
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap items-center">
          {(['all', 'today', 'week', 'month', 'custom'] as const).map((f) => (
            <button key={f} onClick={() => handleDateChipClick(f)}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors', dateFilter === f ? 'bg-indigo-500/12 text-indigo-600 border border-indigo-500/25' : 'glass hover:bg-black/[0.04]')}
              style={dateFilter !== f ? { color: 'var(--text-secondary)' } : {}}
            >
              {f === 'week' ? 'This week' : f === 'month' ? 'This month' : f}
            </button>
          ))}

          {isCalendarActive && selectedDate && (
            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.15 }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border"
              style={{ background: 'rgba(37,99,235,0.10)', borderColor: 'rgba(37,99,235,0.22)', color: 'var(--accent)' }}
            >
              <Calendar size={11} />
              <span>{formatSelectedDate(selectedDate)}</span>
              <button onClick={clearCalendarDate} aria-label="Clear selected date" className="ml-0.5 hover:opacity-70 transition-opacity"><X size={11} /></button>
            </motion.div>
          )}
        </div>

        {dateFilter === 'custom' && (
          <div className="flex gap-2 items-center">
            <GlassInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="text-xs" aria-label="Custom range start date" />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>to</span>
            <GlassInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="text-xs" aria-label="Custom range end date" />
          </div>
        )}
      </div>

      {/* Selected-date banner */}
      <AnimatePresence>
        {isCalendarActive && selectedDate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="glass-elevated rounded-2xl px-4 py-3.5 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Calendar size={13} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatSelectedDate(selectedDate)}</span>
                {selectedDate === today && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider" style={{ background: 'rgba(37,99,235,0.10)', color: 'var(--accent)' }}>Today</span>}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {filtered.length > 0 ? `${filtered.length} expense${filtered.length !== 1 ? 's' : ''}` : 'No expenses on this day'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {filtered.length > 0 && <span className="text-base font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totalFiltered)}</span>}
              <button onClick={clearCalendarDate} className="text-xs px-2.5 py-1 rounded-lg glass hover:bg-black/[0.05] transition-colors" style={{ color: 'var(--text-muted)' }}>Clear date</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expense list */}
      {loading ? (
        <SkeletonList lines={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={isCalendarActive ? '📅' : '💸'}
          title={isCalendarActive ? `No expenses on ${formatSelectedDate(selectedDate!)}` : searchQuery || categoryFilter !== 'all' ? 'No expenses match your filters' : 'No personal expenses yet'}
          description={isCalendarActive ? undefined : !searchQuery && categoryFilter === 'all' ? 'Start tracking your spending by adding your first expense.' : undefined}
          action={
            (isCalendarActive || (!searchQuery && categoryFilter === 'all'))
              ? <GlassButton variant="primary" size="sm" onClick={openCreate}><Plus size={14} /> Add Expense</GlassButton>
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <AnimatePresence mode="popLayout">
            {sortedDates.map((date) => {
              const dayExpenses = grouped[date]
              const dayTotal    = dayExpenses.reduce((s, e) => s + e.amount, 0)
              const isToday     = date === today
              return (
                <motion.div key={date} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{isToday ? 'Today' : formatDate(date)}</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(dayTotal)}</span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {dayExpenses.map((expense) => {
                      const cat             = EXPENSE_CATEGORIES.find((c) => c.value === expense.category)
                      const isFromGroupBill = expense.source === 'group_bill'
                      const isFromSub       = expense.source === 'subscription'
                      const hasProof        = (expense.transactionCapture?.proofs?.length ?? 0) > 0
                      const firstProof      = expense.transactionCapture?.proofs?.[0]

                      return (
                        <motion.div key={expense._id} layout className="group glass rounded-xl flex items-center gap-3 px-3.5 py-3 hover:bg-white/[0.07] transition-colors">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${cat?.color ?? '#6b7280'}18` }}>
                            {cat?.emoji ?? '📦'}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                {expense.description || cat?.label || expense.category}
                              </p>
                              {isFromGroupBill && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 shrink-0">
                                  <Users size={9} /> Group share
                                </span>
                              )}
                              {isFromSub && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full shrink-0 cursor-default"
                                  title={`Auto-generated from subscription${expense.subscriptionBillingDate ? ` · Billing: ${expense.subscriptionBillingDate}` : ''}`}
                                  style={{ background: 'rgba(14,165,233,0.12)', color: '#0369a1', border: '1px solid rgba(14,165,233,0.2)' }}
                                >
                                  <RefreshCw size={9} /> Subscription
                                </span>
                              )}
                              {hasProof && firstProof && (
                                <button
                                  type="button"
                                  title="View transaction proof"
                                  aria-label="View transaction screenshot"
                                  onClick={(e) => { e.stopPropagation(); openProofViewer(firstProof.fileId, firstProof.filename) }}
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors hover:bg-indigo-500/10 shrink-0"
                                  style={{ borderColor: 'rgba(99,102,241,0.25)', color: 'var(--accent)' }}
                                >
                                  <ImageIcon size={9} />
                                  <span>Proof</span>
                                </button>
                              )}
                            </div>
                            <p className="text-[11px] capitalize" style={{ color: 'var(--text-muted)' }}>
                              {cat?.label ?? expense.category}
                              {expense.paymentMethod && (
                                <span style={{ color: 'var(--text-faint)' }}> · {expense.paymentMethod.replace('_', ' ').toUpperCase()}</span>
                              )}
                            </p>
                          </div>

                          <span className="text-sm font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                            {formatCurrency(expense.amount)}
                          </span>

                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            {!isFromGroupBill && (
                              <button onClick={() => openEdit(expense)} className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors" style={{ color: 'var(--text-faint)' }} title="Edit expense">
                                <Edit3 size={12} />
                              </button>
                            )}
                            <button onClick={() => setDeleteTarget(expense)} className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors" style={{ color: 'var(--text-faint)' }} title={isFromGroupBill ? 'Remove group-bill share' : 'Delete expense'}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          <div className="glass rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {filtered.length} expense{filtered.length !== 1 ? 's' : ''}
              {dateFilter !== 'all' && <span style={{ color: 'var(--text-faint)' }}> · filtered view</span>}
            </span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              <Filter size={12} className="inline mr-1" style={{ color: 'var(--text-faint)' }} />
              {formatCurrency(totalFiltered)}
            </span>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <Modal isOpen={isModalOpen} onClose={handleModalClose} title={editingExpense ? 'Edit Expense' : 'Add Personal Expense'} size="md">
        <div className="flex flex-col gap-4">

          {/* OCR confidence banner — shown after image reading */}
          {!editingExpense && ocrConfidence && (
            <OcrBanner
              confidence={ocrConfidence}
              hasProof={!!(pendingCapture?.proofs?.length)}
            />
          )}

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Amount</label>
              {ocrFilled.amount && <VerifyBadge />}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>₹</span>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]{0,2}"
                placeholder="0.00"
                className="glass-input w-full rounded-xl pl-8 pr-3.5 py-2.5 text-sm"
                value={form.amount}
                onChange={(e) => {
                  // Allow only valid numeric input; strip non-numeric except single dot
                  const raw = e.target.value.replace(/[^0-9.]/g, '')
                  const parts = raw.split('.')
                  const cleaned = parts.length > 2
                    ? parts[0] + '.' + parts.slice(1).join('')
                    : raw
                  setForm((f) => ({ ...f, amount: cleaned }))
                  setOcrFilled((f) => ({ ...f, amount: false }))
                  setDupWarning(null)
                  if (!editingExpense) draft.triggerAutosave()
                }}
                autoFocus
              />
            </div>
          </div>

          {/* Category — never auto-filled by OCR */}
          <GlassSelect
            label="Category"
            value={form.category}
            onChange={(v) => { setForm((f) => ({ ...f, category: v as Expense['category'] })); if (!editingExpense) draft.triggerAutosave() }}
            options={CATEGORY_OPTIONS}
          />

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Description (optional)</label>
              {ocrFilled.description && <VerifyBadge />}
            </div>
            <GlassInput
              placeholder="What was it for?"
              value={form.description}
              onChange={(e) => {
                setForm((f) => ({ ...f, description: e.target.value }))
                setOcrFilled((f) => ({ ...f, description: false }))
                if (!editingExpense) draft.triggerAutosave()
              }}
            />
          </div>

          {/* Date + Payment Method */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Date</label>
                {ocrFilled.date && <VerifyBadge />}
              </div>
              <GlassInput
                type="date"
                value={form.date}
                onChange={(e) => {
                  setForm((f) => ({ ...f, date: e.target.value }))
                  setOcrFilled((f) => ({ ...f, date: false }))
                  if (!editingExpense) draft.triggerAutosave()
                }}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Payment Method</label>
                {ocrFilled.paymentMethod && <VerifyBadge />}
              </div>
              <GlassSelect
                value={form.paymentMethod}
                onChange={(v) => {
                  setForm((f) => ({ ...f, paymentMethod: v }))
                  setOcrFilled((f) => ({ ...f, paymentMethod: false }))
                  if (!editingExpense) draft.triggerAutosave()
                }}
                options={[
                  { value: '',            label: 'Select…'     },
                  { value: 'upi',         label: 'UPI'         },
                  { value: 'cash',        label: 'Cash'        },
                  { value: 'card',        label: 'Card'        },
                  { value: 'net_banking', label: 'Net Banking' },
                  { value: 'wallet',      label: 'Wallet'      },
                  { value: 'other',       label: 'Other'       },
                ]}
              />
            </div>
          </div>

          {/* Transaction Reference — editable, OCR-filled when detected */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Transaction Reference <span className="font-normal text-xs" style={{ color: 'var(--text-faint)' }}>(optional)</span>
              </label>
              {ocrFilled.transactionReference && <VerifyBadge />}
            </div>
            <GlassInput
              placeholder="UTR / UPI Transaction ID"
              value={form.transactionReference}
              onChange={(e) => {
                setForm((f) => ({ ...f, transactionReference: e.target.value }))
                setOcrFilled((f) => ({ ...f, transactionReference: false }))
                setDupWarning(null)
                if (!editingExpense) draft.triggerAutosave()
              }}
            />
          </div>

          {/* ── Transaction Capture (create mode only) ──────────────────────── */}
          {!editingExpense && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {/* Accordion header */}
              <button
                type="button"
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
                onClick={() => setCaptureExpanded((v) => !v)}
                aria-expanded={captureExpanded}
              >
                <div className="flex items-center gap-2">
                  <ImageIcon size={14} style={{ color: captureExpanded ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <span className="text-xs font-semibold" style={{ color: captureExpanded ? 'var(--accent)' : 'var(--text-muted)' }}>
                    Transaction Capture
                  </span>
                  {pendingCapture && (pendingCapture.proofs?.length ?? 0) > 0 && !captureExpanded && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(22,163,74,0.12)', color: '#15803d' }}>
                      ✓ {pendingCapture.proofs!.length} screenshot{pendingCapture.proofs!.length !== 1 ? 's' : ''} attached
                    </span>
                  )}
                  {!pendingCapture && !captureExpanded && (
                    <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      Upload or paste a UPI/payment screenshot — auto-fills the form
                    </span>
                  )}
                </div>
                {captureExpanded
                  ? <ChevronUp size={14} style={{ color: 'var(--text-faint)' }} />
                  : <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} />}
              </button>

              <AnimatePresence initial={false}>
                {captureExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden', borderTop: '1px solid var(--border)' }}
                  >
                    <div className="p-3.5 flex flex-col gap-3">

                      {/* ── Received-money warning ──────────────────────── */}
                      {captureWarning === 'received' && (
                        <div className="rounded-xl p-3.5 flex flex-col gap-3" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle size={15} style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }} />
                            <div>
                              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                This screenshot appears to show money received.
                              </p>
                              {pendingCapture?.amountMinor != null && (
                                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                  ₹{(pendingCapture.amountMinor / 100).toFixed(2)}
                                  {pendingCapture.receivedFrom ? ` from ${pendingCapture.receivedFrom}` : ''}
                                </p>
                              )}
                              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                Received money is not a personal expense. What would you like to do?
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <GlassButton
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                toastError('Open Money Tracker to record money received from a person.')
                                setCaptureWarning(null)
                                setCaptureExpanded(false)
                              }}
                            >
                              Add to Money Tracker
                            </GlassButton>
                            <GlassButton
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                // User explicitly overrides — fill the form anyway
                                if (pendingCapture) {
                                  // Re-derive a ParsedTransaction-like object from pendingCapture to reuse doFillForm
                                  const fakeProofs = (pendingCapture.proofs ?? []) as TransactionProofMeta[]
                                  const fakeParsed: ParsedTransaction = {
                                    amountRupees:     pendingCapture.amountMinor != null ? pendingCapture.amountMinor / 100 : undefined,
                                    amountRaw:        pendingCapture.amountMinor != null ? String(pendingCapture.amountMinor / 100) : undefined,
                                    currency:         pendingCapture.currency ?? 'INR',
                                    direction:        pendingCapture.direction,
                                    status:           pendingCapture.status,
                                    paidTo:           pendingCapture.paidTo,
                                    receivedFrom:     pendingCapture.receivedFrom,
                                    upiId:            pendingCapture.upiId,
                                    phoneNumber:      pendingCapture.phoneNumber,
                                    bank:             pendingCapture.bank,
                                    references:       (pendingCapture.references ?? []) as TransactionReference[],
                                    transactionDate:  pendingCapture.transactionDate,
                                    transactionTime:  pendingCapture.transactionTime,
                                    multipleDetected: pendingCapture.multipleDetected ?? false,
                                    lowConfidence:    pendingCapture.lowConfidence ?? false,
                                    confidence:       'low',
                                  }
                                  setCaptureWarning(null)
                                  setCaptureExpanded(false)
                                  doFillForm(fakeParsed, fakeProofs)
                                }
                              }}
                            >
                              Continue as Expense Anyway
                            </GlassButton>
                          </div>
                        </div>
                      )}

                      {/* ── Failed transaction warning ──────────────────── */}
                      {captureWarning === 'failed' && (
                        <div className="rounded-xl p-3.5 flex flex-col gap-3" style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.18)' }}>
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle size={15} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                            <div>
                              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Transaction appears to have failed.
                              </p>
                              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                The screenshot suggests this payment was unsuccessful. Review manually before saving.
                              </p>
                            </div>
                          </div>
                          <GlassButton variant="secondary" size="sm" onClick={() => { setCaptureWarning(null); setCaptureExpanded(false) }}>
                            Review Manually
                          </GlassButton>
                        </div>
                      )}

                      {/* ── Pending transaction warning ─────────────────── */}
                      {captureWarning === 'pending' && (
                        <div className="rounded-xl p-3 flex items-start gap-2.5" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.18)' }}>
                          <Info size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                          <p className="text-xs" style={{ color: '#92400e' }}>
                            Transaction appears to be pending. Verify before saving as an expense.
                          </p>
                        </div>
                      )}

                      {/* The actual upload panel */}
                      <TransactionCapturePanel
                        onFillFromCapture={handleFillFromCapture}
                        onViewImage={(fileId, filename) => openProofViewer(fileId, filename)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Extracted transaction details (after OCR fills the form) */}
          {!editingExpense && pendingCapture && !captureExpanded && (
            <ExtractedSummary
              capture={pendingCapture}
              onViewProof={(fileId, filename) => openProofViewer(fileId, filename)}
            />
          )}

          {/* ── Subscription duplicate warning ────────────────────────────── */}
          {subDupWarning && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-3.5 flex flex-col gap-3"
              style={{ background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.22)' }}
            >
              <div className="flex items-start gap-2.5">
                <RefreshCw size={14} style={{ color: '#0369a1', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Possible duplicate subscription expense
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    <strong>{subDupWarning.subscriptionName}</strong> · ₹{parseFloat(form.amount).toLocaleString('en-IN')} · {form.date}
                    <br />An auto-generated expense already exists for this subscription on this date.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <GlassButton
                  variant="secondary"
                  size="sm"
                  onClick={() => { setSubDupWarning(null); closeModal() }}
                >
                  Remove Duplicate
                </GlassButton>
                <GlassButton
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSubDupWarning(null); void handleSave(true) }}
                >
                  Keep Both
                </GlassButton>
              </div>
            </motion.div>
          )}

          {/* ── Duplicate transaction warning ────────────────────────────────── */}
          {dupWarning && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-3.5 flex flex-col gap-3"
              style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)' }}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Possible duplicate transaction
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Reference <span className="font-mono">{dupWarning.ref}</span> already exists in your expenses.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <GlassButton
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // Scroll to / highlight the existing expense — for now just dismiss
                    setDupWarning(null)
                    closeModal()
                  }}
                >
                  View Existing
                </GlassButton>
                <GlassButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDupWarning(null)
                    void handleSave(true)
                  }}
                >
                  Add Anyway
                </GlassButton>
              </div>
            </motion.div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            {!editingExpense && <SaveDraftStatus status={draft.saveStatus} />}
            <div className="flex gap-2 ml-auto">
              {!editingExpense && (
                <GlassButton variant="secondary" size="sm" onClick={() => draft.saveDraft()}>Save Draft</GlassButton>
              )}
              <GlassButton variant="secondary" onClick={handleModalClose}>Cancel</GlassButton>
              <GlassButton variant="primary" onClick={() => void handleSave()} loading={saving}>
                {editingExpense ? 'Save Changes' : 'Add Expense'}
              </GlassButton>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Proof Image Viewer ─────────────────────────────────────────────── */}
      <ProofImageViewer
        isOpen={!!viewerFileId}
        fileId={viewerFileId}
        filename={viewerFilename}
        onClose={closeProofViewer}
      />

      {/* Unsaved changes */}
      <UnsavedChangesDialog
        isOpen={showUnsaved}
        onContinueEditing={() => setShowUnsaved(false)}
        onSaveAsDraft={async () => { await draft.saveDraft(); setShowUnsaved(false); closeModal() }}
        onDiscard={() => { draft.deleteDraft(); setShowUnsaved(false); closeModal() }}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Expense"
        message={
          deleteTarget?.source === 'group_bill'
            ? `Remove your group-bill share of ${formatCurrency(deleteTarget.amount ?? 0)} from personal spending? The original group bill will not be affected.`
            : `Delete ${deleteTarget?.description || EXPENSE_CATEGORIES.find((c) => c.value === deleteTarget?.category)?.label} — ${formatCurrency(deleteTarget?.amount ?? 0)}?`
        }
        confirmLabel="Delete"
        danger
        loading={deleting}
      />
    </div>
  )
}

// ─── Reference label map ──────────────────────────────────────────────────────

const REF_LABELS: Record<string, string> = {
  UTR:               'UTR',
  UPI_REF:           'UPI Ref No.',
  UPI_TRANSACTION_ID:'UPI Transaction ID',
  TRANSACTION_ID:    'Transaction ID',
  REFERENCE_NUMBER:  'Reference No.',
  OTHER:             'Reference',
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

/** ✓ badge shown next to a label when OCR pre-filled that field */
function VerifyBadge() {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
      title="Detected from screenshot — please verify"
      style={{ background: 'rgba(22,163,74,0.12)', color: '#15803d' }}
    >
      <CheckCircle2 size={9} />
      Detected
    </span>
  )
}

/** Banner shown at top of modal after OCR reading */
function OcrBanner({ confidence, hasProof }: { confidence: 'high' | 'partial' | 'low'; hasProof: boolean }) {
  const cfg = {
    high:    { bg: 'rgba(22,163,74,0.07)',   border: 'rgba(22,163,74,0.18)',   color: '#15803d', icon: <CheckCircle2 size={13} style={{ color: '#16a34a', flexShrink: 0 }} />, text: 'Transaction details detected. Review and confirm before saving.' },
    partial: { bg: 'rgba(99,102,241,0.07)',  border: 'rgba(99,102,241,0.15)',  color: '#4338ca', icon: <Info size={13} style={{ color: '#6366f1', flexShrink: 0 }} />,         text: 'Some details detected. Please verify and fill in the rest.' },
    low:     { bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.18)',  color: '#92400e', icon: <AlertTriangle size={13} style={{ color: '#b45309', flexShrink: 0 }} />, text: 'Could not read all details. Please fill in manually.' },
  }[confidence]

  return (
    <div
      className="flex items-start gap-2.5 rounded-xl p-3"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.icon}
      <p className="text-xs leading-relaxed" style={{ color: cfg.color }}>
        ✓ Transaction details detected.{' '}{cfg.text}
        {hasProof && <> Screenshot saved as private transaction proof.</>}
      </p>
    </div>
  )
}

// ─── ExtractedSummary ─────────────────────────────────────────────────────────
// Compact read-only summary of the pending transaction capture, shown below
// the form fields after OCR fills the form.

function ExtractedSummary({
  capture,
  onViewProof,
}: {
  capture: TransactionCapture
  onViewProof?: (fileId: string, filename: string) => void
}) {
  function formatRef(type: string): string {
    return REF_LABELS[type] ?? type
  }

  const rows: Array<[string, string]> = []
  if (capture.status)          rows.push(['Status',     capture.status])
  if (capture.paidTo)          rows.push(['Paid To',    capture.paidTo])
  if (capture.receivedFrom)    rows.push(['From',       capture.receivedFrom])
  if (capture.upiId)           rows.push(['UPI ID',     capture.upiId])
  if (capture.bank)            rows.push(['Bank',       capture.bank])
  if (capture.provider)        rows.push(['Provider',   capture.provider])
  if (capture.transactionDate) rows.push(['Txn Date',   capture.transactionDate])
  if (capture.transactionTime) rows.push(['Txn Time',   capture.transactionTime])
  for (const ref of (capture.references as TransactionReference[])) {
    rows.push([formatRef(ref.type), ref.value])
  }

  if (rows.length === 0 && (capture.proofs?.length ?? 0) === 0) return null

  return (
    <div
      className="rounded-xl px-3.5 py-3 flex flex-col gap-2"
      style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.18)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#15803d' }}>
        Extracted Transaction Details
      </p>

      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-3">
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 80 }}>{label}</span>
          <span className="text-xs font-medium text-right break-all" style={{ color: 'var(--text-primary)' }}>{value}</span>
        </div>
      ))}

      {/* Proof thumbnails */}
      {(capture.proofs?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-0.5">
          {(capture.proofs as TransactionProofMeta[]).map((proof) => (
            <button
              key={proof.fileId}
              type="button"
              onClick={() => onViewProof?.(proof.fileId, proof.filename)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-green-500/10"
              style={{ borderColor: 'rgba(22,163,74,0.25)', color: '#15803d' }}
            >
              <ImageIcon size={10} />
              {proof.filename.length > 18 ? proof.filename.slice(0, 15) + '…' : proof.filename}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
