'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Users, ShoppingCart, SlidersHorizontal,
  ChevronDown, ChevronUp, Check, X, Percent,
  Tag, ReceiptText, ArrowLeft,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import {
  calculateBill,
  type BillCalculationResult,
} from '@/lib/billCalculator'
import {
  type BillPerson,
  type BillItem,
  type CustomSplit,
  type GroupBillData,
  type SplitMode,
  type ChargeValueType,
  CURRENCIES,
  currencySymbol,
  formatMoney,
  newItemId,
  newPersonId,
} from './types'
import { getTodayString } from '@/lib/utils'
import { BillScannerModal, type ScanResult } from './BillScannerModal'

// ─── Step type ──────────────────────────────────────────────────────────────

type Step = 'details' | 'people' | 'items' | 'charges' | 'split' | 'summary'

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: 'details',  label: 'Details',  icon: <Tag size={14} /> },
  { key: 'people',   label: 'People',   icon: <Users size={14} /> },
  { key: 'items',    label: 'Items',    icon: <ShoppingCart size={14} /> },
  { key: 'charges',  label: 'Charges',  icon: <Percent size={14} /> },
  { key: 'split',    label: 'Split',    icon: <SlidersHorizontal size={14} /> },
  { key: 'summary',  label: 'Summary',  icon: <ReceiptText size={14} /> },
]

const STEP_ORDER: Step[] = ['details', 'people', 'items', 'charges', 'split', 'summary']

// ─── Props ──────────────────────────────────────────────────────────────────

interface GroupBillSplitterProps {
  initialData?: GroupBillData
  onSave: (bill: GroupBillData) => Promise<void>
  onCancel: () => void
  saving?: boolean
  /**
   * When true, the wizard skips directly to the Items step and opens the
   * bill scanner automatically. Set by ExpensesClient when the user chose
   * "Scan a Bill" in the choice modal.
   */
  startWithScan?: boolean
}

// ─── Component ──────────────────────────────────────────────────────────────

