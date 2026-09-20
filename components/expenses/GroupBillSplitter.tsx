'use client'

/**
 * GroupBillSplitter
 *
 * Multi-step wizard for creating / editing a Group Bill.
 *
 * Steps:
 *   1. details   — bill name, date, currency
 *   2. people    — select from People directory + add ad-hoc
 *   3. items     — item table (scan or manual entry)
 *   4. assign    — assign each item to one or more people (visual arrows)
 *   5. charges   — tax, discount, service charge, tip
 *   6. summary   — live calculation preview + save
 *
 * Key features added:
 *   - People directory: fetches GET /api/people?financials=false and shows
 *     a searchable picker. Also supports adding ad-hoc names not in directory.
 *   - Item assignment: each item can be assigned to one or more people.
 *     Per-item split method: equal | quantity | percent | custom.
 *   - Manual entry: full item table without requiring a scan.
 *   - Scan entry: BillScannerModal populates items, merchant name, and
 *     pre-fills bill name and tax from the receipt.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Users, ShoppingCart, SlidersHorizontal,
  ChevronDown, ChevronUp, Check, X, Percent, Tag,
  ReceiptText, ArrowLeft, Search, UserPlus, Scan,
  PenLine, ArrowRight, Split,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { calculateBill } from '@/lib/billCalculator'
import {
  type BillPerson, type BillItem, type CustomSplit,
  type GroupBillData, type SplitMode, type ChargeValueType,
  CURRENCIES, currencySymbol, formatMoney, newItemId, newPersonId,
} from './types'
import { getTodayString } from '@/lib/utils'
import { BillScannerModal, type ScanResult } from './BillScannerModal'

// ─── Step type ────────────────────────────────────────────────────────────────

type Step = 'details' | 'people' | 'items' | 'assign' | 'charges' | 'summary'

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: 'details', label: 'Details',  icon: <Tag size={14} /> },
  { key: 'people',  label: 'People',   icon: <Users size={14} /> },
  { key: 'items',   label: 'Items',    icon: <ShoppingCart size={14} /> },
  { key: 'assign',  label: 'Assign',   icon: <ArrowRight size={14} /> },
  { key: 'charges', label: 'Charges',  icon: <Percent size={14} /> },
  { key: 'summary', label: 'Summary',  icon: <ReceiptText size={14} /> },
]
const STEP_ORDER: Step[] = ['details', 'people', 'items', 'assign', 'charges', 'summary']

// ─── Per-item split data ──────────────────────────────────────────────────────

type ItemSplitMode = 'equal' | 'quantity' | 'percent' | 'custom'

interface ItemSplit {
  itemId:    string
  splitMode: ItemSplitMode
  /** personId → amount (rupees) for custom split */
  customAmounts: Record<string, number>
  /** personId → percent for percent split */
  percents:  Record<string, number>
}

// ─── Person from directory ────────────────────────────────────────────────────

