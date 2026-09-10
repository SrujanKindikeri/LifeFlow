'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Receipt, TrendingDown, Users, Wallet, Calendar, X } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { cn, formatCurrency } from '@/lib/utils'
import { type GroupBillData } from './types'
import { GroupBillList } from './GroupBillList'
import { GroupBillSplitter } from './GroupBillSplitter'
import { GroupBillDetail } from './GroupBillDetail'
import { GroupBillCalendar } from './GroupBillCalendar'

type View = 'list' | 'create' | 'edit' | 'detail'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSelectedDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function todayString(): string {
  return new Date().toISOString().split('T')[0]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpensesClient() {
  const [bills,        setBills]        = useState<GroupBillData[]>([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [view,         setView]         = useState<View>('list')
  const [selectedBill, setSelectedBill] = useState<GroupBillData | null>(null)
  const [editingBill,  setEditingBill]  = useState<GroupBillData | null>(null)

  // Calendar state
  const [calendarOpen,     setCalendarOpen]     = useState(false)
  const [selectedDate,     setSelectedDate]     = useState<string | null>(null)
  const calendarTriggerRef = useRef<HTMLButtonElement | null>(null)

  const today = todayString()
  const { error: toastError, success: toastSuccess } = useToast()

  // ── Fetch bills ─────────────────────────────────────────────────────────────
  const fetchBills = useCallback(async () => {
    try {
      const res = await fetch('/api/group-bills')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setBills(data.groupBills ?? [])
    } catch {
      toastError('Failed to load group bills')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchBills() }, [fetchBills])

  // ── Filtered bill list (client-side) ────────────────────────────────────────
  const filteredBills = selectedDate
    ? bills.filter((b) => b.date === selectedDate)
    : bills

  // ── Group analytics (always from full set) ──────────────────────────────────
  const totalGroupSpend = bills.reduce((s, b) => s + b.total, 0)
  const savedCount      = bills.filter((b) => b.savedAsExpense).length
  const pendingCount    = bills.filter(
    (b) => b.settlements.some((s) => !s.settled),
  ).length

  // ── Calendar handlers ────────────────────────────────────────────────────────
  function handleCalendarSelect(date: string) {
    setSelectedDate(date)
    setCalendarOpen(false)
  }

  function clearCalendarDate() {
    setSelectedDate(null)
  }

  // ── Create / Update ──────────────────────────────────────────────────────────
  async function handleSave(bill: GroupBillData) {
    setSaving(true)
    try {
      if (bill._id) {
        const res = await fetch(`/api/group-bills/${bill._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bill),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? 'Update failed')
        }
        const data = await res.json()
        setBills((prev) => prev.map((b) => (b._id === bill._id ? data.groupBill : b)))
        setSelectedBill(data.groupBill)
        setView('detail')
      } else {
        const res = await fetch('/api/group-bills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bill),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? 'Create failed')
        }
        const data = await res.json()
        setBills((prev) => [data.groupBill, ...prev])
        setSelectedBill(data.groupBill)
        setView('detail')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(updatedBill: GroupBillData) {
    if (!updatedBill._id) return
    const res = await fetch(`/api/group-bills/${updatedBill._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedBill),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error ?? 'Update failed')
    }
    const data = await res.json()
    setBills((prev) => prev.map((b) => (b._id === updatedBill._id ? data.groupBill : b)))
    setSelectedBill(data.groupBill)
  }

  async function handleMarkSettled(fromPerson: string, toPerson: string) {
    if (!selectedBill?._id) return
    const res = await fetch(`/api/group-bills/${selectedBill._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settle', fromPerson, toPerson }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error ?? 'Failed')
    }
    const data = await res.json()
    setBills((prev) => prev.map((b) => (b._id === selectedBill._id ? data.groupBill : b)))
    setSelectedBill(data.groupBill)
  }

  async function handleDelete(id: string, deleteExpense: boolean) {
    const url = deleteExpense
      ? `/api/group-bills/${id}?deleteExpense=true`
      : `/api/group-bills/${id}`
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error ?? 'Delete failed')
    }
    setBills((prev) => prev.filter((b) => b._id !== id))
    toastSuccess(deleteExpense
      ? 'Bill and linked personal expense deleted'
      : 'Group bill deleted')
    if (view === 'detail' && selectedBill?._id === id) goToList()
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  function openCreate()                      { setEditingBill(null); setView('create') }
  function openEdit(bill: GroupBillData)     { setEditingBill(bill); setView('edit') }
  function openDetail(bill: GroupBillData)   { setSelectedBill(bill); setView('detail') }
  function goToList()                        { setView('list'); setSelectedBill(null); setEditingBill(null) }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* List-view header + analytics — only shown in list view */}
      {view === 'list' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Group Bills</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Split expenses with friends, family, or roommates
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Calendar trigger */}
              <div className="relative">
                <button
                  ref={calendarTriggerRef}
                  onClick={() => setCalendarOpen((o) => !o)}
                  aria-label="Open group bill calendar"
                  aria-expanded={calendarOpen}
                  aria-haspopup="dialog"
                  className={cn(
                    'h-9 px-3 rounded-xl transition-colors border text-sm focus-ring',
                    'flex items-center gap-1.5',
                    selectedDate
                      ? 'bg-indigo-500/12 text-indigo-600 border-indigo-500/25'
                      : calendarOpen
                        ? 'bg-black/[0.05] border-black/[0.09]'
                        : 'glass hover:bg-black/[0.04]',
                  )}
                  style={!selectedDate && !calendarOpen ? { color: 'var(--text-secondary)' } : {}}
                >
                  <Calendar size={14} />
                  <span className="hidden sm:inline text-xs font-medium">
                    {selectedDate ? 'Date' : 'Browse'}
                  </span>
                </button>

                {/* Calendar popover */}
                <div className="sm:relative">
                  <GroupBillCalendar
                    selectedDate={selectedDate}
                    onSelectDate={handleCalendarSelect}
                    triggerRef={calendarTriggerRef}
                    isOpen={calendarOpen}
                    onClose={() => setCalendarOpen(false)}
                  />
                </div>
              </div>

              <GlassButton variant="primary" onClick={openCreate} className="gap-1.5">
                <Plus size={15} />
                <span className="hidden sm:inline">Split a Bill</span>
                <span className="sm:hidden">New</span>
              </GlassButton>
            </div>
          </div>

          {/* Group analytics strip */}
          {bills.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: 'Total Bills',
                  value: bills.length.toString(),
                  icon: <Receipt size={14} />,
                  color: 'text-indigo-500',
                },
                {
                  label: 'Group Spending',
                  value: formatCurrency(totalGroupSpend),
                  icon: <TrendingDown size={14} />,
                  color: 'text-pink-500',
                },
                {
                  label: 'In Personal Spending',
                  value: `${savedCount} bill${savedCount !== 1 ? 's' : ''}`,
                  icon: <Wallet size={14} />,
                  color: 'text-emerald-600',
                },
                {
                  label: 'Pending Settlements',
                  value: `${pendingCount} bill${pendingCount !== 1 ? 's' : ''}`,
                  icon: <Users size={14} />,
                  color: pendingCount > 0 ? 'text-amber-400' : 'text-emerald-600',
                },
              ].map(({ label, value, icon, color }) => (
                <GlassCard key={label} padding="sm">
                  <div className={`flex items-center gap-1.5 mb-1 ${color}`}>
                    {icon}
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      {label}
                    </span>
                  </div>
                  <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {value}
                  </p>
                </GlassCard>
              ))}
            </div>
          )}

          {/* Selected-date summary banner */}
          <AnimatePresence>
            {selectedDate && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="glass-elevated rounded-2xl px-4 py-3.5 flex items-center justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Calendar size={13} style={{ color: 'var(--accent)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatSelectedDate(selectedDate)}
                    </span>
                    {selectedDate === today && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ background: 'rgba(37,99,235,0.10)', color: 'var(--accent)' }}
                      >
                        Today
                      </span>
                    )}
                  </div>
                  {filteredBills.length > 0 ? (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {filteredBills.length} bill{filteredBills.length !== 1 ? 's' : ''}
                      {' · '}
                      {formatCurrency(filteredBills.reduce((s, b) => s + b.total, 0))}
                    </span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      No bills on this day
                    </span>
                  )}
                </div>

                <button
                  onClick={clearCalendarDate}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg glass hover:bg-black/[0.05] transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X size={11} />
                  Clear date
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Views */}
      <AnimatePresence mode="wait">
        {view === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GroupBillList
              bills={filteredBills}
              loading={loading}
              onSelect={openDetail}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          </motion.div>
        )}

        {(view === 'create' || view === 'edit') && (
          <motion.div
            key="splitter"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mb-4">
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {view === 'create' ? 'New Group Bill' : 'Edit Group Bill'}
              </h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {view === 'create' ? 'Split a bill with your group' : 'Update bill details'}
              </p>
            </div>
            <GroupBillSplitter
              initialData={view === 'edit' ? (editingBill ?? undefined) : undefined}
              onSave={handleSave}
              onCancel={
                view === 'edit'
                  ? () => { setView('detail'); setSelectedBill(editingBill) }
                  : goToList
              }
              saving={saving}
            />
          </motion.div>
        )}

        {view === 'detail' && selectedBill && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            <GroupBillDetail
              bill={selectedBill}
              onBack={goToList}
              onEdit={() => openEdit(selectedBill)}
              onUpdate={handleUpdate}
              onMarkSettled={handleMarkSettled}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