export function GroupBillSplitter({
  initialData,
  onSave,
  onCancel,
  saving = false,
  startWithScan = false,
}: GroupBillSplitterProps) {
  const { error: toastError, success: toastSuccess, warning: toastWarning } = useToast()

  // ── Bill state ─────────────────────────────────────────────────────────
  const [name, setName] = useState(initialData?.name ?? '')
  const [date, setDate] = useState(initialData?.date ?? getTodayString())
  const [currency, setCurrency] = useState(initialData?.currency ?? 'INR')

  const [people, setPeople] = useState<BillPerson[]>(
    initialData?.people ?? [{ id: newPersonId(), name: 'You', paidAmount: 0 }]
  )
  const [items, setItems] = useState<BillItem[]>(initialData?.items ?? [])
  const [splitMode, setSplitMode] = useState<SplitMode>(initialData?.splitMode ?? 'item')
  const [customSplits, setCustomSplits] = useState<CustomSplit[]>(
    initialData?.customSplits ?? []
  )

  // Charges
  const [discountType, setDiscountType] = useState<ChargeValueType>(
    initialData?.discountType ?? 'amount'
  )
  const [discountValue, setDiscountValue] = useState(initialData?.discountValue ?? 0)
  const [taxType, setTaxType] = useState<ChargeValueType>(initialData?.taxType ?? 'percent')
  const [taxValue, setTaxValue] = useState(initialData?.taxValue ?? 0)
  const [serviceChargeType, setServiceChargeType] = useState<ChargeValueType>(
    initialData?.serviceChargeType ?? 'percent'
  )
  const [serviceChargeValue, setServiceChargeValue] = useState(
    initialData?.serviceChargeValue ?? 0
  )
  const [tipType, setTipType] = useState<ChargeValueType>(initialData?.tipType ?? 'amount')
  const [tipValue, setTipValue] = useState(initialData?.tipValue ?? 0)

  // ── Bill scanner ───────────────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false)

  function handleScanResult(result: ScanResult) {
    // ── Items ──────────────────────────────────────────────────────────────
    const newItems: BillItem[] = result.items.map((si) => ({
      id: newItemId(),
      name: si.name,
      // BillItem.price is unit price; lineTotal = quantity × price
      price: si.unitPrice,
      quantity: si.quantity,
      assignedPeople: [],
    }))
    // Replace existing items only if we got at least one from the scan;
    // otherwise leave current items untouched.
    if (newItems.length > 0) {
      setItems(newItems)
    }

    // ── Charges ────────────────────────────────────────────────────────────
    // Only overwrite a charge if the scanner found a non-zero value,
    // to avoid wiping values the user already entered.
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

    // ── Split mode suggestion ───────────────────────────────────────────────
    if (result.suggestItemSplit) {
      setSplitMode('item')
    }

    // ── Navigate to items step so the user can assign items to people ────────
    setStep('items')
  }

  // ── Step navigation ────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('details')
  const stepIdx = STEP_ORDER.indexOf(step)

  // When the user chose "Scan a Bill" from the entry-point choice modal,
  // jump straight to the Items step and open the scanner automatically.
  // The `useRef` guard ensures this runs only once on mount, not on every render.
  const didAutoScan = useRef(false)
  useEffect(() => {
    if (startWithScan && !didAutoScan.current) {
      didAutoScan.current = true
      setStep('items')
      setScannerOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live calculation ───────────────────────────────────────────────────
  const calcResult = useMemo<BillCalculationResult>(() => {
    return calculateBill(
      people,
      items,
      { discountType, discountValue, taxType, taxValue, serviceChargeType, serviceChargeValue, tipType, tipValue },
      splitMode,
      customSplits
    )
  }, [people, items, discountType, discountValue, taxType, taxValue, serviceChargeType, serviceChargeValue, tipType, tipValue, splitMode, customSplits])

  const sym = currencySymbol(currency)

  // ── Validation per step ────────────────────────────────────────────────
  function canProceed(): string | null {
    if (step === 'details') {
      if (!name.trim()) return 'Please enter a bill name'
      if (!date) return 'Please enter a date'
    }
    if (step === 'people') {
      if (people.length === 0) return 'Add at least one person'
      if (people.some((p) => !p.name.trim())) return 'All people must have names'
      const names = people.map((p) => p.name.trim().toLowerCase())
      if (new Set(names).size !== names.length) return 'People must have unique names'
    }
    if (step === 'items') {
      if (items.some((it) => !it.name.trim())) return 'All items must have names'
      if (items.some((it) => it.price < 0)) return 'Item prices cannot be negative'
    }
    if (step === 'split' && splitMode === 'custom') {
      if (customSplits.length === 0) return 'Enter custom split amounts'
      const firstType = customSplits[0].type
      if (firstType === 'percent') {
        const total = customSplits.reduce((s, cs) => s + cs.value, 0)
        if (Math.abs(total - 100) > 0.5) return `Percentages must sum to 100% (currently ${total.toFixed(1)}%)`
      }
    }
    return null
  }

  function goNext() {
    const err = canProceed()
    if (err) { toastError(err); return }
    const nextIdx = Math.min(stepIdx + 1, STEP_ORDER.length - 1)
    setStep(STEP_ORDER[nextIdx])
  }

  function goBack() {
    const prevIdx = Math.max(stepIdx - 1, 0)
    setStep(STEP_ORDER[prevIdx])
  }

  function goToStep(s: Step) {
    // Only allow going back freely; going forward requires validation
    const targetIdx = STEP_ORDER.indexOf(s)
    if (targetIdx <= stepIdx) {
      setStep(s)
    } else {
      toastWarning('Complete the current step first')
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = canProceed()
    if (err) { toastError(err); return }

    const bill: GroupBillData = {
      ...(initialData?._id ? { _id: initialData._id } : {}),
      name: name.trim(),
      date,
      currency,
      people,
      items,
      splitMode,
      customSplits,
      discountType, discountValue,
      taxType, taxValue,
      serviceChargeType, serviceChargeValue,
      tipType, tipValue,
      subtotal: calcResult.totals.subtotal,
      discountAmount: calcResult.totals.discountAmount,
      taxAmount: calcResult.totals.taxAmount,
      serviceChargeAmount: calcResult.totals.serviceChargeAmount,
      tipAmount: calcResult.totals.tipAmount,
      total: calcResult.totals.grandTotal,
      settlements: calcResult.settlements.map((s) => ({ ...s, settled: false })),
      savedAsExpense: initialData?.savedAsExpense ?? false,
      expenseId: initialData?.expenseId,
    }

    try {
      await onSave(bill)
      toastSuccess('Bill saved!')
    } catch {
      toastError('Failed to save bill')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-0 max-w-2xl mx-auto">
      {/* Step progress bar */}
      <StepBar steps={STEPS} current={step} onClick={goToStep} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.18 }}
        >
          {step === 'details' && (
            <DetailsStep
              name={name} setName={setName}
              date={date} setDate={setDate}
              currency={currency} setCurrency={setCurrency}
            />
          )}
          {step === 'people' && (
            <PeopleStep people={people} setPeople={setPeople} />
          )}
          {step === 'items' && (
            <ItemsStep
              items={items} setItems={setItems}
              people={people} currency={currency}
              calcResult={calcResult}
              onScanBill={() => setScannerOpen(true)}
            />
          )}
          {step === 'charges' && (
            <ChargesStep
              sym={sym}
              discountType={discountType} setDiscountType={setDiscountType}
              discountValue={discountValue} setDiscountValue={setDiscountValue}
              taxType={taxType} setTaxType={setTaxType}
              taxValue={taxValue} setTaxValue={setTaxValue}
              serviceChargeType={serviceChargeType} setServiceChargeType={setServiceChargeType}
              serviceChargeValue={serviceChargeValue} setServiceChargeValue={setServiceChargeValue}
              tipType={tipType} setTipType={setTipType}
              tipValue={tipValue} setTipValue={setTipValue}
              totals={calcResult.totals}
              currency={currency}
            />
          )}
          {step === 'split' && (
            <SplitStep
              splitMode={splitMode} setSplitMode={setSplitMode}
              people={people}
              customSplits={customSplits} setCustomSplits={setCustomSplits}
              calcResult={calcResult}
              currency={currency}
            />
          )}
          {step === 'summary' && (
            <SummaryStep
              calcResult={calcResult}
              people={people}
              currency={currency}
              name={name}
              date={date}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex gap-3 mt-4 pt-4 border-t border-black/[0.07]">
        <GlassButton variant="ghost" onClick={stepIdx === 0 ? onCancel : goBack} className="gap-1.5">
          {stepIdx === 0 ? <X size={14} /> : <ArrowLeft size={14} />}
          {stepIdx === 0 ? 'Cancel' : 'Back'}
        </GlassButton>
        <div className="flex-1" />
        {step !== 'summary' ? (
          <GlassButton variant="primary" onClick={goNext} className="gap-1.5">
            Next
            <ChevronDown size={14} className="rotate-[-90deg]" />
          </GlassButton>
        ) : (
          <GlassButton variant="primary" onClick={handleSave} loading={saving} className="gap-1.5">
            <Check size={14} />
            {initialData?._id ? 'Update Bill' : 'Save Bill'}
          </GlassButton>
        )}
      </div>

      {/* Bill scanner modal — loaded lazily, only mounted when open */}
      {scannerOpen && (
        <BillScannerModal
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onConfirm={handleScanResult}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Step Bar
// ══════════════════════════════════════════════════════════════════════════

function StepBar({
  steps,
  current,
  onClick,
}: {
  steps: typeof STEPS
  current: Step
  onClick: (s: Step) => void
}) {
  const currentIdx = STEP_ORDER.indexOf(current)
  return (
    <div className="flex items-center gap-1 mb-5 overflow-x-auto no-scrollbar pb-1">
      {steps.map((s, i) => {
        const done = i < currentIdx
        const active = s.key === current
        return (
          <button
            key={s.key}
            onClick={() => onClick(s.key)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
              active && 'bg-indigo-500/20 text-indigo-600 border border-indigo-500/25',
              done && 'text-emerald-600 hover:text-emerald-700',
              !active && !done && 'opacity-50'
            )}
          >
            {done ? <Check size={12} /> : s.icon}
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Step: Details
// ══════════════════════════════════════════════════════════════════════════

function DetailsStep({
  name, setName, date, setDate, currency, setCurrency,
}: {
  name: string; setName: (v: string) => void
  date: string; setDate: (v: string) => void
  currency: string; setCurrency: (v: string) => void
}) {
  return (
    <GlassCard padding="lg" className="flex flex-col gap-4">
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Bill Details</h2>
      <GlassInput
        label="Bill Name"
        placeholder="e.g. Dinner with Friends"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <GlassInput
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Currency</label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm appearance-none"
        >
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value} className="bg-[#1a1a24]">
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </GlassCard>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Step: People
// ══════════════════════════════════════════════════════════════════════════

function PeopleStep({
  people,
  setPeople,
}: {
  people: BillPerson[]
  setPeople: React.Dispatch<React.SetStateAction<BillPerson[]>>
}) {
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addPerson() {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (people.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return
    setPeople((prev) => [...prev, { id: newPersonId(), name: trimmed, paidAmount: 0 }])
    setNewName('')
    inputRef.current?.focus()
  }

  function removePerson(id: string) {
    setPeople((prev) => prev.filter((p) => p.id !== id))
  }

  function renamePerson(id: string, name: string) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  return (
    <GlassCard padding="lg" className="flex flex-col gap-4">
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Who&apos;s splitting?</h2>
      <div className="flex flex-wrap gap-2 min-h-[48px]">
        <AnimatePresence>
          {people.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            >
              <PersonChip
                person={p}
                onRename={renamePerson}
                onRemove={people.length > 1 ? removePerson : undefined}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="glass-input flex-1 rounded-xl px-3.5 py-2.5 text-sm"
          placeholder="Add person (e.g. Rahul)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addPerson()}
        />
        <GlassButton variant="primary" size="md" onClick={addPerson} className="shrink-0">
          <Plus size={15} />
        </GlassButton>
      </div>
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        {people.length} {people.length === 1 ? 'person' : 'people'} · Tap a chip to rename
      </p>
    </GlassCard>
  )
}

function PersonChip({
  person,
  onRename,
  onRemove,
  selected,
  onToggle,
}: {
  person: BillPerson
  onRename?: (id: string, name: string) => void
  onRemove?: (id: string) => void
  selected?: boolean
  onToggle?: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(person.name)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  function commitEdit() {
    const trimmed = val.trim()
    if (trimmed && onRename) onRename(person.id, trimmed)
    else setVal(person.name)
    setEditing(false)
  }

  if (editing && onRename) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded-full glass border border-indigo-500/40 bg-indigo-500/10">
        <input
          ref={editRef}
          className="bg-transparent text-sm outline-none w-20 min-w-0"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setVal(person.name); setEditing(false) } }}
        />
        <button onClick={commitEdit} className="text-emerald-400 hover:text-emerald-300">
          <Check size={12} />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer select-none',
        selected
          ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/50'
          : 'glass hover:bg-black/[0.05]',
        onToggle && 'cursor-pointer'
      )}
      onClick={() => {
        if (onToggle) onToggle(person.id)
        else if (onRename) setEditing(true)
      }}
    >
      <span className="w-5 h-5 rounded-full bg-indigo-500/40 flex items-center justify-center text-xs text-indigo-200 font-bold shrink-0">
        {person.name[0]?.toUpperCase() ?? '?'}
      </span>
      <span>{person.name}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(person.id) }}
          className="hover:text-red-500 transition-colors ml-0.5" style={{ color: "var(--text-faint)" }}
        >
          <X size={11} />
        </button>
      )}
      {selected && !onRemove && <Check size={11} className="text-indigo-300 ml-0.5" />}
    </div>
  )
}

// Export PersonChip for use in other components
export { PersonChip }

// ══════════════════════════════════════════════════════════════════════════
// Step: Items
// ══════════════════════════════════════════════════════════════════════════

function ItemsStep({
  items, setItems, people, currency, calcResult, onScanBill,
}: {
  items: BillItem[]
  setItems: React.Dispatch<React.SetStateAction<BillItem[]>>
  people: BillPerson[]
  currency: string
  calcResult: BillCalculationResult
  onScanBill: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  function addItem() {
    const newItem: BillItem = {
      id: newItemId(),
      name: '',
      price: 0,
      quantity: 1,
      assignedPeople: [],
    }
    setItems((prev) => [...prev, newItem])
    setEditingId(newItem.id)
  }

  function updateItem(id: string, patch: Partial<BillItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (editingId === id) setEditingId(null)
  }

  function toggleAssign(itemId: string, personId: string) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it
        const has = it.assignedPeople.includes(personId)
        return {
          ...it,
          assignedPeople: has
            ? it.assignedPeople.filter((id) => id !== personId)
            : [...it.assignedPeople, personId],
        }
      })
    )
  }

  const subtotal = calcResult.totals.subtotal

  return (
    <GlassCard padding="lg" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Items</h2>
        <div className="flex items-center gap-2">
          <GlassButton
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={onScanBill}
            title="Scan a receipt to auto-fill items"
          >
            <ReceiptText size={13} />
            Scan Bill
          </GlassButton>
          {subtotal > 0 && (
            <span className="text-sm font-semibold text-indigo-300">
              {formatMoney(subtotal, currency)}
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <ItemRow
              item={item}
              people={people}
              currency={currency}
              isEditing={editingId === item.id}
              onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
              onUpdate={(patch) => updateItem(item.id, patch)}
              onRemove={() => removeItem(item.id)}
              onToggleAssign={(pid) => toggleAssign(item.id, pid)}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {items.length === 0 && (
        <div className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No items yet. Add items to split.
        </div>
      )}

      <GlassButton variant="secondary" onClick={addItem} className="gap-1.5 w-full justify-center">
        <Plus size={14} />
        Add Item
      </GlassButton>
    </GlassCard>
  )
}

function ItemRow({
  item, people, currency, isEditing,
  onEdit, onUpdate, onRemove, onToggleAssign,
}: {
  item: BillItem
  people: BillPerson[]
  currency: string
  isEditing: boolean
  onEdit: () => void
  onUpdate: (patch: Partial<BillItem>) => void
  onRemove: () => void
  onToggleAssign: (personId: string) => void
}) {
  const sym = currencySymbol(currency)
  const assignedNames =
    item.assignedPeople.length > 0
      ? item.assignedPeople
          .map((id) => people.find((p) => p.id === id)?.name ?? id)
          .join(', ')
      : 'Everyone'

  const total = item.price * item.quantity

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/[0.04] transition-colors"
        onClick={onEdit}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium"
              style={{ color: item.name ? 'var(--text-primary)' : 'var(--text-faint)' }}
            >
              {item.name || 'Unnamed item'}
            </span>
            {item.quantity > 1 && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>×{item.quantity}</span>
            )}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{assignedNames}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {sym}{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
          <span style={{ color: "var(--text-faint)" }}>
            {isEditing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </div>

      {/* Expanded editor */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-black/[0.07]"
          >
            <div className="p-3 flex flex-col gap-3">
              {/* Name + price + qty row */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
                <GlassInput
                  label="Name"
                  placeholder="Pizza"
                  value={item.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Price</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-faint)" }}>{sym}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="glass-input rounded-xl pl-6 pr-2.5 py-2.5 text-sm w-24"
                      value={item.price || ''}
                      onChange={(e) => onUpdate({ price: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Qty</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="glass-input rounded-xl px-2.5 py-2.5 text-sm w-14 text-center"
                    value={item.quantity}
                    onChange={(e) => onUpdate({ quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                  />
                </div>
              </div>

              {/* Assign to people */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Assign to</p>
                <div className="flex flex-wrap gap-1.5">
                  {people.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onToggleAssign(p.id)}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
                        item.assignedPeople.includes(p.id)
                          ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/40'
                          : 'glass hover:bg-black/[0.05]'
                      )}
                    >
                      {item.assignedPeople.includes(p.id) && <Check size={10} />}
                      {p.name}
                    </button>
                  ))}
                  {item.assignedPeople.length > 0 && (
                    <button
                      onClick={() => onUpdate({ assignedPeople: [] })}
                      className="px-2.5 py-1 rounded-full text-xs glass hover:bg-black/[0.05] transition-colors" style={{ color: "var(--text-faint)" }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {item.assignedPeople.length === 0 && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>Unassigned → shared equally by everyone</p>
                )}
                {item.assignedPeople.length > 1 && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>
                    Shared: {sym}{(total / item.assignedPeople.length).toLocaleString('en-IN', { maximumFractionDigits: 2 })} each
                  </p>
                )}
              </div>

              {/* Delete */}
              <div className="flex justify-end">
                <GlassButton variant="danger" size="sm" onClick={onRemove} className="gap-1">
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

// ══════════════════════════════════════════════════════════════════════════
// Step: Charges
// ══════════════════════════════════════════════════════════════════════════

interface ChargesStepProps {
  sym: string
  discountType: ChargeValueType; setDiscountType: (v: ChargeValueType) => void
  discountValue: number; setDiscountValue: (v: number) => void
  taxType: ChargeValueType; setTaxType: (v: ChargeValueType) => void
  taxValue: number; setTaxValue: (v: number) => void
  serviceChargeType: ChargeValueType; setServiceChargeType: (v: ChargeValueType) => void
  serviceChargeValue: number; setServiceChargeValue: (v: number) => void
  tipType: ChargeValueType; setTipType: (v: ChargeValueType) => void
  tipValue: number; setTipValue: (v: number) => void
  totals: BillCalculationResult['totals']
  currency: string
}

function ChargesStep({
  sym, discountType, setDiscountType, discountValue, setDiscountValue,
  taxType, setTaxType, taxValue, setTaxValue,
  serviceChargeType, setServiceChargeType, serviceChargeValue, setServiceChargeValue,
  tipType, setTipType, tipValue, setTipValue,
  totals, currency,
}: ChargesStepProps) {
  return (
    <GlassCard padding="lg" className="flex flex-col gap-5">
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Additional Charges</h2>

      <ChargeRow
        label="Discount"
        emoji="🏷️"
        colorClass="text-emerald-400"
        type={discountType} setType={setDiscountType}
        value={discountValue} setValue={setDiscountValue}
        sym={sym}
        computed={totals.discountAmount > 0 ? `−${formatMoney(totals.discountAmount, currency)}` : undefined}
        computedColor="text-emerald-400"
      />
      <ChargeRow
        label="Tax"
        emoji="🧾"
        colorClass="text-amber-400"
        type={taxType} setType={setTaxType}
        value={taxValue} setValue={setTaxValue}
        sym={sym}
        computed={totals.taxAmount > 0 ? `+${formatMoney(totals.taxAmount, currency)}` : undefined}
        computedColor="text-amber-400"
      />
      <ChargeRow
        label="Service Charge"
        emoji="🛎️"
        colorClass="text-blue-400"
        type={serviceChargeType} setType={setServiceChargeType}
        value={serviceChargeValue} setValue={setServiceChargeValue}
        sym={sym}
        computed={totals.serviceChargeAmount > 0 ? `+${formatMoney(totals.serviceChargeAmount, currency)}` : undefined}
        computedColor="text-blue-400"
      />
      <ChargeRow
        label="Tip"
        emoji="💝"
        colorClass="text-pink-400"
        type={tipType} setType={setTipType}
        value={tipValue} setValue={setTipValue}
        sym={sym}
        computed={totals.tipAmount > 0 ? `+${formatMoney(totals.tipAmount, currency)}` : undefined}
        computedColor="text-pink-400"
      />

      {/* Running total */}
      <div className="glass rounded-xl p-3 mt-1 space-y-1.5">
        <TotalLine label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
        {totals.discountAmount > 0 && (
          <TotalLine label="Discount" value={`−${formatMoney(totals.discountAmount, currency)}`} valueClass="text-emerald-400" />
        )}
        {totals.taxAmount > 0 && (
          <TotalLine label="Tax" value={`+${formatMoney(totals.taxAmount, currency)}`} valueClass="text-amber-400" />
        )}
        {totals.serviceChargeAmount > 0 && (
          <TotalLine label="Service Charge" value={`+${formatMoney(totals.serviceChargeAmount, currency)}`} valueClass="text-blue-400" />
        )}
        {totals.tipAmount > 0 && (
          <TotalLine label="Tip" value={`+${formatMoney(totals.tipAmount, currency)}`} valueClass="text-pink-400" />
        )}
        <div className="border-t border-black/[0.07] pt-1.5 flex items-center justify-between">
          <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Total</span>
          <motion.span
            key={totals.grandTotal}
            initial={{ scale: 0.95, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-lg font-bold gradient-text"
          >
            {formatMoney(totals.grandTotal, currency)}
          </motion.span>
        </div>
      </div>
    </GlassCard>
  )
}

function ChargeRow({
  label, emoji, colorClass, type, setType, value, setValue, sym, computed, computedColor,
}: {
  label: string; emoji: string; colorClass: string
  type: ChargeValueType; setType: (v: ChargeValueType) => void
  value: number; setValue: (v: number) => void
  sym: string; computed?: string; computedColor?: string
}) {
  const enabled = value > 0
  return (
    <div className={cn('glass rounded-xl p-3 transition-all', !enabled && 'opacity-60')}>
      <div className="flex items-center gap-2 mb-2">
        <span>{emoji}</span>
        <span className={cn('text-sm font-medium flex-1', colorClass)}>{label}</span>
        {computed && (
          <span className={cn('text-sm font-semibold', computedColor)}>{computed}</span>
        )}
      </div>
      <div className="flex gap-2 items-center">
        {/* Type toggle */}
        <div className="flex rounded-lg overflow-hidden border border-black/[0.08]">
          <button
            onClick={() => setType('amount')}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              type === 'amount' ? 'bg-indigo-500/15 text-indigo-600' : 'hover:bg-black/[0.05]'
            )}
          >
            {sym}
          </button>
          <button
            onClick={() => setType('percent')}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              type === 'percent' ? 'bg-indigo-500/15 text-indigo-600' : 'hover:bg-black/[0.05]'
            )}
          >
            %
          </button>
        </div>
        <input
          type="number"
          min={0}
          step={type === 'percent' ? 0.5 : 1}
          placeholder="0"
          value={value || ''}
          onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
          className="glass-input flex-1 rounded-xl px-3 py-2 text-sm"
        />
        {value > 0 && (
          <button onClick={() => setValue(0)} className="p-1 hover:text-red-500 transition-colors" style={{ color: "var(--text-faint)" }}>
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function TotalLine({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className={cn('text-xs font-medium', valueClass ?? '')}>{value}</span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Step: Split Mode
// ══════════════════════════════════════════════════════════════════════════

function SplitStep({
  splitMode, setSplitMode, people, customSplits, setCustomSplits, calcResult, currency,
}: {
  splitMode: SplitMode; setSplitMode: (v: SplitMode) => void
  people: BillPerson[]
  customSplits: CustomSplit[]
  setCustomSplits: React.Dispatch<React.SetStateAction<CustomSplit[]>>
  calcResult: BillCalculationResult
  currency: string
}) {
  const afterDiscount = calcResult.totals.afterDiscount
  const sym = currencySymbol(currency)

  // Initialise custom splits when mode changes or people change
  useEffect(() => {
    if (splitMode === 'custom') {
      setCustomSplits((prev) => {
        const existing = new Map(prev.map((cs) => [cs.personId, cs]))
        return people.map((p) => existing.get(p.id) ?? { personId: p.id, value: 0, type: 'amount' as const })
      })
    }
  }, [splitMode, people, setCustomSplits])

  const customType = customSplits[0]?.type ?? 'amount'
  const customTotal = customSplits.reduce((s, cs) => s + cs.value, 0)
  const percentOk = Math.abs(customTotal - 100) <= 0.5
  const amountOk = Math.abs(customTotal - afterDiscount) < 1

  return (
    <GlassCard padding="lg" className="flex flex-col gap-4">
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>How to split?</h2>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: 'item', label: 'By Item', desc: 'Based on assigned items', icon: '🛒' },
          { key: 'equal', label: 'Equal', desc: 'Split evenly', icon: '⚖️' },
          { key: 'custom', label: 'Custom', desc: 'Manual amounts', icon: '✏️' },
        ] as const).map((mode) => (
          <button
            key={mode.key}
            onClick={() => setSplitMode(mode.key)}
            className={cn(
              'glass rounded-xl p-3 text-left transition-all',
              splitMode === mode.key && 'border border-indigo-500/40 bg-indigo-500/10'
            )}
          >
            <div className="text-lg mb-1">{mode.icon}</div>
            <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{mode.label}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{mode.desc}</div>
          </button>
        ))}
      </div>

      {/* Preview */}
      {splitMode !== 'custom' && (
        <div className="flex flex-col gap-1.5">
          {calcResult.personShares.map((ps) => (
            <div key={ps.personId} className="flex items-center justify-between py-1.5 px-3 glass rounded-xl">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/30 flex items-center justify-center text-xs text-indigo-200 font-bold">
                  {ps.personName[0]?.toUpperCase()}
                </span>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{ps.personName}</span>
              </div>
              <motion.span
                key={ps.total}
                initial={{ opacity: 0.5, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-sm font-semibold text-indigo-300"
              >
                {formatMoney(ps.total, currency)}
              </motion.span>
            </div>
          ))}
        </div>
      )}

      {/* Custom split editor */}
      {splitMode === 'custom' && (
        <div className="flex flex-col gap-3">
          {/* Type toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Enter as</span>
            <div className="flex rounded-lg overflow-hidden border border-black/[0.08]">
              {(['amount', 'percent'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    setCustomSplits((prev) =>
                      prev.map((cs) => ({ ...cs, type: t, value: 0 }))
                    )
                  }
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    customType === t ? 'bg-indigo-500/15 text-indigo-600' : 'hover:bg-black/[0.05]'
                  )}
                >
                  {t === 'amount' ? `${sym} Amount` : '% Percent'}
                </button>
              ))}
            </div>
          </div>

          {customSplits.map((cs) => {
            const person = people.find((p) => p.id === cs.personId)
            if (!person) return null
            return (
              <div key={cs.personId} className="flex items-center gap-2 glass rounded-xl px-3 py-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/30 flex items-center justify-center text-xs text-indigo-200 font-bold shrink-0">
                  {person.name[0]?.toUpperCase()}
                </span>
                <span className="text-sm text-white flex-1">{person.name}</span>
                <div className="relative">
                  {customType === 'amount' && (
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-faint)" }}>{sym}</span>
                  )}
                  <input
                    type="number"
                    min={0}
                    step={customType === 'percent' ? 1 : 0.01}
                    value={cs.value || ''}
                    placeholder="0"
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setCustomSplits((prev) =>
                        prev.map((s) => (s.personId === cs.personId ? { ...s, value: val } : s))
                      )
                    }}
                    className={cn(
                      'glass-input rounded-xl py-1.5 text-sm text-right w-24',
                      customType === 'amount' ? 'pl-5 pr-2' : 'px-2'
                    )}
                  />
                  {customType === 'percent' && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-faint)" }}>%</span>
                  )}
                </div>
              </div>
            )
          })}

          {/* Validation indicator */}
          <div className={cn(
            'text-xs px-3 py-2 rounded-lg flex items-center gap-1.5',
            customType === 'percent'
              ? percentOk ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
              : amountOk ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
          )}>
            {(customType === 'percent' ? percentOk : amountOk) ? <Check size={12} /> : null}
            {customType === 'percent'
              ? `Total: ${customTotal.toFixed(1)}% ${percentOk ? '✓' : '(must equal 100%)'}`
              : `Total: ${formatMoney(customTotal, currency)} ${amountOk ? '✓' : `(bill after discount: ${formatMoney(afterDiscount, currency)})`}`}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Step: Summary
// ══════════════════════════════════════════════════════════════════════════

function SummaryStep({
  calcResult, people, currency, name, date,
}: {
  calcResult: BillCalculationResult
  people: BillPerson[]
  currency: string
  name: string
  date: string
}) {
  const { totals, personShares } = calcResult

  return (
    <GlassCard padding="lg" className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{name || 'Bill Summary'}</h2>
        {date && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{date}</p>}
      </div>

      {/* Grand total hero */}
      <div className="glass-strong rounded-2xl p-4 text-center">
        <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Total Bill</p>
        <motion.p
          key={totals.grandTotal}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-3xl font-bold gradient-text"
        >
          {formatMoney(totals.grandTotal, currency)}
        </motion.p>
        <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>{people.length} people</p>
      </div>

      {/* Charge breakdown */}
      <div className="glass rounded-xl p-3 space-y-1.5">
        <TotalLine label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
        {totals.discountAmount > 0 && (
          <TotalLine label="Discount" value={`−${formatMoney(totals.discountAmount, currency)}`} valueClass="text-emerald-400" />
        )}
        {totals.taxAmount > 0 && (
          <TotalLine label="Tax" value={`+${formatMoney(totals.taxAmount, currency)}`} valueClass="text-amber-400" />
        )}
        {totals.serviceChargeAmount > 0 && (
          <TotalLine label="Service Charge" value={`+${formatMoney(totals.serviceChargeAmount, currency)}`} valueClass="text-blue-400" />
        )}
        {totals.tipAmount > 0 && (
          <TotalLine label="Tip" value={`+${formatMoney(totals.tipAmount, currency)}`} valueClass="text-pink-400" />
        )}
      </div>

      {/* Per-person totals */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Each person owes</p>
        <div className="flex flex-col gap-1.5">
          {personShares.map((ps) => (
            <div key={ps.personId} className="flex items-center gap-2 py-2 px-3 glass rounded-xl">
              <span className="w-7 h-7 rounded-full bg-indigo-500/30 flex items-center justify-center text-xs text-indigo-200 font-bold shrink-0">
                {ps.personName[0]?.toUpperCase()}
              </span>
              <span className="text-sm text-white flex-1">{ps.personName}</span>
              <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatMoney(ps.total, currency)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 pt-2 border-t border-black/[0.07]">
            <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>Total</span>
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatMoney(totals.grandTotal, currency)}</span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