interface DirectoryPerson {
  _id:  string
  name: string
  phone?: string
  email?: string
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface GroupBillSplitterProps {
  initialData?:  GroupBillData
  onSave:        (bill: GroupBillData) => Promise<void>
  onCancel:      () => void
  saving?:       boolean
  startWithScan?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GroupBillSplitter({
  initialData, onSave, onCancel, saving = false, startWithScan = false,
}: GroupBillSplitterProps) {
  const { error: toastError, success: toastSuccess, warning: toastWarning } = useToast()

  // ── Bill state ─────────────────────────────────────────────────────────────
  const [name,     setName]     = useState(initialData?.name ?? '')
  const [date,     setDate]     = useState(initialData?.date ?? getTodayString())
  const [currency, setCurrency] = useState(initialData?.currency ?? 'INR')

  const [people, setPeople] = useState<BillPerson[]>(
    initialData?.people ?? [{ id: newPersonId(), name: 'You', paidAmount: 0 }],
  )
  const [items,       setItems]       = useState<BillItem[]>(initialData?.items ?? [])
  const [splitMode,   setSplitMode]   = useState<SplitMode>(initialData?.splitMode ?? 'item')
  const [customSplits, setCustomSplits] = useState<CustomSplit[]>(initialData?.customSplits ?? [])

  // Per-item splits (assignment + split method)
  const [itemSplits, setItemSplits] = useState<Record<string, ItemSplit>>({})

  // Charges
  const [discountType,       setDiscountType]       = useState<ChargeValueType>(initialData?.discountType ?? 'amount')
  const [discountValue,      setDiscountValue]      = useState(initialData?.discountValue ?? 0)
  const [taxType,            setTaxType]            = useState<ChargeValueType>(initialData?.taxType ?? 'percent')
  const [taxValue,           setTaxValue]           = useState(initialData?.taxValue ?? 0)
  const [serviceChargeType,  setServiceChargeType]  = useState<ChargeValueType>(initialData?.serviceChargeType ?? 'percent')
  const [serviceChargeValue, setServiceChargeValue] = useState(initialData?.serviceChargeValue ?? 0)
  const [tipType,            setTipType]            = useState<ChargeValueType>(initialData?.tipType ?? 'amount')
  const [tipValue,           setTipValue]           = useState(initialData?.tipValue ?? 0)

  // Step
  const [step, setStep] = useState<Step>('details')

  // Scanner
  const [scannerOpen, setScannerOpen] = useState(startWithScan)

  // People directory
  const [dirPeople,    setDirPeople]    = useState<DirectoryPerson[]>([])
  const [dirLoading,   setDirLoading]   = useState(false)
  const [dirSearch,    setDirSearch]    = useState('')
  const [adHocName,    setAdHocName]    = useState('')

  // Load people directory when we enter 'people' step
  useEffect(() => {
    if (step !== 'people') return
    setDirLoading(true)
    fetch('/api/people?financials=false')
      .then((r) => r.json())
      .then((d) => setDirPeople((d.people ?? []) as DirectoryPerson[]))
      .catch(() => { /* silently ignore */ })
      .finally(() => setDirLoading(false))
  }, [step])

  // Auto-open scanner if startWithScan
  useEffect(() => {
    if (startWithScan) { setStep('items'); setScannerOpen(true) }
  }, [startWithScan])

  // ── Calculation ────────────────────────────────────────────────────────────
  const calcResult = useMemo(() => {
    if (people.length === 0) return null
    return calculateBill(
      people.map((p) => ({ id: p.id, name: p.name, paidAmount: p.paidAmount })),
      items.map((it) => ({ id: it.id, name: it.name, price: it.price, quantity: it.quantity, assignedPeople: it.assignedPeople })),
      { discountType, discountValue, taxType, taxValue, serviceChargeType, serviceChargeValue, tipType, tipValue },
      splitMode,
      customSplits,
    )
  }, [people, items, splitMode, customSplits, discountType, discountValue, taxType, taxValue, serviceChargeType, serviceChargeValue, tipType, tipValue])

  const sym = currencySymbol(currency)

  // ── Scan confirm ───────────────────────────────────────────────────────────
  function handleScanConfirm(result: ScanResult) {
    // Populate name from merchant if blank
    if (!name.trim() && result.merchant?.name) setName(result.merchant.name)
    if (!name.trim() && result.bill?.date) setDate(result.bill.date)

    // Convert scanned items to BillItems
    setItems(result.items.map((it) => ({
      id:              newItemId(),
      name:            it.name,
      price:           it.unitPrice,
      quantity:        it.quantity,
      assignedPeople:  [],
    })))

    // Pre-fill tax from scan
    if (result.taxAmount !== null && result.taxAmount > 0) {
      setTaxType('amount')
      setTaxValue(result.taxAmount)
    }
    if (result.serviceCharge !== null && result.serviceCharge > 0) {
      setServiceChargeType('amount')
      setServiceChargeValue(result.serviceCharge)
    }
    if (result.discount !== null && result.discount > 0) {
      setDiscountType('amount')
      setDiscountValue(result.discount)
    }

    // Set split mode to item if multiple items
    if (result.items.length > 1) setSplitMode('item')

    setScannerOpen(false)
    setStep('assign')
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function canAdvance(): boolean {
    switch (step) {
      case 'details': return name.trim().length > 0 && date.length === 10
      case 'people':  return people.length >= 1
      // Require at least one item AND every item must have a non-empty name.
      // An item added with "Add Item Manually" starts with name=''; blocking
      // advance here prevents the server from rejecting with a Zod error.
      case 'items':   return items.length > 0 && items.every((it) => it.name.trim().length > 0)
      case 'assign':  return true   // assignment is optional
      case 'charges': return true
      case 'summary': return true
      default:        return true
    }
  }

  function nextStep() {
    const idx = STEP_ORDER.indexOf(step)
    if (idx < STEP_ORDER.length - 1 && canAdvance()) setStep(STEP_ORDER[idx + 1])
  }
  function prevStep() {
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1])
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  // Synchronous in-progress guard — prevents concurrent saves if the user
  // clicks the button before the parent re-render disables it.
  const isSavingRef = useRef(false)

  async function handleSave() {
    // Prevent concurrent invocations (rapid double-clicks before re-render)
    if (isSavingRef.current) return
    isSavingRef.current = true

    try {
      if (!calcResult) { toastError('No people or items to split'); return }

      // Client-side pre-flight: catch blank item names before the API call
      const blankItem = items.find((it) => !it.name.trim())
      if (blankItem) {
        toastError('All items must have a name before saving.')
        // Jump back to items step so the user can fix it
        setStep('items')
        return
      }

      const bill: GroupBillData = {
        name: name.trim(), date, currency, people, items, splitMode, customSplits,
        discountType, discountValue, taxType, taxValue,
        serviceChargeType, serviceChargeValue, tipType, tipValue,
        subtotal:             calcResult.totals.subtotal,
        discountAmount:       calcResult.totals.discountAmount,
        taxAmount:            calcResult.totals.taxAmount,
        serviceChargeAmount:  calcResult.totals.serviceChargeAmount,
        tipAmount:            calcResult.totals.tipAmount,
        total:                calcResult.totals.grandTotal,
        settlements:          calcResult.settlements.map((s) => ({ ...s, settled: false })),
        savedAsExpense:       initialData?.savedAsExpense ?? false,
        expenseId:            initialData?.expenseId,
        _id:                  initialData?._id,
      }
      try {
        await onSave(bill)
        toastSuccess('Group bill saved!')
      } catch (err) {
        // Surface the real API error message instead of a generic fallback
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to save group bill'
        toastError(msg)
      }
    } finally {
      isSavingRef.current = false
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">

      {/* Step indicator */}
      <StepBar steps={STEPS} current={step} onGo={(s) => { if (STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(step) || canAdvance()) setStep(s) }} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.18 }}
        >

          {/* ── STEP 1: Details ─────────────────────────────────────── */}
          {step === 'details' && (
            <GlassCard padding="md">
              <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Bill Details</h3>
              <div className="flex flex-col gap-3">
                <GlassInput label="Bill name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dinner at Spice Garden" />
                <GlassInput label="Date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Currency</label>
                  <div className="flex flex-wrap gap-2">
                    {CURRENCIES.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setCurrency(c.value)}
                        className={cn(
                          'px-3 py-1.5 rounded-xl text-sm border transition-all',
                          currency === c.value
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold'
                            : 'border-black/[0.08] text-[var(--text-secondary)] hover:border-indigo-300',
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          )}

          {/* ── STEP 2: People ─────────────────────────────────────── */}
          {step === 'people' && (
            <GlassCard padding="md">
              <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>People in this Bill</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Select from your contacts or add anyone by name.</p>

              {/* Selected people chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                {people.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-indigo-200 bg-indigo-50">
                    <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center font-bold">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    {p.name}
                    {p.name !== 'You' && (
                      <button
                        onClick={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))}
                        className="text-indigo-400 hover:text-indigo-700 ml-0.5"
                        aria-label={`Remove ${p.name}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Directory picker */}
              <div className="rounded-xl border border-black/[0.07] overflow-hidden mb-3">
                <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.02)' }}>
                  <Search size={14} className="opacity-40 shrink-0" />
                  <input
                    className="flex-1 bg-transparent text-sm outline-none"
                    placeholder="Search contacts…"
                    value={dirSearch}
                    onChange={(e) => setDirSearch(e.target.value)}
                    style={{ color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="max-h-44 overflow-y-auto divide-y divide-black/[0.04]">
                  {dirLoading && (
                    <div className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Loading contacts…</div>
                  )}
                  {!dirLoading && dirPeople.filter((dp) => {
                    const q = dirSearch.toLowerCase()
                    return !q || dp.name.toLowerCase().includes(q)
                  }).map((dp) => {
                    const already = people.some((p) => p.name.toLowerCase() === dp.name.toLowerCase())
                    return (
                      <button
                        key={dp._id}
                        disabled={already}
                        onClick={() => {
                          if (!already) setPeople((prev) => [...prev, { id: newPersonId(), name: dp.name, paidAmount: 0 }])
                        }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                          already ? 'opacity-40 cursor-default' : 'hover:bg-indigo-50/60 cursor-pointer',
                        )}
                      >
                        <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center font-bold shrink-0">
                          {dp.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{dp.name}</p>
                          {dp.phone && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{dp.phone}</p>}
                        </div>
                        {already
                          ? <Check size={14} className="text-emerald-500 shrink-0" />
                          : <Plus  size={14} className="text-indigo-400 shrink-0" />}
                      </button>
                    )
                  })}
                  {!dirLoading && dirPeople.filter((dp) => {
                    const q = dirSearch.toLowerCase()
                    return !q || dp.name.toLowerCase().includes(q)
                  }).length === 0 && !dirSearch && (
                    <div className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>No contacts found.</div>
                  )}
                </div>
              </div>

              {/* Ad-hoc person */}
              <div className="flex gap-2">
                <GlassInput
                  label=""
                  placeholder="Add person by name…"
                  value={adHocName}
                  onChange={(e) => setAdHocName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && adHocName.trim()) {
                      setPeople((prev) => [...prev, { id: newPersonId(), name: adHocName.trim(), paidAmount: 0 }])
                      setAdHocName('')
                    }
                  }}
                />
                <GlassButton
                  variant="secondary" size="md"
                  disabled={!adHocName.trim()}
                  onClick={() => {
                    if (adHocName.trim()) {
                      setPeople((prev) => [...prev, { id: newPersonId(), name: adHocName.trim(), paidAmount: 0 }])
                      setAdHocName('')
                    }
                  }}
                >
                  <UserPlus size={15} />
                </GlassButton>
              </div>
            </GlassCard>
          )}

          {/* ── STEP 3: Items ──────────────────────────────────────── */}
          {step === 'items' && (
            <GlassCard padding="md">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Items</h3>
                <GlassButton variant="primary" size="sm" className="gap-1.5" onClick={() => setScannerOpen(true)}>
                  <Scan size={13} /> Scan Receipt
                </GlassButton>
              </div>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Scan a receipt or enter items manually.
              </p>

              {/* Items list */}
              <div className="flex flex-col gap-2 mb-3">
                <AnimatePresence>
                  {items.map((item, idx) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.14 }}
                    >
                      <ItemRow
                        item={item}
                        sym={sym}
                        onChange={(updated) => setItems((prev) => prev.map((it) => it.id === item.id ? updated : it))}
                        onRemove={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {items.length === 0 && (
                  <div className="py-8 text-center text-sm rounded-xl border-2 border-dashed border-black/[0.07]" style={{ color: 'var(--text-muted)' }}>
                    No items yet. Scan a receipt or add items below.
                  </div>
                )}
              </div>

              {/* Add item button */}
              <GlassButton
                variant="secondary" size="md" className="w-full gap-1.5"
                onClick={() => setItems((prev) => [...prev, { id: newItemId(), name: '', price: 0, quantity: 1, assignedPeople: [] }])}
              >
                <Plus size={14} /> Add Item Manually
              </GlassButton>

              {/* Warn about unnamed items — explains why "Next" is disabled */}
              {items.length > 0 && items.some((it) => !it.name.trim()) && (
                <p className="text-xs mt-2 text-amber-600">
                  All items need a name before you can continue.
                </p>
              )}
            </GlassCard>
          )}

          {/* ── STEP 4: Assign ─────────────────────────────────────── */}
          {step === 'assign' && (
            <AssignStep
              items={items}
              people={people}
              sym={sym}
              itemSplits={itemSplits}
              onItemsChange={setItems}
              onItemSplitsChange={setItemSplits}
            />
          )}

          {/* ── STEP 5: Charges ────────────────────────────────────── */}
          {step === 'charges' && (
            <GlassCard padding="md">
              <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Additional Charges</h3>
              <div className="flex flex-col gap-4">
                <ChargeRow label="Tax"            type={taxType}           value={taxValue}           sym={sym}
                  onTypeChange={setTaxType}           onValueChange={setTaxValue} />
                <ChargeRow label="Discount"       type={discountType}      value={discountValue}      sym={sym}
                  onTypeChange={setDiscountType}      onValueChange={setDiscountValue} />
                <ChargeRow label="Service Charge" type={serviceChargeType} value={serviceChargeValue} sym={sym}
                  onTypeChange={setServiceChargeType} onValueChange={setServiceChargeValue} />
                <ChargeRow label="Tip"            type={tipType}           value={tipValue}           sym={sym}
                  onTypeChange={setTipType}           onValueChange={setTipValue} />
              </div>

              {/* Bill-level split mode */}
              <div className="mt-5 pt-4 border-t border-black/[0.06]">
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Bill-level split method</p>
                <div className="flex gap-2 flex-wrap">
                  {([['item', 'By item'], ['equal', 'Equal split'], ['custom', 'Custom']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setSplitMode(val)}
                      className={cn(
                        'px-3 py-1.5 rounded-xl text-sm border transition-all',
                        splitMode === val
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold'
                          : 'border-black/[0.08] text-[var(--text-secondary)] hover:border-indigo-300',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </GlassCard>
          )}

          {/* ── STEP 6: Summary ────────────────────────────────────── */}
          {step === 'summary' && (
            <SummaryStep
              name={name} date={date} currency={currency} sym={sym}
              people={people} items={items}
              calcResult={calcResult}
              saving={saving}
              onSave={handleSave}
            />
          )}

        </motion.div>
      </AnimatePresence>

      {/* Navigation buttons */}
      <div className="flex gap-3">
        {step === 'details' ? (
          <GlassButton variant="secondary" size="md" className="flex-1" onClick={onCancel}>
            <ArrowLeft size={14} className="mr-1" /> Cancel
          </GlassButton>
        ) : (
          <GlassButton variant="secondary" size="md" className="flex-1" onClick={prevStep}>
            <ArrowLeft size={14} className="mr-1" /> Back
          </GlassButton>
        )}
        {step !== 'summary' && (
          <GlassButton
            variant="primary" size="md" className="flex-2"
            disabled={!canAdvance()}
            onClick={nextStep}
          >
            Next <ArrowRight size={14} className="ml-1" />
          </GlassButton>
        )}
      </div>

      {/* Scanner modal */}
      <BillScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onConfirm={handleScanConfirm}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP BAR
// ═══════════════════════════════════════════════════════════════════════════════

function StepBar({ steps, current, onGo }: { steps: typeof STEPS; current: Step; onGo: (s: Step) => void }) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {steps.map((s, idx) => {
        const curIdx = STEP_ORDER.indexOf(current)
        const isActive = s.key === current
        const isDone   = STEP_ORDER.indexOf(s.key) < curIdx
        return (
          <button
            key={s.key}
            onClick={() => onGo(s.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl transition-all whitespace-nowrap shrink-0',
              isActive ? 'bg-indigo-600 text-white shadow-sm' : isDone ? 'text-emerald-700 bg-emerald-50' : 'text-[var(--text-muted)]',
            )}
          >
            {isDone ? <Check size={12} /> : s.icon}
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM ROW (for manual entry / items step)
// ═══════════════════════════════════════════════════════════════════════════════

function ItemRow({ item, sym, onChange, onRemove }: {
  item: BillItem; sym: string
  onChange: (updated: BillItem) => void
  onRemove: () => void
}) {
  // Local expression state so we can display "500+50" while storing 550 in item.price
  const [priceExpr, setPriceExpr] = useState(item.price > 0 ? String(item.price) : '')

  // Sync priceExpr when item.price changes externally (e.g. from scan)
  const prevPrice = useRef(item.price)
  useEffect(() => {
    if (prevPrice.current !== item.price) {
      prevPrice.current = item.price
      // Only overwrite expr if it doesn't already evaluate to the same value
      const currentCalc = parseAmountExpression(priceExpr).value
      if (currentCalc !== item.price) {
        setPriceExpr(item.price > 0 ? String(item.price) : '')
      }
    }
  }, [item.price, priceExpr])

  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl border border-black/[0.06]" style={{ background: 'rgba(255,255,255,0.7)' }}>
      <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
        <div className="col-span-3 sm:col-span-1">
          <input
            className="w-full text-sm bg-transparent border-b border-black/10 outline-none pb-0.5 focus:border-indigo-400"
            placeholder="Item name"
            value={item.name}
            onChange={(e) => onChange({ ...item, name: e.target.value })}
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
        <input
          className="text-sm bg-transparent border-b border-black/10 outline-none pb-0.5 text-center focus:border-indigo-400"
          type="number" min="1" placeholder="Qty"
          value={item.quantity}
          onChange={(e) => {
            const qty = Math.max(1, parseInt(e.target.value) || 1)
            onChange({ ...item, quantity: qty })
          }}
          style={{ color: 'var(--text-primary)' }}
        />
        <SmartAmountInput
          value={priceExpr}
          onChange={(raw, numeric) => {
            setPriceExpr(raw)
            prevPrice.current = numeric ?? 0
            onChange({ ...item, price: numeric ?? 0 })
          }}
          currency={sym === '₹' ? 'INR' : sym === '$' ? 'USD' : sym === '€' ? 'EUR' : sym === '£' ? 'GBP' : 'INR'}
          placeholder="Price"
        />
      </div>
      <div className="text-sm font-semibold shrink-0 w-16 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {sym}{(item.price * item.quantity).toFixed(2)}
      </div>
      <button onClick={onRemove} className="text-red-400 hover:text-red-600 p-1 rounded-lg transition-colors" aria-label="Remove item">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARGE ROW
// ═══════════════════════════════════════════════════════════════════════════════

function ChargeRow({ label, type, value, sym, onTypeChange, onValueChange }: {
  label: string; type: ChargeValueType; value: number; sym: string
  onTypeChange:  (t: ChargeValueType) => void
  onValueChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <button
        onClick={() => onTypeChange(type === 'amount' ? 'percent' : 'amount')}
        className="w-8 h-8 rounded-lg border border-black/[0.08] flex items-center justify-center text-xs font-bold transition-colors hover:border-indigo-300"
        title={`Switch to ${type === 'amount' ? 'percent' : 'amount'}`}
        style={{ color: 'var(--text-secondary)' }}
      >
        {type === 'percent' ? '%' : sym}
      </button>
      <div className="w-28">
        <GlassInput
          label=""
          type="number" min="0" step="0.01"
          value={String(value)}
          onChange={(e) => onValueChange(parseFloat(e.target.value) || 0)}
          placeholder="0"
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSIGN STEP
// ═══════════════════════════════════════════════════════════════════════════════

function AssignStep({ items, people, sym, itemSplits, onItemsChange, onItemSplitsChange }: {
  items:   BillItem[]; people: BillPerson[]; sym: string
  itemSplits: Record<string, ItemSplit>
  onItemsChange:      (items: BillItem[]) => void
  onItemSplitsChange: (splits: Record<string, ItemSplit>) => void
}) {
  function togglePersonForItem(itemId: string, personId: string) {
    onItemsChange(items.map((it) => {
      if (it.id !== itemId) return it
      const has = it.assignedPeople.includes(personId)
      const next = has
        ? it.assignedPeople.filter((pid) => pid !== personId)
        : [...it.assignedPeople, personId]
      return { ...it, assignedPeople: next }
    }))
  }

  function setItemSplit(itemId: string, patch: Partial<ItemSplit>) {
    const existing: ItemSplit = itemSplits[itemId] ?? {
      itemId,
      splitMode:     'equal',
      customAmounts: {},
      percents:      {},
    }
    onItemSplitsChange({
      ...itemSplits,
      [itemId]: { ...existing, ...patch },
    })
  }

  return (
    <GlassCard padding="md">
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Assign Items</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Tap a person&apos;s avatar next to each item to assign it. Shared items split the cost.
      </p>

      {items.length === 0 && (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>No items to assign. Go back and add items first.</p>
      )}

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const split      = itemSplits[item.id]
          const assigned   = item.assignedPeople
          const itemTotal  = item.price * item.quantity

          return (
            <div key={item.id} className="rounded-xl border border-black/[0.07] overflow-hidden" style={{ background: 'rgba(255,255,255,0.75)' }}>
              {/* Item header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/[0.05]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{item.name || 'Unnamed'}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {item.quantity} × {sym}{item.price.toFixed(2)} = {sym}{itemTotal.toFixed(2)}
                  </p>
                </div>
                {assigned.length > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                    {assigned.length} {assigned.length === 1 ? 'person' : 'people'}
                  </span>
                )}
              </div>

              {/* People assignment row */}
              <div className="px-3 py-2.5 flex flex-wrap gap-2">
                {people.map((p) => {
                  const isAssigned = assigned.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePersonForItem(item.id, p.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all',
                        isAssigned
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : 'border-black/[0.08] text-[var(--text-secondary)] hover:border-indigo-300',
                      )}
                    >
                      <span className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                        isAssigned ? 'bg-indigo-600 text-white' : 'bg-black/[0.06] text-[var(--text-secondary)]',
                      )}>
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      {p.name}
                      {isAssigned && <Check size={10} className="shrink-0" />}
                    </button>
                  )
                })}
              </div>

              {/* Split method (only when ≥2 people assigned) */}
              {assigned.length >= 2 && (
                <div className="px-3 pb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>How to split</p>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {([
                      ['equal',    'Equal'],
                      ['quantity', 'By Qty'],
                      ['percent',  'Percent'],
                      ['custom',   'Custom'],
                    ] as [ItemSplitMode, string][]).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setItemSplit(item.id, { splitMode: mode })}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs border transition-all',
                          (split?.splitMode ?? 'equal') === mode
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold'
                            : 'border-black/[0.06] text-[var(--text-secondary)]',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Split detail rows */}
                  <SplitDetail
                    item={item}
                    people={people.filter((p) => assigned.includes(p.id))}
                    sym={sym}
                    split={split ?? { itemId: item.id, splitMode: 'equal', customAmounts: {}, percents: {} }}
                    onSplitChange={(patch) => setItemSplit(item.id, patch)}
                  />
                </div>
              )}

              {/* Single person: show their full amount */}
              {assigned.length === 1 && (
                <div className="px-3 pb-2.5">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {people.find((p) => p.id === assigned[0])?.name ?? 'Person'} pays {sym}{itemTotal.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}

// ─── SplitDetail ──────────────────────────────────────────────────────────────

function SplitDetail({ item, people, sym, split, onSplitChange }: {
  item:    BillItem
  people:  BillPerson[]
  sym:     string
  split:   ItemSplit
  onSplitChange: (patch: Partial<ItemSplit>) => void
}) {
  const itemTotal = item.price * item.quantity
  const mode      = split.splitMode

  if (mode === 'equal') {
    const share = Math.round((itemTotal / people.length) * 100) / 100
    return (
      <div className="flex flex-col gap-1">
        {people.map((p) => (
          <div key={p.id} className="flex justify-between items-center text-xs px-1">
            <span style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
            <span className="font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{sym}{share.toFixed(2)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (mode === 'quantity') {
    // Distribute by quantity — equal for now (future: per-person qty)
    const share = Math.round((itemTotal / people.length) * 100) / 100
    return (
      <div className="flex flex-col gap-1">
        {people.map((p) => (
          <div key={p.id} className="flex justify-between items-center text-xs px-1">
            <span style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
            <span className="font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{sym}{share.toFixed(2)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (mode === 'percent') {
    const totalPct = people.reduce((s, p) => s + (split.percents[p.id] ?? Math.round(100 / people.length)), 0)
    const valid    = Math.abs(totalPct - 100) <= 1
    return (
      <div className="flex flex-col gap-1.5">
        {people.map((p) => {
          const pct  = split.percents[p.id] ?? Math.round(100 / people.length)
          const amt  = Math.round((itemTotal * pct / 100) * 100) / 100
          return (
            <div key={p.id} className="flex items-center gap-2">
              <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
              <input
                type="number" min="0" max="100" step="1"
                className="w-14 text-xs text-center border border-black/[0.1] rounded-lg px-1.5 py-1 outline-none focus:border-indigo-400"
                value={pct}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
                  onSplitChange({ percents: { ...split.percents, [p.id]: v } })
                }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>%</span>
              <span className="text-xs font-medium w-14 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{sym}{amt.toFixed(2)}</span>
            </div>
          )
        })}
        {!valid && <p className="text-[10px] text-red-600 mt-0.5">Percentages must add up to 100% (currently {totalPct}%)</p>}
      </div>
    )
  }

  // Custom amounts
  const totalCustom = people.reduce((s, p) => s + (split.customAmounts[p.id] ?? 0), 0)
  const diff        = Math.abs(totalCustom - itemTotal)
  const customValid = diff <= 0.02
  return (
    <div className="flex flex-col gap-1.5">
      {people.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sym}</span>
          <input
            type="number" min="0" step="0.01"
            className={cn(
              'w-20 text-xs border rounded-lg px-1.5 py-1 outline-none focus:border-indigo-400',
              !customValid && 'border-red-300',
            )}
            value={split.customAmounts[p.id] ?? ''}
            placeholder="0.00"
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              onSplitChange({ customAmounts: { ...split.customAmounts, [p.id]: v } })
            }}
          />
        </div>
      ))}
      <p className={cn('text-[10px] mt-0.5 text-right', customValid ? 'text-emerald-600' : 'text-amber-600')}>
        Total: {sym}{totalCustom.toFixed(2)} / {sym}{itemTotal.toFixed(2)}
        {!customValid && ` (difference ${sym}${diff.toFixed(2)})`}
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY STEP
// ═══════════════════════════════════════════════════════════════════════════════

function SummaryStep({ name, date, currency, sym, people, items, calcResult, saving, onSave }: {
  name: string; date: string; currency: string; sym: string
  people: BillPerson[]; items: BillItem[]
  calcResult: ReturnType<typeof calculateBill> | null
  saving: boolean
  onSave: () => void
}) {
  return (
    <GlassCard padding="md">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Summary</h3>

      {/* Bill header */}
      <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)' }}>
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{date} · {currency}</p>
      </div>

      {/* Items */}
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Items</p>
        <div className="flex flex-col gap-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2">
              <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                {it.name || '(unnamed)'} {it.quantity > 1 && <span className="text-xs opacity-60">×{it.quantity}</span>}
              </span>
              <span className="text-sm font-medium tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                {sym}{(it.price * it.quantity).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      {calcResult && (
        <div className="border-t border-black/[0.06] pt-3 mb-4 flex flex-col gap-1.5">
          <TotalLine label="Subtotal"       value={sym + calcResult.totals.subtotal.toFixed(2)} />
          {calcResult.totals.discountAmount > 0 && <TotalLine label="Discount" value={`-${sym}${calcResult.totals.discountAmount.toFixed(2)}`} />}
          {calcResult.totals.taxAmount > 0 && <TotalLine label="Tax" value={sym + calcResult.totals.taxAmount.toFixed(2)} />}
          {calcResult.totals.serviceChargeAmount > 0 && <TotalLine label="Service Charge" value={sym + calcResult.totals.serviceChargeAmount.toFixed(2)} />}
          {calcResult.totals.tipAmount > 0 && <TotalLine label="Tip" value={sym + calcResult.totals.tipAmount.toFixed(2)} />}
          <div className="flex justify-between items-center pt-1 border-t border-black/[0.06]">
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Grand Total</span>
            <span className="text-base font-bold" style={{ color: 'var(--accent)' }}>{sym}{calcResult.totals.grandTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Per-person shares */}
      {calcResult && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Each Person Pays</p>
          <div className="flex flex-col gap-2">
            {calcResult.personShares.map((ps) => (
              <div key={ps.personId} className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center font-bold shrink-0">
                  {ps.personName.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{ps.personName}</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {sym}{ps.total.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <GlassButton variant="primary" size="lg" className="w-full" loading={saving} onClick={onSave}>
        Save Group Bill
      </GlassButton>
    </GlassCard>
  )
}

function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
